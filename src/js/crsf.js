/*
 * crsf.js — CRSF frame codec for the parameter tunnel.
 *
 * Ported essentially verbatim from the TitanLRS-Backpack web UI
 * (TitanLRS-Backpack/html/src/shared/scan.js, the `CRSF` object). That copy talks to a WiFi
 * coprocessor over a WebSocket; this one is fed by the WebUSB config session's TCFG_CRSF tunnel.
 * The codec itself is transport-agnostic and unchanged — see WEB_LUA_PARAMS_PLAN.md §7.1.
 *
 * The two copies are expected to diverge from here; the Backpack is reference only.
 */

export const CRSF = {
  SYNC_BYTE: 0xC8,
  CRC_POLY: 0xD5,

  // Frame types
  DEVICE_PING: 0x28,
  DEVICE_INFO: 0x29,
  PARAM_ENTRY: 0x2B,
  PARAM_READ: 0x2C,
  PARAM_WRITE: 0x2D,
  ELRS_STATUS: 0x2E,

  // Addresses
  ADDR_BROADCAST: 0x00,
  ADDR_USB: 0x10,
  ADDR_RADIO_TRANSMITTER: 0xEA,
  ADDR_RX: 0xEC,
  ADDR_TX: 0xEE,
  ADDR_ELRS_LUA: 0xEF,

  // Parameter types
  PARAM_TYPE_UINT8: 0x00,
  PARAM_TYPE_INT8: 0x01,
  PARAM_TYPE_UINT16: 0x02,
  PARAM_TYPE_INT16: 0x03,
  PARAM_TYPE_FLOAT: 0x08,
  PARAM_TYPE_TEXT_SELECTION: 0x09,
  PARAM_TYPE_STRING: 0x0A,
  PARAM_TYPE_FOLDER: 0x0B,
  PARAM_TYPE_INFO: 0x0C,
  PARAM_TYPE_COMMAND: 0x0D,
  PARAM_HIDDEN: 0x80,

  /** CRC-8/DVB-S2 over the given bytes. */
  calculateCRC(data) {
    let crc = 0
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i]
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x80) ? ((crc << 1) ^ this.CRC_POLY) : (crc << 1)
        crc &= 0xFF
      }
    }
    return crc
  },

  /** Build an extended-addressing CRSF frame (type >= 0x28). */
  buildFrame(type, dest, origin, payload) {
    const payloadLen = payload ? payload.length : 0
    const length = 4 + payloadLen        // type + dest + origin + payload + crc
    const frame = new Uint8Array(2 + length)
    frame[0] = this.SYNC_BYTE
    frame[1] = length
    frame[2] = type
    frame[3] = dest
    frame[4] = origin
    if (payloadLen > 0) frame.set(payload, 5)
    frame[2 + length - 1] = this.calculateCRC(frame.slice(2, 2 + length - 1))
    return frame
  },

  /** Parse one frame; returns {type, dest, origin, payload} or null. */
  parseFrame(data) {
    if (data.length < 4 || data[0] !== this.SYNC_BYTE) return null
    const length = data[1]
    if (data.length < length + 2) return null
    const type = data[2]
    let dest = 0, origin = 0, payload
    if (type >= 0x28) {
      dest = data[3]
      origin = data[4]
      payload = data.slice(5, length + 1)   // excludes the trailing CRC
    } else {
      payload = data.slice(3, length + 1)
    }
    return {type, dest, origin, payload}
  },

  /** Read a null-terminated string, returning the value and the offset past the terminator. */
  readString(data, offset) {
    let str = ''
    let i = offset
    while (i < data.length && data[i] !== 0) {
      str += String.fromCharCode(data[i])
      i++
    }
    return {value: str, nextOffset: i + 1}
  },
}

export default CRSF
