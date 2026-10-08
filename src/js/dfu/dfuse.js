/*
 * dfuse.js — a USB DFU 1.1 + ST DfuSe client over WebUSB, for the STM32 ROM bootloader.
 *
 * Our own implementation of the procedure Betaflight's configurator uses (DfuSe "special
 * commands" for set-address / erase, DNLOAD/UPLOAD blocks from wBlockNum 2, GETSTATUS polling
 * honouring bwPollTimeout). Nothing is imported from Betaflight.
 *
 * References: USB DFU 1.1 specification; ST AN3156 (USB DFU protocol used in the STM32
 * bootloader).
 */

const DFU_DNLOAD = 1
const DFU_UPLOAD = 2
const DFU_GETSTATUS = 3
const DFU_CLRSTATUS = 4
const DFU_ABORT = 6

export const DFU_STATE = {
  appIDLE: 0, appDETACH: 1, dfuIDLE: 2, dfuDNLOAD_SYNC: 3, dfuDNBUSY: 4, dfuDNLOAD_IDLE: 5,
  dfuMANIFEST_SYNC: 6, dfuMANIFEST: 7, dfuMANIFEST_WAIT_RESET: 8, dfuUPLOAD_IDLE: 9, dfuERROR: 10,
}

const STATUS_NAMES = [
  'OK', 'errTARGET', 'errFILE', 'errWRITE', 'errERASE', 'errCHECK_ERASED', 'errPROG', 'errVERIFY',
  'errADDRESS', 'errNOTDONE', 'errFIRMWARE', 'errVENDOR', 'errUSBR', 'errPOR', 'errUNKNOWN',
  'errSTALLEDPKT',
]

const DFUSE_SET_ADDRESS = 0x21
const DFUSE_ERASE = 0x41

const USB_DT_CONFIG = 0x02
const USB_DT_STRING = 0x03
const USB_DT_INTERFACE = 0x04
const USB_DT_DFU_FUNCTIONAL = 0x21
const LANGID_EN_US = 0x0409

const DEFAULT_TRANSFER_SIZE = 2048
const CLAIM_RETRIES = 6
const CLAIM_RETRY_MS = 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function statusName(status) {
  return STATUS_NAMES[status] || `status ${status}`
}

/**
 * Parse a DfuSe memory-layout string, e.g. "@Internal Flash  /0x08000000/16*128Kg".
 * One name, then one or more "/address/spec,spec…" groups; each spec is "count*size[unit]type".
 * Returns {name, sectors: [{start, size, type}]} or null if the string is not a DfuSe layout.
 */
export function parseDfuSeLayout(desc) {
  if (!desc || desc[0] !== '@') return null
  const parts = desc.slice(1).split('/')
  if (parts.length < 3) return null
  const name = parts[0].trim()
  const sectors = []
  for (let i = 1; i + 1 < parts.length; i += 2) {
    let addr = parseInt(parts[i].trim(), 16)
    if (Number.isNaN(addr)) return null
    for (const spec of parts[i + 1].split(',')) {
      const m = /^\s*(\d+)\s*\*\s*(\d+)\s*([ BKM]?)\s*([a-g]?)\s*$/.exec(spec)
      if (!m) return null
      const count = parseInt(m[1], 10)
      const mult = {K: 1024, M: 1024 * 1024}[m[3]] || 1
      const size = parseInt(m[2], 10) * mult
      for (let n = 0; n < count; n++) {
        sectors.push({start: addr, size, type: m[4] || ''})
        addr += size
      }
    }
  }
  return {name, sectors}
}

/** Walk a raw configuration descriptor: per-interface alt settings plus the DFU functional descriptor. */
export function parseConfigDescriptor(bytes) {
  const alts = []
  let transferSize = null
  let i = 0
  while (i + 1 < bytes.length) {
    const len = bytes[i]
    const type = bytes[i + 1]
    if (len < 2) break
    if (type === USB_DT_INTERFACE && len >= 9) {
      alts.push({interfaceNumber: bytes[i + 2], alternateSetting: bytes[i + 3], iInterface: bytes[i + 8]})
    } else if (type === USB_DT_DFU_FUNCTIONAL && len >= 7) {
      transferSize = bytes[i + 5] | (bytes[i + 6] << 8)
    }
    i += len
  }
  return {alts, transferSize}
}

function le32(value) {
  return [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF]
}

export class DfuSeDevice {
  constructor(device) {
    this.device = device
    this.interfaceNumber = 0
    this.alternateSetting = 0
    this.transferSize = DEFAULT_TRANSFER_SIZE
    this.layout = null
    this._config = null
  }

  async open() {
    if (!this.device.opened) await this.device.open()
    if (this.device.configuration === null) await this.device.selectConfiguration(1)
    // The OS may still be settling the freshly attached bootloader; retry the claim for a while.
    let lastErr = null
    for (let attempt = 0; attempt < CLAIM_RETRIES; attempt++) {
      try {
        await this.device.claimInterface(this.interfaceNumber)
        return
      } catch (err) {
        lastErr = err
        console.info('[DFU] claimInterface failed, retrying', {attempt, err})
        await sleep(CLAIM_RETRY_MS)
      }
    }
    throw lastErr
  }

  async close() {
    try { await this.device.releaseInterface(this.interfaceNumber) } catch { /* ignore */ }
    try { await this.device.close() } catch { /* ignore */ }
  }

  // ---- descriptors -----------------------------------------------------------
  async _getDescriptor(type, index, langId, length) {
    const result = await this.device.controlTransferIn({
      requestType: 'standard', recipient: 'device', request: 0x06 /* GET_DESCRIPTOR */,
      value: (type << 8) | index, index: langId,
    }, length)
    if (result.status !== 'ok') throw new Error(`GET_DESCRIPTOR(${type}, ${index}) failed: ${result.status}`)
    return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
  }

  async _readConfig() {
    if (this._config) return this._config
    const head = await this._getDescriptor(USB_DT_CONFIG, 0, 0, 9)
    const total = head[2] | (head[3] << 8)
    const full = await this._getDescriptor(USB_DT_CONFIG, 0, 0, total)
    this._config = parseConfigDescriptor(full)
    return this._config
  }

  async _readString(index) {
    const raw = await this._getDescriptor(USB_DT_STRING, index, LANGID_EN_US, 255)
    const len = Math.min(raw[0], raw.length)
    let s = ''
    for (let i = 2; i + 1 < len; i += 2) s += String.fromCharCode(raw[i] | (raw[i + 1] << 8))
    return s
  }

  /** Find the "Internal Flash" alt setting, select it, and return its sector map. */
  async readFlashLayout() {
    const {alts} = await this._readConfig()
    let found = null
    for (const alt of alts) {
      if (alt.interfaceNumber !== this.interfaceNumber || !alt.iInterface) continue
      const desc = await this._readString(alt.iInterface)
      const layout = parseDfuSeLayout(desc)
      console.info('[DFU] alt setting', {alt: alt.alternateSetting, desc})
      if (layout && /internal flash/i.test(layout.name)) {
        found = {alt: alt.alternateSetting, layout}
        break
      }
    }
    if (!found) throw new Error('The DFU device does not report an "Internal Flash" memory layout')
    if (found.alt !== this.alternateSetting) {
      await this.device.selectAlternateInterface(this.interfaceNumber, found.alt)
      this.alternateSetting = found.alt
    }
    this.layout = found.layout
    return this.layout
  }

  async readTransferSize() {
    const {transferSize} = await this._readConfig()
    this.transferSize = transferSize || DEFAULT_TRANSFER_SIZE
    return this.transferSize
  }

  // ---- DFU primitives --------------------------------------------------------
  _setup(request, value) {
    return {requestType: 'class', recipient: 'interface', request, value, index: this.interfaceNumber}
  }

  async dnload(blockNum, data) {
    const result = await this.device.controlTransferOut(this._setup(DFU_DNLOAD, blockNum), data)
    if (result.status !== 'ok') throw new Error(`DFU_DNLOAD failed: ${result.status}`)
  }

  async upload(blockNum, length) {
    const result = await this.device.controlTransferIn(this._setup(DFU_UPLOAD, blockNum), length)
    if (result.status !== 'ok') throw new Error(`DFU_UPLOAD failed: ${result.status}`)
    return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
  }

  async getStatus() {
    const result = await this.device.controlTransferIn(this._setup(DFU_GETSTATUS, 0), 6)
    if (result.status !== 'ok' || result.data.byteLength < 6) {
      throw new Error(`DFU_GETSTATUS failed: ${result.status}`)
    }
    const d = result.data
    return {
      status: d.getUint8(0),
      pollTimeout: d.getUint8(1) | (d.getUint8(2) << 8) | (d.getUint8(3) << 16),
      state: d.getUint8(4),
    }
  }

  async clrStatus() {
    const result = await this.device.controlTransferOut(this._setup(DFU_CLRSTATUS, 0))
    if (result.status !== 'ok') throw new Error(`DFU_CLRSTATUS failed: ${result.status}`)
  }

  async abort() {
    const result = await this.device.controlTransferOut(this._setup(DFU_ABORT, 0))
    if (result.status !== 'ok') throw new Error(`DFU_ABORT failed: ${result.status}`)
  }

  /** Poll GETSTATUS until the device leaves its busy states; throws the DFU status name on dfuERROR. */
  async waitWhileBusy() {
    for (;;) {
      const st = await this.getStatus()
      if (st.state === DFU_STATE.dfuERROR) {
        await this.clrStatus().catch(() => {})
        throw new Error(statusName(st.status))
      }
      if (st.state !== DFU_STATE.dfuDNBUSY && st.state !== DFU_STATE.dfuMANIFEST) return st
      await sleep(Math.max(st.pollTimeout, 1))
    }
  }

  /** Bring the device to dfuIDLE from wherever a previous session left it. */
  async ensureIdle() {
    let st = await this.getStatus()
    if (st.state === DFU_STATE.dfuIDLE) return
    if (st.state === DFU_STATE.dfuERROR) await this.clrStatus()
    else await this.abort()
    st = await this.getStatus()
    if (st.state === DFU_STATE.dfuERROR) {
      await this.clrStatus()
      st = await this.getStatus()
    }
    if (st.state !== DFU_STATE.dfuIDLE) throw new Error(`DFU device is not idle (state ${st.state})`)
  }

  // ---- DfuSe commands --------------------------------------------------------
  async _special(bytes) {
    await this.dnload(0, new Uint8Array(bytes))
    return this.waitWhileBusy()
  }

  setAddress(address) {
    return this._special([DFUSE_SET_ADDRESS, ...le32(address)])
  }

  eraseSector(address) {
    return this._special([DFUSE_ERASE, ...le32(address)])
  }

  massErase() {
    return this._special([DFUSE_ERASE])
  }
}
