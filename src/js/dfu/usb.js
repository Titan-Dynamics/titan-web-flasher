/*
 * usb.js — WebUSB discovery of the STM32 ROM bootloader for DFU flashing. The running firmware is
 * reached over its USB network interface instead (netconfig.js), which is how it is asked to
 * reboot into the bootloader.
 */

/** STMicroelectronics ROM bootloader in DFU mode. */
export const DFU_FILTER = {vendorId: 0x0483, productId: 0xdf11}

export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.usb
}

function matches(device, filter) {
  return device.vendorId === filter.vendorId && device.productId === filter.productId
}

export function isDfu(device) {
  return !!device && matches(device, DFU_FILTER)
}

/** First already-authorised device matching any filter, or null. No chooser, no user gesture. */
export async function findAuthorised(filters) {
  if (!isSupported()) return null
  const devices = await navigator.usb.getDevices()
  return devices.find((d) => filters.some((f) => matches(d, f))) || null
}

/** The WebUSB chooser. Must be called from a click handler (user activation). */
export function requestDevice(filters) {
  return navigator.usb.requestDevice({filters})
}

/**
 * Wait for an authorised DFU device to appear (after the app rebooted into the bootloader).
 * Resolves with the device, or null on timeout — which on a first run means the bootloader has
 * never been authorised on this machine and needs the chooser.
 */
export function waitForDfu(timeoutMs = 8000, intervalMs = 500) {
  return new Promise((resolve) => {
    let done = false
    let timer = null
    let poller = null
    const finish = (device) => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearInterval(poller)
      navigator.usb.removeEventListener('connect', onConnect)
      resolve(device)
    }
    const onConnect = (event) => { if (isDfu(event.device)) finish(event.device) }
    const poll = () => findAuthorised([DFU_FILTER]).then((d) => { if (d) finish(d) }).catch(() => {})
    navigator.usb.addEventListener('connect', onConnect)
    poller = setInterval(poll, intervalMs)
    timer = setTimeout(() => finish(null), timeoutMs)
    poll()
  })
}
