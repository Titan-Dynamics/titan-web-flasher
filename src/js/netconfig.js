/*
 * netconfig.js — the TitanLRS config API over the USB network interface.
 *
 * STM32 TitanLRS firmware enumerates a USB network adapter (CDC-NCM) next to its serial port and
 * serves an HTTP API on it: 10.73.1.1 on a TX, 10.73.2.1 on an RX. This is the client half of
 * TitanLRS/src/lib/USBConfig/usbcfg_api.h; keep the routes in sync with that header.
 *
 * The page is a public HTTPS origin reaching a private address, which Chrome allows through
 * Local Network Access: every request is a plain fetch() marked `targetAddressSpace: "local"`
 * (that marking is what exempts it from mixed-content blocking), and the first one raises
 * Chrome's permission prompt. There are no WebSockets (LNA does not cover them), so the CRSF
 * parameter tunnel is POST + long-poll.
 *
 * An HttpConfigSession implements the same interface as the firmware web UI's
 * html/src/utils/transport.js (and the MockTransport in usbconfig.js), so the panels in
 * src/dashboard/ work unchanged.
 */

import {DeviceError, ERR_BUSY, ERR_PARSE, ERR_TOO_LARGE, ERR_UNSUPPORTED, ERR_INTERNAL, ERR_BAD_REQUEST} from './usbconfig.js'

/** Where each module type lives on its USB network link (lib/USBNet/usbnet.h). */
export const DEVICE_ADDRESSES = {TX: '10.73.1.1', RX: '10.73.2.1'}

const PROBE_TIMEOUT_MS = 1500
const DEFAULT_TIMEOUT_MS = 5000
// Saving a TX models import commits ~20 KB to the config flash.
const WRITE_TIMEOUT_MS = 15000
// How long a /crsf long-poll may wait on the device (capped there at 2000).
const CRSF_POLL_WAIT_MS = 1000
// Liveness: the device counts as gone after this many consecutive failed /hello probes.
const WATCHDOG_INTERVAL_MS = 2000
const WATCHDOG_FAILURES = 2

/**
 * The device could not be reached at all — as opposed to answering with an error. In a browser
 * every cause (not plugged in, old firmware, permission denied by Chrome or by macOS) surfaces as
 * the same TypeError, so the message lists what to check.
 */
export class DeviceUnreachableError extends Error {
  constructor(cause) {
    super(unreachableHelp())
    this.name = 'DeviceUnreachableError'
    this.cause = cause
  }
}

function isMac() {
  const platform = navigator.userAgentData?.platform || navigator.platform || ''
  return /mac/i.test(platform)
}

export function unreachableHelp() {
  const lines = [
    'Could not reach the device over its USB network connection. Check that:',
    '• it is plugged in and running TitanLRS firmware with USB network support (flash it once with DFU if not),',
    '• Chrome is allowed to access devices on your local network for this site (the prompt Chrome shows on the first connect; it can be changed from the site settings icon in the address bar),',
  ]
  if (isMac()) {
    lines.push('• macOS allows Chrome on the local network: System Settings → Privacy & Security → Local Network → turn on Google Chrome, then quit and reopen Chrome.')
  }
  return lines.join('\n')
}

// HTTP status -> the protocol error codes the UI already understands (DeviceError.code).
function errorCodeFor(status) {
  switch (status) {
    case 400: return ERR_PARSE
    case 404: return ERR_UNSUPPORTED
    case 409: return ERR_BUSY
    case 413: return ERR_TOO_LARGE
    case 500: return ERR_INTERNAL
    default: return ERR_BAD_REQUEST
  }
}

/** fetch() against the device, with a timeout and the Local Network Access marking. */
async function deviceFetch(url, {method = 'GET', body, timeout = DEFAULT_TIMEOUT_MS, contentType} = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const init = {
      method,
      signal: controller.signal,
      cache: 'no-store',
      // Chrome Local Network Access: names the target address space up front, which is what lets
      // an HTTPS page make this plain-HTTP request to a private address.
      targetAddressSpace: 'local',
    }
    if (body !== undefined) {
      init.body = body
      init.headers = {'Content-Type': contentType || 'application/json'}
    }
    return await fetch(url, init)
  } catch (e) {
    if (e?.name === 'AbortError') throw new DeviceUnreachableError(new Error('timed out'))
    throw new DeviceUnreachableError(e)
  } finally {
    clearTimeout(timer)
  }
}

async function throwIfError(resp) {
  if (resp.ok) return
  let message = `${resp.status} ${resp.statusText}`
  try {
    const doc = await resp.json()
    if (doc?.error) message = doc.error
  } catch { /* not JSON */ }
  throw new DeviceError(errorCodeFor(resp.status), message)
}

/** GET /hello at `address`; resolves with {address, hello} or null if nothing answers. */
async function probe(address, timeout = PROBE_TIMEOUT_MS) {
  try {
    const resp = await deviceFetch(`http://${address}/hello`, {timeout})
    if (!resp.ok) return null
    return {address, hello: await resp.json()}
  } catch {
    return null
  }
}

/**
 * Every TitanLRS device reachable on a USB network link right now, TX first.
 * `moduleType` ('TX' / 'RX') limits the search to that address.
 */
export async function discoverDevices({moduleType} = {}) {
  const addresses = moduleType ? [DEVICE_ADDRESSES[moduleType.toUpperCase()]] : Object.values(DEVICE_ADDRESSES)
  const found = await Promise.all(addresses.filter(Boolean).map((a) => probe(a)))
  return found.filter(Boolean)
}

/** Split a byte stream of back-to-back CRSF frames (sync/addr, len, type .. crc). */
function splitCrsfFrames(bytes) {
  const frames = []
  let i = 0
  while (i + 2 <= bytes.length) {
    const len = bytes[i + 1] + 2
    if (len < 4 || i + len > bytes.length) break
    frames.push(bytes.subarray(i, i + len))
    i += len
  }
  return frames
}

export class HttpConfigSession {
  constructor({timeout = DEFAULT_TIMEOUT_MS} = {}) {
    this.name = 'http'
    this.timeout = timeout
    this.address = null
    this.hello = null
    this.features = 0
    this.device = null          // no USBDevice: kept so callers reading device?.serialNumber cope

    this._closing = true
    this._lostCbs = []
    this._crsfCbs = []
    this._crsfPolling = false
    this._crsfSendQueue = Promise.resolve()
    this._watchdog = null
    this._watchdogFailures = 0
  }

  // ---- lifecycle -------------------------------------------------------------
  /**
   * Connect to the device at `address`, or to the first one found (`moduleType` narrows that).
   * Throws DeviceUnreachableError when nothing answers.
   */
  async connect({address = null, moduleType = null} = {}) {
    let found = null
    if (address) {
      found = await probe(address, this.timeout)
    } else {
      found = (await discoverDevices({moduleType}))[0] || null
    }
    if (!found) throw new DeviceUnreachableError(new Error('no device answered'))

    this.address = found.address
    this.hello = found.hello
    this.features = Number(found.hello.features) || 0
    this.hello['proto-version'] = found.hello['api-version']
    this._closing = false
    this._startWatchdog()
    return this.hello
  }

  async disconnect() {
    this._closing = true
    this._stopWatchdog()
    this._crsfCbs = []
  }

  /** Register a callback fired when the device goes away (unplugged, reboot). */
  onLost(cb) {
    this._lostCbs.push(cb)
    return () => {
      const i = this._lostCbs.indexOf(cb)
      if (i >= 0) this._lostCbs.splice(i, 1)
    }
  }

  get connected() {
    return !this._closing && this.address !== null
  }

  hasFeature(bit) {
    return (this.features & bit) !== 0
  }

  _url(path) {
    return `http://${this.address}${path}`
  }

  _notifyLost(reason) {
    if (this._closing) return
    this._closing = true
    this._stopWatchdog()
    this._lostCbs.slice().forEach((cb) => { try { cb(reason) } catch { /* ignore */ } })
  }

  _startWatchdog() {
    this._stopWatchdog()
    this._watchdogFailures = 0
    // There is no connection to drop, so a vanished device only shows up as requests failing.
    // Probe /hello now and then so the page notices an unplug or reboot even while idle.
    this._watchdog = setInterval(async () => {
      if (this._closing) return
      const ok = await probe(this.address)
      this._watchdogFailures = ok ? 0 : this._watchdogFailures + 1
      if (this._watchdogFailures >= WATCHDOG_FAILURES) this._notifyLost('Device disconnected')
    }, WATCHDOG_INTERVAL_MS)
  }

  _stopWatchdog() {
    if (this._watchdog) clearInterval(this._watchdog)
    this._watchdog = null
  }

  async _request(path, {method = 'GET', body, timeout, contentType} = {}) {
    if (this.address === null) throw new Error('Not connected')
    const resp = await deviceFetch(this._url(path), {method, body, timeout: timeout || this.timeout, contentType})
    await throwIfError(resp)
    return resp
  }

  async _json(path, opts) {
    return (await this._request(path, opts)).json()
  }

  /** POST a document; resolves with the device's status message. */
  async _post(path, body, {contentType = 'application/json', timeout = WRITE_TIMEOUT_MS} = {}) {
    const resp = await this._request(path, {method: 'POST', body, contentType, timeout})
    try {
      const doc = await resp.json()
      return doc?.status || ''
    } catch {
      return ''
    }
  }

  // ---- endpoints -------------------------------------------------------------
  getConfig({export: exportMode = false} = {}) {
    return this._json(exportMode ? '/config?export' : '/config')
  }

  getOptions() {
    return this._json('/options.json')
  }

  getHardware() {
    return this._json('/hardware.json')
  }

  async exportConfig({export: exportMode = true} = {}) {
    return (await this._request(exportMode ? '/config?export' : '/config')).text()
  }

  saveConfig(config) {
    return this._post('/config', JSON.stringify(config))
  }

  saveOptions(options) {
    // Firmware without FEATURE_OPTIONS_WRITE answers 404; the UI gates the save buttons on the
    // bit so that only ever happens to a hand-crafted request.
    return this._post('/options.json', JSON.stringify(options))
  }

  saveHardware(doc) {
    // Only offered when FEATURE_HARDWARE_WRITE is set. The device stores the layout and applies
    // it on the next boot.
    return this._post('/hardware.json', JSON.stringify(doc))
  }

  importConfig(jsonText) {
    return this._post('/import', jsonText)
  }

  previewButtonColors() {
    // No equivalent of the ESP /buttons live-preview endpoint; cosmetic only.
    return Promise.resolve()
  }

  async reboot() {
    await this._post('/reboot', '', {timeout: this.timeout})
    // The device goes away now; tell the page, as an unplug would.
    this._notifyLost('Device rebooting')
  }

  /**
   * Ask the device to reboot into its ROM DFU bootloader (FEATURE_DFU). The device answers and
   * then leaves the bus, so the session ends here: that is the expected outcome, not a lost
   * device.
   */
  async rebootToDfu() {
    await this._post('/dfu', '', {timeout: this.timeout})
    this._closing = true
    this._stopWatchdog()
  }

  async reset(flags = {config: true}) {
    const names = []
    if (flags.config || flags.model) names.push('config')
    if (flags.options) names.push('options')
    if (flags.hardware) names.push('hardware')
    await this._post(`/reset?${names.join('&')}`, '', {timeout: WRITE_TIMEOUT_MS})
    this._notifyLost('Device rebooting')
  }

  // ---- CRSF parameter tunnel -------------------------------------------------
  /**
   * Push one raw CRSF frame (sync byte through CRC) at the device. Fire-and-forget: replies
   * arrive through onCrsf(). Sends are chained so frames reach the device in the order the panel
   * issued them.
   */
  sendCrsf(frameBytes) {
    if (!this.connected) return Promise.reject(new Error('Not connected'))
    const body = frameBytes instanceof Uint8Array ? frameBytes : new Uint8Array(frameBytes)
    const send = () => this._request('/crsf', {method: 'POST', body, contentType: 'application/octet-stream'})
    const run = this._crsfSendQueue.then(send, send)
    this._crsfSendQueue = run.catch(() => {})
    return run.then(() => {})
  }

  /** Register a callback for inbound CRSF frames. Returns an unsubscribe, matching onLost(). */
  onCrsf(cb) {
    this._crsfCbs.push(cb)
    this._startCrsfPoll()
    return () => {
      const i = this._crsfCbs.indexOf(cb)
      if (i >= 0) this._crsfCbs.splice(i, 1)
    }
  }

  async _startCrsfPoll() {
    if (this._crsfPolling) return
    this._crsfPolling = true
    try {
      // The device holds each poll until it has frames or the wait runs out, so this loop is
      // idle on the wire most of the time. It also keeps the device's tunnel attached: the
      // device drops the tunnel once nobody has polled for a few seconds.
      while (this.connected && this._crsfCbs.length) {
        let resp
        try {
          resp = await this._request(`/crsf?wait=${CRSF_POLL_WAIT_MS}`,
            {timeout: CRSF_POLL_WAIT_MS + DEFAULT_TIMEOUT_MS})
        } catch {
          // The watchdog decides whether the device is gone; just back off and retry.
          await new Promise((r) => setTimeout(r, 500))
          continue
        }
        if (resp.status !== 200) continue
        const bytes = new Uint8Array(await resp.arrayBuffer())
        for (const frame of splitCrsfFrames(bytes)) {
          this._crsfCbs.slice().forEach((cb) => {
            try { cb(frame) } catch { /* a listener must not break the poll loop */ }
          })
        }
      }
    } finally {
      this._crsfPolling = false
    }
  }
}
