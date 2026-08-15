/*
 * transport.js (dashboard copy) — injection-only.
 *
 * The firmware's copy of this file (TitanLRS/src/html/src/utils/transport.js) defaults to HTTP
 * against the device's own web server. In the flasher there is no such server: the transport is
 * always injected by initDashboard() from src/dashboard/index.js, normally a UsbConfigSession
 * from src/js/usbconfig.js (or a MockTransport in dev).
 *
 * The exported surface is identical to the firmware copy, so the panels are byte-compatible.
 * NOTHING in src/dashboard/ may reach the network directly — see PORTING.md for the guard grep.
 */

function notConnected() {
  return Promise.reject(new Error('No device connected'))
}

const nullTransport = {
  name: 'none',
  getConfig: notConnected,
  saveConfig: notConnected,
  saveOptions: notConnected,
  importConfig: notConnected,
  previewButtonColors: () => Promise.resolve(),
  reboot: notConnected,
  reset: notConnected,
  exportConfig: notConnected,
  sendCrsf: notConnected,
  onCrsf: () => () => {},
}

let current = nullTransport

export function setTransport(impl) {
  current = impl || nullTransport
}

export function getTransport() {
  return current
}

/** Dashboard-only: tell the Vue shell an expected device reset is about to happen. */
export function notifyRebooting() {
  window.dispatchEvent(new CustomEvent('td-device-rebooting'))
}

export const transport = {
  get name() { return current.name },
  getConfig: (...a) => current.getConfig(...a),
  saveConfig: (...a) => current.saveConfig(...a),
  saveOptions: (...a) => current.saveOptions(...a),
  importConfig: (...a) => current.importConfig(...a),
  previewButtonColors: (...a) => (current.previewButtonColors ? current.previewButtonColors(...a) : Promise.resolve()),
  // reboot/reset drop the USB port as the device resets. Announce it so the Vue shell shows
  // "rebooting — reconnect" instead of treating the re-enumeration as a lost connection.
  // (The firmware copy just reloads the page, which has no WebUSB equivalent.)
  reboot: (...a) => { notifyRebooting(); return current.reboot(...a) },
  reset: (...a) => { notifyRebooting(); return current.reset(...a) },
  exportConfig: (...a) => current.exportConfig(...a),
  // The CRSF parameter tunnel. Unlike everything else here it is asynchronous in both
  // directions: sendCrsf() is fire-and-forget and replies arrive through onCrsf().
  sendCrsf: (...a) => (current.sendCrsf ? current.sendCrsf(...a) : notConnected()),
  onCrsf: (cb) => (current.onCrsf ? current.onCrsf(cb) : () => {}),
}

export async function downloadExport(filename, opts = {export: true}) {
  const text = await transport.exportConfig(opts)
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
