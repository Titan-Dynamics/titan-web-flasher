/*
 * usbconfig.js — WebUSB implementation of the TitanLRS USB config protocol.
 *
 * Mirror of the firmware side in TitanLRS/src/lib/USBConfig (usbcfg_protocol.h + usbcfg_framing).
 * Keep the constants below in sync with that header.
 *
 * Transport: the device is a composite exposing a CDC-ACM port (MAVLink, left for the GCS) and a
 * vendor-class interface carrying this protocol. We claim the vendor interface directly, which
 * means the chooser shows one device rather than two indistinguishable COM ports, the OS creates
 * no serial node we could be locked out of, and a GCS can hold the CDC port open throughout.
 *
 * A UsbConfigSession implements the same interface as the firmware web UI's
 * html/src/utils/transport.js, so the panels copied into src/dashboard/ work unchanged.
 */

/* Must match USBD_VID / USBD_PID in TitanLRS/src/targets/common.ini. 1209:0001 is pid.codes'
 * prototyping pair and is not shippable — see the note there. We deliberately do not use ST's
 * generic 0483:5740 VCP pair: ST's Windows driver claims it by hardware ID, which stops Windows
 * enumerating the device as composite and leaves the vendor interface with no driver at all. */
export const USB_FILTER = {vendorId: 0x1209, productId: 0x0001}

/* Matches lib/USBComposite: the config interface is found by class, so it survives any future
 * renumbering of the interfaces around it. */
const USB_VENDOR_CLASS = 0xFF

export const PROTOCOL_VERSION = 1
const CHUNK_MAX = 1000

const TCFG_HELLO = 0x5443
const TCFG_BYE = 0x5444
const TCFG_GET = 0x5445
const TCFG_SET = 0x5446
const TCFG_REBOOT = 0x5447
const TCFG_RESET = 0x5448
const TCFG_PING = 0x5449

const RES_CONFIG = 0
const RES_OPTIONS = 1

const GETFLAG_EXPORT = 1 << 0
const RESETFLAG_CONFIG = 1 << 0
const RESETFLAG_OPTIONS = 1 << 1

const CHUNK_FIRST = 1 << 0
const CHUNK_LAST = 1 << 1

export const FEATURE_OPTIONS_WRITE = 1 << 0
export const FEATURE_CW = 1 << 1
export const FEATURE_LR1121_UPDATE = 1 << 2

const FN_NAMES = {
  [TCFG_HELLO]: 'hello', [TCFG_BYE]: 'bye', [TCFG_GET]: 'get', [TCFG_SET]: 'set',
  [TCFG_REBOOT]: 'reboot', [TCFG_RESET]: 'reset', [TCFG_PING]: 'ping',
}

const ERR_NAMES = {
  1: 'UNSUPPORTED', 2: 'BUSY', 3: 'BAD_REQUEST', 4: 'TOO_LARGE',
  5: 'PARSE', 6: 'NO_SESSION', 7: 'INTERNAL',
}

const DEFAULT_TIMEOUT_MS = 2000
const KEEPALIVE_MS = 1000

export class DeviceError extends Error {
  constructor(code, message) {
    super(`${ERR_NAMES[code] || 'ERR' + code}: ${message}`)
    this.code = code
    this.deviceMessage = message
  }
}

export function isWebUsbSupported() {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

/** Devices the user has already granted us; lets a return visit reconnect without a chooser. */
export async function getKnownDevices() {
  if (!isWebUsbSupported()) return []
  const devices = await navigator.usb.getDevices()
  return devices.filter((d) => d.vendorId === USB_FILTER.vendorId &&
                               d.productId === USB_FILTER.productId)
}

/** Locate the vendor-class interface and its bulk pair. */
function findConfigInterface(device) {
  const config = device.configuration || device.configurations[0]
  for (const iface of config.interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass !== USB_VENDOR_CLASS) continue
      const epIn = alt.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk')
      const epOut = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
      if (epIn && epOut) {
        return {
          interfaceNumber: iface.interfaceNumber,
          epIn: epIn.endpointNumber,
          epOut: epOut.endpointNumber,
          packetSize: epIn.packetSize || 64,
        }
      }
    }
  }
  return null
}

function crc8DvbS2(crc, byte) {
  crc ^= byte
  for (let i = 0; i < 8; i++) crc = (crc & 0x80) ? ((crc << 1) ^ 0xD5) & 0xFF : (crc << 1) & 0xFF
  return crc
}

function crc8Over(bytes) {
  let crc = 0
  for (const b of bytes) crc = crc8DvbS2(crc, b)
  return crc
}

export class UsbConfigSession {
  constructor({timeout = DEFAULT_TIMEOUT_MS} = {}) {
    this.name = 'usb'
    this.timeout = timeout
    this.hello = null
    this.features = 0
    this.device = null

    this._iface = null
    this._epIn = 0
    this._epOut = 0
    this._packetSize = 64
    this._readLoopDone = null
    this._rx = new Uint8Array(0)
    this._pending = null      // {function, resolve, reject, timer, chunks}
    this._queue = Promise.resolve()
    this._lostCbs = []
    this._keepalive = null
    this._closing = false
  }

  // ---- lifecycle -------------------------------------------------------------
  async connect(existingDevice = null) {
    if (!isWebUsbSupported()) throw new Error('WebUSB is not available in this browser')

    this.device = existingDevice || await navigator.usb.requestDevice({filters: [USB_FILTER]})

    await this.device.open()
    // Selecting a configuration resets the device's interfaces, so only do it if the OS has not
    // already chosen one — otherwise we would drop a GCS holding the CDC port.
    if (this.device.configuration === null) await this.device.selectConfiguration(1)

    const found = findConfigInterface(this.device)
    if (!found) {
      await this.device.close().catch(() => {})
      this.device = null
      throw new Error('This device has no TitanLRS config interface. Update its firmware.')
    }
    this._iface = found.interfaceNumber
    this._epIn = found.epIn
    this._epOut = found.epOut
    this._packetSize = found.packetSize

    await this.device.claimInterface(this._iface)

    this._closing = false
    this._watchDisconnect()
    this._readLoopDone = this._readLoop()

    const resp = await this._request(TCFG_HELLO, Uint8Array.of(PROTOCOL_VERSION))
    if (resp.length < 5) throw new DeviceError(3, 'short HELLO response')
    const view = new DataView(resp.buffer, resp.byteOffset, resp.byteLength)
    this.features = view.getUint32(1, true)
    this.hello = JSON.parse(new TextDecoder().decode(resp.subarray(5)))
    this.hello['proto-version'] = resp[0]

    this._startKeepalive()
    return this.hello
  }

  async disconnect() {
    this._closing = true
    this._stopKeepalive()
    try { await this._request(TCFG_BYE) } catch { /* device may already be gone */ }
    await this._teardown()
  }

  /** Register a callback fired when the device goes away (unplugged, reboot, timeout). */
  onLost(cb) {
    this._lostCbs.push(cb)
    return () => {
      const i = this._lostCbs.indexOf(cb)
      if (i >= 0) this._lostCbs.splice(i, 1)
    }
  }

  get connected() {
    return this.device !== null && this._iface !== null
  }

  hasFeature(bit) {
    return (this.features & bit) !== 0
  }

  async _teardown() {
    this._stopKeepalive()
    this._closing = true
    this._unwatchDisconnect()
    // There is no way to cancel an outstanding transferIn(), so the read loop is unblocked by
    // releasing the interface underneath it: the pending transfer rejects, the loop sees
    // _closing and exits quietly. Wait for that before closing, or close() races the transfer.
    try { if (this.device && this._iface !== null) await this.device.releaseInterface(this._iface) }
    catch { /* ignore */ }
    try { await this._readLoopDone } catch { /* ignore */ }
    this._readLoopDone = null
    this._iface = null
    try { if (this.device) await this.device.close() } catch { /* ignore */ }
    this.device = null
  }

  _watchDisconnect() {
    this._onUsbDisconnect = (event) => {
      if (event.device === this.device) this._notifyLost('Device disconnected')
    }
    navigator.usb.addEventListener('disconnect', this._onUsbDisconnect)
  }

  _unwatchDisconnect() {
    if (this._onUsbDisconnect) {
      navigator.usb.removeEventListener('disconnect', this._onUsbDisconnect)
      this._onUsbDisconnect = null
    }
  }

  _notifyLost(reason) {
    if (this._closing) return
    this._closing = true
    this._stopKeepalive()
    if (this._pending) {
      this._pending.reject(new Error(reason))
      this._clearPending()
    }
    this._lostCbs.slice().forEach((cb) => { try { cb(reason) } catch { /* ignore */ } })
  }

  _startKeepalive() {
    this._stopKeepalive()
    // The device closes an idle session after 3 s; a 1 Hz ping keeps it open while the user
    // reads the page. Failures just mean the device went away, which onLost() reports.
    this._keepalive = setInterval(() => {
      this._enqueue(() => this._request(TCFG_PING)).catch(() => {})
    }, KEEPALIVE_MS)
  }

  _stopKeepalive() {
    if (this._keepalive) clearInterval(this._keepalive)
    this._keepalive = null
  }

  // ---- framing ---------------------------------------------------------------
  async _readLoop() {
    // A transferIn() has to be posted for the device to have anywhere to put a reply, so keep one
    // outstanding at all times. Ask for several packets: the transfer completes as soon as the
    // device sends a short packet, and the firmware appends a zero-length packet after any reply
    // that lands on an exact packet-size multiple, so this never stalls waiting to fill.
    const readSize = this._packetSize * 8
    try {
      for (;;) {
        const result = await this.device.transferIn(this._epIn, readSize)
        if (this._closing) return
        if (result.status === 'stall') {
          await this.device.clearHalt('in', this._epIn)
          continue
        }
        if (result.data && result.data.byteLength) {
          this._onBytes(new Uint8Array(result.data.buffer))
        }
      }
    } catch (err) {
      if (this._closing) return    // teardown released the interface out from under us
      this._notifyLost(err && err.message ? err.message : 'USB connection lost')
    }
  }

  _onBytes(chunk) {
    const merged = new Uint8Array(this._rx.length + chunk.length)
    merged.set(this._rx)
    merged.set(chunk, this._rx.length)
    this._rx = merged
    for (;;) {
      const frame = this._parseFrame()
      if (!frame) break
      this._dispatch(frame)
    }
  }

  _parseFrame() {
    let buf = this._rx
    for (;;) {
      let start = -1
      for (let i = 0; i + 1 < buf.length; i++) {
        if (buf[i] === 0x24 /* $ */ && buf[i + 1] === 0x58 /* X */) { start = i; break }
      }
      if (start < 0) {
        // Keep a trailing '$' in case the 'X' has not arrived yet.
        this._rx = buf.length ? buf.subarray(buf.length - 1) : buf
        return null
      }
      if (start > 0) buf = buf.subarray(start)
      if (buf.length < 8) { this._rx = buf; return null }

      const direction = String.fromCharCode(buf[2])
      if (direction !== '>' && direction !== '!') { buf = buf.subarray(2); continue }

      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      const fn = view.getUint16(4, true)
      const size = view.getUint16(6, true)
      if (buf.length < 8 + size + 1) { this._rx = buf; return null }

      const body = buf.subarray(3, 8 + size)
      const crc = buf[8 + size]
      const payload = buf.slice(8, 8 + size)
      buf = buf.subarray(9 + size)
      if (crc !== crc8Over(body)) continue   // corrupt / interleaved log text, resync
      this._rx = buf
      return {direction, fn, payload}
    }
  }

  async _send(fn, payload = new Uint8Array(0)) {
    if (!this.connected) throw new Error('Not connected')
    const frame = new Uint8Array(9 + payload.length)
    frame[0] = 0x24; frame[1] = 0x58; frame[2] = 0x3C  // '$','X','<'
    frame[3] = 0
    frame[4] = fn & 0xFF
    frame[5] = (fn >> 8) & 0xFF
    frame[6] = payload.length & 0xFF
    frame[7] = (payload.length >> 8) & 0xFF
    frame.set(payload, 8)
    frame[8 + payload.length] = crc8Over(frame.subarray(3, 8 + payload.length))
    const result = await this.device.transferOut(this._epOut, frame)
    if (result.status === 'stall') {
      await this.device.clearHalt('out', this._epOut)
      throw new Error('USB write stalled')
    }
  }

  _clearPending() {
    if (this._pending && this._pending.timer) clearTimeout(this._pending.timer)
    this._pending = null
  }

  _dispatch({direction, fn, payload}) {
    const p = this._pending
    if (!p || p.fn !== fn) return   // stale frame from an abandoned request
    if (direction === '!') {
      const err = new DeviceError(payload[0] || 0, new TextDecoder().decode(payload.subarray(1)))
      p.reject(err)
      this._clearPending()
      return
    }
    if (p.collect) {
      const done = p.collect(payload)
      if (!done) return
    }
    p.resolve(payload)
    this._clearPending()
  }

  _request(fn, payload, {collect = null, timeout = this.timeout} = {}) {
    return new Promise((resolve, reject) => {
      if (this._pending) { reject(new Error('Request already in flight')); return }
      const timer = setTimeout(() => {
        this._clearPending()
        // Name the request that died: "did not respond" alone cannot tell a lost HELLO from a
        // half-finished multi-step save, which is the first thing worth knowing when one fails.
        reject(new Error(`Device did not respond (${FN_NAMES[fn] || '0x' + fn.toString(16)}`
                         + `, ${timeout} ms)`))
      }, timeout)
      this._pending = {fn, resolve, reject, timer, collect}
      this._send(fn, payload).catch((err) => {
        this._clearPending()
        reject(err)
      })
    })
  }

  /** Serialise all protocol traffic — the firmware handles one command at a time. */
  _enqueue(job) {
    const run = this._queue.then(job, job)
    this._queue = run.catch(() => {})
    return run
  }

  // ---- endpoints -------------------------------------------------------------
  _getRaw(resource, exportMode) {
    return this._enqueue(() => {
      const out = []
      let expectSeq = 0
      let total = null
      let assembled = null
      const collect = (payload) => {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
        const seq = view.getUint16(0, true)
        const flags = payload[2]
        let off = 3
        if (flags & CHUNK_FIRST) { total = view.getUint32(off, true); off += 4 }
        if (seq !== expectSeq) throw new DeviceError(3, `chunk out of order (${seq} != ${expectSeq})`)
        expectSeq++
        out.push(payload.subarray(off))
        if (!(flags & CHUNK_LAST)) return false
        const len = out.reduce((n, c) => n + c.length, 0)
        if (total !== null && len !== total) throw new DeviceError(3, `length mismatch (${len} != ${total})`)
        assembled = new Uint8Array(len)
        let o = 0
        for (const c of out) { assembled.set(c, o); o += c.length }
        return true
      }
      // Chunked reads can span many frames; give the whole transfer a generous window.
      return this._request(TCFG_GET, Uint8Array.of(resource, exportMode ? GETFLAG_EXPORT : 0),
        {collect, timeout: 10000}).then(() => new TextDecoder().decode(assembled))
    })
  }

  async getConfig({export: exportMode = false} = {}) {
    return JSON.parse(await this._getRaw(RES_CONFIG, exportMode))
  }

  async getOptions() {
    return JSON.parse(await this._getRaw(RES_OPTIONS, false))
  }

  exportConfig({export: exportMode = true} = {}) {
    return this._getRaw(RES_CONFIG, exportMode)
  }

  _setRaw(resource, text) {
    return this._enqueue(async () => {
      const data = new TextEncoder().encode(text)
      let offset = 0
      let seq = 0
      for (;;) {
        const first = offset === 0
        const piece = data.subarray(offset, offset + CHUNK_MAX)
        offset += piece.length
        const last = offset >= data.length
        const hdrLen = first ? 8 : 4
        const frame = new Uint8Array(hdrLen + piece.length)
        const view = new DataView(frame.buffer)
        frame[0] = resource
        view.setUint16(1, seq, true)
        frame[3] = (first ? CHUNK_FIRST : 0) | (last ? CHUNK_LAST : 0)
        if (first) view.setUint32(4, data.length, true)
        frame.set(piece, hdrLen)
        // The final chunk triggers a ~70 ms flash commit (more for a models import), so give
        // it much longer than a plain chunk ack.
        const resp = await this._request(TCFG_SET, frame, {timeout: last ? 15000 : this.timeout})
        if (last) return new TextDecoder().decode(resp.subarray(1))
        seq++
      }
    })
  }

  saveConfig(config) {
    return this._setRaw(RES_CONFIG, JSON.stringify(config))
  }

  saveOptions(options) {
    // Firmware without FEATURE_OPTIONS_WRITE answers ERR_UNSUPPORTED; the UI gates the save
    // buttons on the bit so that only ever happens to a hand-crafted request.
    return this._setRaw(RES_OPTIONS, JSON.stringify(options))
  }

  importConfig(jsonText) {
    return this._setRaw(RES_CONFIG, jsonText)
  }

  previewButtonColors() {
    // No USB equivalent of the ESP /buttons live-preview endpoint; cosmetic only.
    return Promise.resolve()
  }

  reboot() {
    return this._enqueue(() => this._request(TCFG_REBOOT)).then(() => {})
  }

  reset(flags = {config: true}) {
    const bits = (flags.config || flags.model ? RESETFLAG_CONFIG : 0) |
                 (flags.options ? RESETFLAG_OPTIONS : 0)
    return this._enqueue(() => this._request(TCFG_RESET, Uint8Array.of(bits))).then(() => {})
  }
}

// ---------------------------------------------------------------------------------------
// MockTransport — hardware-free dashboard development. Selected with ?mock=tx|rx.
// Fixtures mirror TitanLRS/src/html/dev-mock-plugin.js, minus the ESP-only bits an STM32
// device never reports (no ssid, mode is "USB", no pwm array, no serial1-protocol).
// ---------------------------------------------------------------------------------------
function mockDocument(isTx) {
  return {
    settings: {
      product_name: isTx ? 'TD_LR1121_TX' : 'TD_LR1121_RX',
      lua_name: isTx ? 'TD_LR1121_TX' : 'TD_LR1121_RX',
      uidtype: isTx ? 'Flashed' : 'Bound',
      mode: 'USB',
      custom_hardware: false,
      has_low_band: true,
      has_high_band: true,
      reg_domain_low: 'AU915',
      reg_domain_high: 'ISM2G4',
      has_serial_pins: !isTx,
      target: isTx ? 'TD_LR1121_TX' : 'TD_LR1121_RX',
      version: '4.0.0-mock',
      'git-commit': 'deadbee',
      'module-type': isTx ? 'TX' : 'RX',
      'radio-type': 'LR1121',
    },
    options: {
      customised: false,
      uid: [1, 2, 3, 4, 5, 6],
      'tlm-interval': 240,
      'fan-runtime': 30,
      'is-airport': false,
      'rcvr-uart-baud': 420000,
      'airport-uart-baud': 9600,
      'lock-on-first-connection': true,
      domain: 1,
      // No 'wifi-on-interval' / 'wifi-ssid': STM32 has no WiFi and lib/ConfigJson omits the keys.
      'flash-discriminator': 12345,
    },
    config: isTx ? {
      uid: [1, 2, 3, 4, 5, 6],
      'button-actions': [
        {color: 255, action: [{'is-long-press': false, count: 3, action: 6},
                              {'is-long-press': true, count: 5, action: 1}]},
      ],
    } : {
      uid: [1, 2, 3, 4, 5, 6],
      modelid: 255,
      'force-tlm': false,
      'serial-protocol': 0,
      'sbus-failsafe': 0,
      vbind: 0,
    },
  }
}

export class MockTransport {
  constructor(moduleType = 'tx') {
    this.name = 'mock'
    this.isTx = moduleType.toLowerCase() === 'tx'
    // Current firmware persists options; `?mock=tx&ro` clears the bit so the read-only
    // rendering (what old firmware in the field still reports) stays testable.
    const readOnly = new URLSearchParams(window.location.search).has('ro')
    this.features = readOnly ? 0 : FEATURE_OPTIONS_WRITE
    this.doc = mockDocument(this.isTx)
    this.hello = {
      version: this.doc.settings.version,
      'git-commit': this.doc.settings['git-commit'],
      target: this.doc.settings.target,
      'module-type': this.doc.settings['module-type'],
      'radio-type': this.doc.settings['radio-type'],
      'proto-version': PROTOCOL_VERSION,
    }
  }

  async connect() { return this.hello }
  async disconnect() {}
  onLost() { return () => {} }
  get connected() { return true }
  hasFeature(bit) { return (this.features & bit) !== 0 }

  async getConfig({export: exportMode = false} = {}) {
    const doc = JSON.parse(JSON.stringify(this.doc))
    if (exportMode) return {config: doc.config}
    return doc
  }
  async getOptions() { return JSON.parse(JSON.stringify(this.doc.options)) }
  async exportConfig(opts) { return JSON.stringify(await this.getConfig(opts), null, 2) }
  async saveConfig(config) { Object.assign(this.doc.config, config); return 'Configuration updated' }
  async saveOptions(options) {
    if (!this.hasFeature(FEATURE_OPTIONS_WRITE)) throw new Error('Options are read-only on this firmware')
    // Mirrors ConfigJson_ApplyOptions(): the same guards, so the mock exercises the same paths.
    if (options.target !== undefined && options.target !== this.doc.settings.target) {
      throw new Error('target mismatch')
    }
    if (options['flash-discriminator'] !== undefined &&
        options['flash-discriminator'] !== this.doc.options['flash-discriminator']) {
      throw new Error('mismatched device identifier, reload the configuration and try again')
    }
    if (options.domain !== undefined && options.domain >= (this.doc.settings.has_low_band ? 8 : 1)) {
      throw new Error('unsupported regulatory domain')
    }
    Object.assign(this.doc.options, options, {customised: true})
    if (this.isTx) {
      this.doc.settings.uidtype = this.doc.options.uid ? 'Overridden' : 'Not set (using MAC address)'
    }
    return 'Options updated - reboot to apply'
  }
  async importConfig(text) { return this.saveConfig(JSON.parse(text).config || JSON.parse(text)) }
  async previewButtonColors() {}
  async reboot() {}
  async reset() {}
}
