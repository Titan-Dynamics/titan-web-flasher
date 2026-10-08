/*
 * usbconfig.js — shared definitions for the TitanLRS device config API, and the MockTransport.
 *
 * The real transport is HttpConfigSession in netconfig.js: STM32 firmware serves the config API
 * over HTTP on its USB network interface (TitanLRS/src/lib/USBConfig/usbcfg_api.h). The feature
 * bits below are the `features` bitmask of GET /hello; keep them in sync with that header.
 */

// Only used by MockTransport's canned parameter tree; the real transport is codec-agnostic.
import {CRSF} from './crsf.js'

/** API version reported by the current firmware (/hello "api-version"). */
export const PROTOCOL_VERSION = 2

export const FEATURE_OPTIONS_WRITE = 1 << 0
export const FEATURE_CW = 1 << 1
export const FEATURE_LR1121_UPDATE = 1 << 2
export const FEATURE_CRSF_PARAMS = 1 << 3
export const FEATURE_DFU = 1 << 4
export const FEATURE_HARDWARE_WRITE = 1 << 5

/* DeviceError codes. The HTTP transport maps response statuses onto these, so callers can keep
 * testing e.g. `code === ERR_BUSY` (module armed) regardless of transport. */
export const ERR_UNSUPPORTED = 1
export const ERR_BUSY = 2
export const ERR_BAD_REQUEST = 3
export const ERR_TOO_LARGE = 4
export const ERR_PARSE = 5
export const ERR_NO_SESSION = 6
export const ERR_INTERNAL = 7

const ERR_NAMES = {
  [ERR_UNSUPPORTED]: 'UNSUPPORTED', [ERR_BUSY]: 'BUSY', [ERR_BAD_REQUEST]: 'BAD_REQUEST',
  [ERR_TOO_LARGE]: 'TOO_LARGE', [ERR_PARSE]: 'PARSE', [ERR_NO_SESSION]: 'NO_SESSION',
  [ERR_INTERNAL]: 'INTERNAL',
}

/** The device answered, with an error. */
export class DeviceError extends Error {
  constructor(code, message) {
    super(`${ERR_NAMES[code] || 'ERR' + code}: ${message}`)
    this.code = code
    this.deviceMessage = message
  }
}

// ---------------------------------------------------------------------------------------
// MockTransport — hardware-free dashboard development. Selected with ?mock=tx|rx.
// Fixtures mirror TitanLRS/src/html/dev-mock-plugin.js, minus the ESP-only bits an STM32
// device never reports (no ssid, mode is "USB", no pwm array, no serial1-protocol).
// ---------------------------------------------------------------------------------------
/*
 * A canned CRSF parameter tree, so the Parameters tab is developable without hardware. Shaped
 * like a real ELRS TX tree: a couple of selections at the root, a folder, a command and an info
 * field, which between them exercise every control the panel renders.
 */
const MOCK_PARAMS = [
  null,
  {number: 1, parent: 0, type: CRSF.PARAM_TYPE_TEXT_SELECTION, name: 'Packet Rate', value: 3,
   options: ['50Hz', '100Hz Full', '150Hz', '250Hz', '500Hz'], unit: ''},
  {number: 2, parent: 0, type: CRSF.PARAM_TYPE_TEXT_SELECTION, name: 'Telem Ratio', value: 0,
   options: ['Std', 'Off', '1:128', '1:64', '1:32', '1:16', '1:8', '1:4', '1:2', 'Race'], unit: ''},
  {number: 3, parent: 0, type: CRSF.PARAM_TYPE_TEXT_SELECTION, name: 'Switch Mode', value: 1,
   options: ['Wide', 'Hybrid', '16ch Rate/2'], unit: ''},
  {number: 4, parent: 0, type: CRSF.PARAM_TYPE_FOLDER, name: 'TX Power'},
  {number: 5, parent: 4, type: CRSF.PARAM_TYPE_TEXT_SELECTION, name: 'Max Power', value: 2,
   options: ['10', '25', '50', '100', '250'], unit: 'mW'},
  {number: 6, parent: 4, type: CRSF.PARAM_TYPE_UINT8, name: 'Fan Runtime', value: 30,
   min: 0, max: 240, def: 30, unit: 's'},
  {number: 7, parent: 0, type: CRSF.PARAM_TYPE_COMMAND, name: 'Bind', status: 0, timeout: 50,
   value: 'Bind'},
  {number: 8, parent: 0, type: CRSF.PARAM_TYPE_INFO, name: 'Bad/Good', value: '0/100'},
]

/* A second, smaller tree standing in for a linked receiver, so the Parameters tab's stacked
 * per-device layout is developable without a radio link. */
const MOCK_RX_PARAMS = [
  null,
  {number: 1, parent: 0, type: CRSF.PARAM_TYPE_TEXT_SELECTION, name: 'Telemetry Power', value: 1,
   options: ['10', '25', '50', '100'], unit: 'mW'},
  {number: 2, parent: 0, type: CRSF.PARAM_TYPE_TEXT_SELECTION, name: 'Ant. Mode', value: 0,
   options: ['Gemini', 'Antenna 1', 'Antenna 2', 'Switch'], unit: ''},
  {number: 3, parent: 0, type: CRSF.PARAM_TYPE_UINT8, name: 'Model Id', value: 255,
   min: 0, max: 255, def: 255, unit: ''},
  {number: 4, parent: 0, type: CRSF.PARAM_TYPE_COMMAND, name: 'Bind', status: 0, timeout: 50,
   value: 'Bind'},
  {number: 5, parent: 0, type: CRSF.PARAM_TYPE_INFO, name: 'Firmware', value: '4.0.0-mock'},
]

function mockEncodeParam(p) {
  const bytes = [p.parent, p.type]
  const pushStr = (s) => { for (const ch of String(s || '')) bytes.push(ch.charCodeAt(0) & 0xFF); bytes.push(0) }
  pushStr(p.name)
  switch (p.type) {
    case CRSF.PARAM_TYPE_TEXT_SELECTION:
      pushStr(p.options.join(';'))
      bytes.push(p.value, 0, p.options.length - 1, p.value)
      pushStr(p.unit)
      break
    case CRSF.PARAM_TYPE_UINT8:
      bytes.push(p.value, p.min, p.max, p.def)
      pushStr(p.unit)
      break
    case CRSF.PARAM_TYPE_COMMAND:
      bytes.push(p.status, p.timeout)
      pushStr(p.value)
      break
    case CRSF.PARAM_TYPE_INFO:
    case CRSF.PARAM_TYPE_STRING:
      pushStr(p.value)
      break
    default:                       // folders carry nothing past the name
      break
  }
  return new Uint8Array(bytes)
}

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

/* The Part C TX layout (TD LR2021 STM32H7 Gemini TX), as a unified STM32 build reports it. */
const MOCK_HARDWARE = {
  serial_rx: 'PB10', serial_tx: 'PB10',
  radio_nss: 'PE0', radio_sck: 'PE12', radio_miso: 'PE13', radio_mosi: 'PE14',
  radio_rst: 'PE7', radio_dio1: 'PE1', radio_busy: 'PE9',
  radio_nss_2: 'PE8', radio_rst_2: 'PE5', radio_dio1_2: 'PE6', radio_busy_2: 'PE15',
  radio_dcdc: true,
  config_flash_cs: 'PD6', config_flash_sck: 'PB3', config_flash_miso: 'PB4', config_flash_mosi: 'PD7',
  led_red: 'PE3',
  button: 'PE2', button_active_high: true,
  power_min: 0, power_high: 3, power_max: 3, power_default: 0,
  power_control: 0,
  power_values: [19, 25, 31, 37],
  power_values2: [19, 25, 31, 37],
  power_values_dual: [0, 8, 16, 24],
}
const MOCK_CONFIG_FLASH_KEYS = ['config_flash_cs', 'config_flash_sck', 'config_flash_miso', 'config_flash_mosi']

export class MockTransport {
  constructor(moduleType = 'tx') {
    this.name = 'mock'
    this.isTx = moduleType.toLowerCase() === 'tx'
    // Current firmware persists options; `?mock=tx&ro` clears the bit so the read-only
    // rendering (what old firmware in the field still reports) stays testable.
    const params = new URLSearchParams(window.location.search)
    const readOnly = params.has('ro')
    // `&nohw` clears the hardware-override bit, i.e. firmware without config-flash storage.
    const noHardware = params.has('nohw')
    this.features = (readOnly ? 0 : FEATURE_OPTIONS_WRITE) | FEATURE_CRSF_PARAMS | FEATURE_DFU |
                    (noHardware ? 0 : FEATURE_HARDWARE_WRITE)
    this.doc = mockDocument(this.isTx)
    // The flashed (slot) layout and the stored override, mirroring the firmware's boot rule:
    // an override replaces the layout except for the config-flash pins.
    this.slotHardware = {...MOCK_HARDWARE, ...(this.isTx ? {} : {serial_rx: 'PB11'})}
    this.hardwareOverride = null
    this._crsfCbs = []
    // The CRSF bus as the browser sees it: the module on the cable, plus — on a TX — the
    // receiver reachable over the air through it, which is what the stacked Parameters cards are
    // for. An RX plugged in directly is alone on the bus.
    this._crsfDevices = this.isTx
      ? [{address: CRSF.ADDR_TX, name: this.doc.settings.product_name,
          params: JSON.parse(JSON.stringify(MOCK_PARAMS))},
         {address: CRSF.ADDR_RX, name: 'RM XR4',
          params: JSON.parse(JSON.stringify(MOCK_RX_PARAMS))}]
      : [{address: CRSF.ADDR_RX, name: this.doc.settings.product_name,
          params: JSON.parse(JSON.stringify(MOCK_RX_PARAMS))}]
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
  async rebootToDfu() {}
  async reset(flags = {}) {
    if (flags.hardware) {
      this.hardwareOverride = null
      this.doc.settings.custom_hardware = false
    }
  }

  async getHardware() {
    return JSON.parse(JSON.stringify(this.hardwareOverride || this.slotHardware))
  }
  async saveHardware(doc) {
    if (!this.hasFeature(FEATURE_HARDWARE_WRITE)) throw new Error('UNSUPPORTED: no config flash')
    // Applied as the firmware does at the next boot (the mock has no boot, so straight away).
    const effective = {...doc}
    for (const k of MOCK_CONFIG_FLASH_KEYS) {
      if (this.slotHardware[k] !== undefined) effective[k] = this.slotHardware[k]
      else delete effective[k]
    }
    effective.customised = true
    this.hardwareOverride = effective
    this.doc.settings.custom_hardware = true
    return 'Hardware updated - reboot to apply'
  }

  // ---- CRSF tunnel ----------------------------------------------------------
  onCrsf(cb) {
    this._crsfCbs.push(cb)
    return () => {
      const i = this._crsfCbs.indexOf(cb)
      if (i >= 0) this._crsfCbs.splice(i, 1)
    }
  }

  _emit(device, type, payload) {
    // Answer on a later task, as a real device would — a synchronous reply would let the panel
    // pass tests it would fail against hardware.
    const frame = CRSF.buildFrame(type, CRSF.ADDR_RADIO_TRANSMITTER, device.address, payload)
    setTimeout(() => this._crsfCbs.slice().forEach((cb) => cb(frame)), 15)
  }

  async sendCrsf(frameBytes) {
    const frame = CRSF.parseFrame(frameBytes)
    if (!frame) return

    if (frame.type === CRSF.DEVICE_PING) {
      // A broadcast ping is answered by every device on the bus; a directed one only by its
      // target. Same rule the router applies.
      for (const device of this._crsfDevices) {
        if (frame.dest !== CRSF.ADDR_BROADCAST && frame.dest !== device.address) continue
        const info = [...device.name].map((c) => c.charCodeAt(0)).concat([0])
        // serial 'ELRS', then hardware/firmware ids, parameter count and protocol version
        info.push(0x45, 0x4C, 0x52, 0x53, 0, 0, 0, 1, 0, 0, 0, 1,
                  device.params.length - 1, 0)
        this._emit(device, CRSF.DEVICE_INFO, new Uint8Array(info))
      }
      return
    }

    const device = this._crsfDevices.find((d) => d.address === frame.dest)
    if (!device) return

    if (frame.type === CRSF.PARAM_READ) {
      const p = device.params[frame.payload[0]]
      if (!p) return
      // One chunk each: the whole canned tree fits. Chunk reassembly only gets exercised
      // against hardware, where the endpoint actually splits.
      this._emit(device, CRSF.PARAM_ENTRY, this._entryFor(p))
      return
    }

    if (frame.type === CRSF.PARAM_WRITE) {
      const number = frame.payload[0]
      const value = frame.payload[1]
      if (number === 0) {
        // The link-status poll. Only an ELRS TX answers it; on a receiver parameter 0 has no
        // callback and nothing happens, which is what the panel expects.
        if (device.address === CRSF.ADDR_TX) {
          // badPkt, goodPkt (BE u16), flags, message
          this._emit(device, CRSF.ELRS_STATUS, new Uint8Array([0, 0, 100, 0x01, 0]))
        }
        return
      }
      const p = device.params[number]
      if (!p) return
      if (p.type === CRSF.PARAM_TYPE_COMMAND) {
        // A command write is answered with the parameter itself (the firmware's
        // pushResponseChunk path); report "stopped" straight away, which is what a command with
        // nothing left to do looks like.
        p.status = 0
        this._emit(device, CRSF.PARAM_ENTRY, this._entryFor(p))
        return
      }
      // A plain write is NOT acknowledged — the panel re-reads the affected fields afterwards,
      // exactly as it must against real firmware.
      p.value = value
    }
  }

  _entryFor(p) {
    const body = mockEncodeParam(p)
    const out = new Uint8Array(2 + body.length)
    out[0] = p.number
    out[1] = 0                       // chunksRemaining
    out.set(body, 2)
    return out
  }
}
