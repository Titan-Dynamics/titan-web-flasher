/*
 * flasher.js — erase / write / verify / leave over DfuSe, with progress.
 */

import {DfuSeDevice} from './dfuse.js'

/** Progress bands per phase, as [start, end] percentages. */
const PHASES = {
  normal: {erase: [0, 20], write: [20, 70], verify: [70, 100]},
  fullErase: {erase: [0, 35], write: [35, 75], verify: [75, 100]},
}

function hex(n) {
  return '0x' + n.toString(16).padStart(8, '0')
}

/** Turn whatever WebUSB threw into the one message the page shows. */
export function describeDfuError(err) {
  const msg = (err && err.message) || String(err)
  const name = err && err.name
  if (name === 'SecurityError') {
    return 'Access to the USB device was denied. On Linux, add udev rules for 1209:0001 and 0483:df11.'
  }
  if (name === 'NetworkError' || name === 'NotFoundError' || /disconnected|device was lost/i.test(msg)) {
    return 'The DFU device disconnected during flashing. Reconnect it (hold BOOT0 and tap RESET if needed) and try again.'
  }
  return msg
}

async function openOrExplain(dfu) {
  try {
    await dfu.open()
  } catch (err) {
    if (err && err.name === 'SecurityError') throw err
    const win = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
    throw new Error(win
      ? "Could not open the DFU device. Install the WinUSB driver for 'STM32 BOOTLOADER' (e.g. with Zadig) and try again."
      : `Could not open the DFU device: ${(err && err.message) || err}`)
  }
}

export class DfuFlasher {
  /** Open the bootloader, read its flash layout, and close it again. Throws one readable Error. */
  static async probe(device) {
    const dfu = new DfuSeDevice(device)
    try {
      await openOrExplain(dfu)
      const layout = await dfu.readFlashLayout()
      const size = layout.sectors.reduce((n, s) => n + s.size, 0)
      return {layout, size, sectors: layout.sectors.length}
    } catch (err) {
      console.info('[DFU] probe failed', {err})
      throw new Error(describeDfuError(err))
    } finally {
      await dfu.close()
    }
  }


  /**
   * @param {USBDevice} device the ROM bootloader (0483:df11)
   * @param {{address: number, data: Uint8Array}} image
   * @param {{fullErase?: boolean, onProgress?: function(number, string), log?: function(string)}} opts
   */
  static async flash(device, {address, data}, {fullErase = false, onProgress = () => {}, log = () => {}} = {}) {
    const dfu = new DfuSeDevice(device)
    const bands = fullErase ? PHASES.fullErase : PHASES.normal
    const report = (phase, fraction) => {
      const [a, b] = bands[phase]
      onProgress(Math.round(a + (b - a) * Math.min(1, Math.max(0, fraction))), phase)
    }
    let leaving = false
    try {
      // 1. Open and learn the target.
      await openOrExplain(dfu)
      const layout = await dfu.readFlashLayout()
      const transferSize = await dfu.readTransferSize()
      await dfu.ensureIdle()
      console.info('[DFU] target', {layout, transferSize})

      // 2. Bounds.
      const end = address + data.length
      const sectors = layout.sectors
      const flashStart = sectors[0].start
      const last = sectors[sectors.length - 1]
      const flashEnd = last.start + last.size
      if (data.length === 0) throw new Error('The firmware image is empty')
      if (address < flashStart || end > flashEnd) {
        throw new Error(`The firmware (${hex(address)}..${hex(end)}) does not fit the device flash `
                        + `(${hex(flashStart)}..${hex(flashEnd)})`)
      }

      // 3. Erase.
      if (fullErase) {
        log('Erasing the whole flash')
        report('erase', 0)
        await dfu.massErase()
        report('erase', 1)
      } else {
        const toErase = sectors.filter((s) => s.start < end && s.start + s.size > address)
        log(`Erasing ${toErase.length} sector(s)`)
        for (let i = 0; i < toErase.length; i++) {
          report('erase', i / toErase.length)
          await dfu.eraseSector(toErase[i].start)
        }
        report('erase', 1)
      }

      // 4. Write. The ROM places block n at address + (n - 2) * transferSize.
      log(`Writing ${data.length} bytes at ${hex(address)}`)
      await dfu.setAddress(address)
      const blocks = Math.ceil(data.length / transferSize)
      for (let i = 0; i < blocks; i++) {
        report('write', i / blocks)
        await dfu.dnload(i + 2, data.subarray(i * transferSize, (i + 1) * transferSize))
        await dfu.waitWhileBusy()
      }
      report('write', 1)

      // 5. Verify. UPLOAD is only accepted from dfuIDLE, so drop out of dfuDNLOAD-IDLE first.
      log('Verifying')
      await dfu.ensureIdle()
      await dfu.setAddress(address)
      await dfu.ensureIdle()
      for (let i = 0; i < blocks; i++) {
        report('verify', i / blocks)
        const want = data.subarray(i * transferSize, (i + 1) * transferSize)
        const got = await dfu.upload(i + 2, want.length)
        if (got.length !== want.length) {
          throw new Error(`Verify failed at offset ${hex(i * transferSize)}: short read`)
        }
        for (let j = 0; j < want.length; j++) {
          if (got[j] !== want[j]) throw new Error(`Verify failed at offset ${hex(i * transferSize + j)}`)
        }
      }
      report('verify', 1)

      // 6. Leave: set the jump address, zero-length DNLOAD, one GETSTATUS to trigger it. The ROM
      // starts the application without completing that last GETSTATUS, so an error or a
      // disconnect from here on is the expected outcome.
      log('Starting the firmware')
      await dfu.ensureIdle()
      await dfu.setAddress(address)
      leaving = true
      try {
        await dfu.dnload(0, new Uint8Array(0))
        await dfu.getStatus()
      } catch (err) {
        console.info('[DFU] leave ended with an error (expected)', {err})
      }
      await dfu.close()
    } catch (err) {
      await dfu.close()
      if (leaving) return
      console.info('[DFU] flash failed', {err})
      throw new Error(describeDfuError(err))
    }
  }
}
