<script setup>
import {ref, watchPostEffect} from "vue";
import {resetState, store} from "../js/state.js";
import {generateFirmware} from "../js/firmware.js";
import {DeviceError, ERR_BUSY, FEATURE_DFU} from "../js/usbconfig.js";
import {discoverDevices, HttpConfigSession, unreachableHelp} from "../js/netconfig.js";
import {DFU_FILTER, findAuthorised, isSupported, requestDevice, waitForDfu} from "../js/dfu/usb.js";
import {DfuFlasher} from "../js/dfu/flasher.js";

const DFU_FLASH_LOG_PREFIX = '[DFUFlash]'

watchPostEffect(async (onCleanup) => {
  onCleanup(closeDevice)
  if (store.currentStep === 3) {
    const ok = await buildFirmware()
    if (ok) {
      await connect()
    }
  }
})

const files = {
  firmwareFiles: [],
  config: null,
  firmwareUrl: '',
  options: {},
  deviceType: null,
  radioType: undefined,
  txType: undefined
}

async function buildFirmware() {
  console.info(`${DFU_FLASH_LOG_PREFIX} buildFirmware:start`, {
    target: store.target?.target,
    platform: store.target?.config?.platform,
    version: store.version
  })
  try {
    const [binary, {config, firmwareUrl, options, deviceType, radioType, txType}] = await generateFirmware()

    files.firmwareFiles = binary
    files.firmwareUrl = firmwareUrl
    files.config = config
    files.options = options
    files.deviceType = deviceType
    files.radioType = radioType
    files.txType = txType
    fullErase.value = false
    console.info(`${DFU_FLASH_LOG_PREFIX} buildFirmware:complete`, {
      fileCount: binary.length,
      firmwareUrl,
      deviceType,
      flashMethod: store.options.flashMethod
    })
    return true
  } catch (error) {
    console.error(`${DFU_FLASH_LOG_PREFIX} buildFirmware:failed`, error)
    fetchFailedMessage.value = `Failed to fetch firmware files: ${error?.message ?? error}`
    fetchFailed.value = true
    return false
  }
}

let step = ref(1)
let enableFlash = ref(false)
let fullErase = ref(false)
let flashComplete = ref(false)
let failed = ref(false)
let log = ref([])
let selectingDevice = ref(false)
let needAuthorise = ref(false)

let noDevice = ref(false)
let noWebUsb = ref(false)
let fetchFailed = ref(false)
let fetchFailedMessage = ref('')

// The ROM bootloader we flash, and the running firmware's config session while we ask it to
// reboot into that bootloader.
let dfuDevice = null
let session = null
let flashing = false

let progress = ref(0)
let progressText = ref('')

const PHASE_LABELS = {
  erase: 'Erasing flash, please wait...',
  write: 'Writing firmware',
  verify: 'Verifying',
}

function writeln(line) {
  log.value.push(line)
}

function onUsbDisconnect(event) {
  // The bootloader dropping off once flashing has finished (it starts the firmware) or while the
  // flasher is driving it (the flasher reports that itself) is not a reason to start over.
  if (dfuDevice && event.device === dfuDevice && !flashing && !flashComplete.value) {
    console.warn(`${DFU_FLASH_LOG_PREFIX} device:disconnected`)
    closeDevice()
  }
}

async function closeSession() {
  if (session) {
    const s = session
    session = null
    try {
      await s.disconnect()
    } catch (error) {
    }
  }
}

async function closeDevice() {
  console.debug(`${DFU_FLASH_LOG_PREFIX} closeDevice:start`)
  if (isSupported()) navigator.usb.removeEventListener('disconnect', onUsbDisconnect)
  await closeSession()
  if (dfuDevice != null && !flashing) {
    try {
      await dfuDevice.close()
    } catch (error) {
    }
  }
  dfuDevice = null
  enableFlash.value = false
  flashComplete.value = false
  failed.value = false
  needAuthorise.value = false
  step.value = 1
  log.value = []
  progress.value = 0
  console.debug(`${DFU_FLASH_LOG_PREFIX} closeDevice:complete`)
}

/** A DFU device is in hand: read its flash layout and enable flashing. */
async function useDfuDevice(device) {
  dfuDevice = device
  needAuthorise.value = false
  navigator.usb.addEventListener('disconnect', onUsbDisconnect)
  writeln(`DFU device found: ${device.productName || 'STM32 BOOTLOADER'}`)
  try {
    const {size, sectors} = await DfuFlasher.probe(device)
    writeln(`Flash: ${Math.round(size / 1024)} KB, ${sectors} sectors`)
    enableFlash.value = true
    console.info(`${DFU_FLASH_LOG_PREFIX} connect:ready`, {size, sectors})
  } catch (e) {
    console.error(`${DFU_FLASH_LOG_PREFIX} connect:probe-failed`, e)
    writeln(e.message)
    failed.value = true
  }
}

/**
 * The running firmware answered on its USB network interface: ask it to reboot into its ROM
 * bootloader, then find that over WebUSB.
 */
async function rebootIntoDfu({address, hello}) {
  writeln(`Connecting to ${hello['product-name'] || 'TitanLRS device'} (${address})`)
  session = new HttpConfigSession()
  try {
    await session.connect({address})
  } catch (e) {
    console.error(`${DFU_FLASH_LOG_PREFIX} connect:config-failed`, e)
    session = null
    writeln(`Failed to connect to device: ${e?.message ?? e}`)
    failed.value = true
    return
  }
  if (!session.hasFeature(FEATURE_DFU)) {
    writeln('This firmware cannot enter DFU from the web flasher. Hold BOOT0 while plugging in the device to manually enter DFU mode, then press Select DFU Device.')
    await closeSession()
    needAuthorise.value = true
    return
  }
  try {
    await session.rebootToDfu()
  } catch (e) {
    console.warn(`${DFU_FLASH_LOG_PREFIX} connect:dfu-refused`, e)
    writeln(e instanceof DeviceError && e.code === ERR_BUSY
      ? 'Disarm the model and try again'
      : `The device did not enter DFU: ${e?.message ?? e}`)
    await closeSession()
    failed.value = true
    return
  }
  writeln('Rebooting into DFU…')
  await closeSession()

  const dfu = await waitForDfu(8000)
  if (!dfu) {
    // First time on this machine: the bootloader is a USB device this page has never been
    // granted, so it needs the chooser (and a click).
    writeln('Press Select DFU Device and pick the STM32 bootloader to continue')
    needAuthorise.value = true
    return
  }
  await useDfuDevice(dfu)
}

async function connect() {
  console.info(`${DFU_FLASH_LOG_PREFIX} connect:start`, {flashMethod: store.options.flashMethod})
  if (!isSupported()) {
    noWebUsb.value = true
    return
  }
  selectingDevice.value = true
  try {
    // Already in the bootloader (BOOT0, or a previous attempt) and granted to this page.
    const dfu = await findAuthorised([DFU_FILTER])
    if (dfu) {
      step.value++
      await useDfuDevice(dfu)
      return
    }

    // The running firmware, on its USB network interface. The address says which module type
    // answered, so look where this firmware's type lives first.
    const moduleType = files.deviceType === 'TX' || files.deviceType === 'RX' ? files.deviceType : null
    let found = await discoverDevices({moduleType})
    if (!found.length && moduleType) {
      const other = await discoverDevices()
      if (other.length) {
        step.value++
        writeln(`Found a ${other[0].hello['module-type']} module, but this firmware is for an ${moduleType}. Connect the ${moduleType} instead.`)
        failed.value = true
        return
      }
    }
    if (found.length) {
      step.value++
      await rebootIntoDfu(found[0])
      return
    }

    // Nothing answered: either the firmware predates USB networking, or the browser / OS is
    // blocking local network access. A board held in BOOT0 can still be picked by hand.
    step.value++
    unreachableHelp().split('\n').forEach(writeln)
    writeln('Or hold BOOT0 while plugging in the device, then press Select DFU Device.')
    needAuthorise.value = true
  } finally {
    selectingDevice.value = false
  }
}

async function authorise() {
  let device = null
  selectingDevice.value = true
  try {
    device = await requestDevice([DFU_FILTER])
  } catch {
    console.warn(`${DFU_FLASH_LOG_PREFIX} authorise:no-device-selected`)
    noDevice.value = true
  } finally {
    selectingDevice.value = false
  }
  if (device) await useDfuDevice(device)
}

async function another() {
  await closeDevice()
  await connect()
}

async function reset() {
  await closeDevice()
  resetState()
}

async function flash() {
  console.info(`${DFU_FLASH_LOG_PREFIX} flash:start`, {
    fullErase: fullErase.value,
    fileCount: files.firmwareFiles.length,
    platform: files.config?.platform
  })
  failed.value = false
  step.value++
  let lastProgressBucket = -1
  flashing = true
  try {
    progressText.value = 'erase'
    progress.value = 0
    const address = parseInt(files.config?.dfu?.address, 16)
    if (Number.isNaN(address)) throw new Error('This target has no DFU flash address (dfu.address)')
    await DfuFlasher.flash(dfuDevice, {address, data: files.firmwareFiles[0].data}, {
      fullErase: fullErase.value,
      log: writeln,
      onProgress: (percent, phase) => {
        progressText.value = phase
        progress.value = percent
        const progressBucket = Math.floor(percent / 10)
        if (progressBucket > lastProgressBucket || percent === 100) {
          lastProgressBucket = progressBucket
          console.info(`${DFU_FLASH_LOG_PREFIX} flash:progress`, {phase, progress: percent})
        }
      },
    })
    dfuDevice = null
    flashComplete.value = true
    step.value++
    console.info(`${DFU_FLASH_LOG_PREFIX} flash:complete`)
  } catch (e) {
    console.error(`${DFU_FLASH_LOG_PREFIX} flash:failed`, e)
    writeln(e?.message ?? String(e))
    failed.value = true
  } finally {
    flashing = false
  }
}
</script>

<template>
  <div class="hw-select">
    <div class="hw-select-title">
      <span class="td-h4">Flash Firmware File(s)</span>
      <span class="td-small td-dim">The firmware file(s) have been configured for your <b>{{ store.target?.config?.product_name }}</b> with the specified options.</span>
    </div>

    <VStepperVertical v-model="step" :hide-actions="true" flat>
      <VStepperVerticalItem title="Connect device" value="1" :hide-actions="true" :complete="step > 1"
                            :color="step > 1 ? 'green' : 'blue'">
        <VBtn @click="connect" color="primary" :disabled="selectingDevice">Connect</VBtn>
      </VStepperVerticalItem>
      <VStepperVerticalItem title="Enter flashing mode" value="2" :hide-actions="true" :complete="step > 2"
                            :color="step > 2 ? 'green' : (failed ? 'red' : 'blue')">
        <div class="td-flash-log-wrap">
          <template v-for="line in log">
            <div class="td-flash-log-line">{{ line }}</div>
          </template>
        </div>
        <VContainer v-if="failed || enableFlash || needAuthorise">
          <br/>
          <VRow v-if="needAuthorise && !failed">
            <VCol>
              <VBtn @click="authorise" color="primary" :disabled="selectingDevice">Select DFU Device</VBtn>
            </VCol>
          </VRow>
          <VRow v-if="enableFlash">
            <VCheckbox v-model="fullErase" label="Full chip erase"/>
          </VRow>
          <VRow>
            <VCol v-if="enableFlash && !failed">
              <VBtn @click="flash" color="primary">Flash</VBtn>
            </VCol>
            <VCol v-if="enableFlash && failed">
              <VBtn @click="flash" color="amber">Flash Anyway</VBtn>
            </VCol>
            <VCol v-if="failed">
              <VBtn @click="closeDevice" color="red">Try Again</VBtn>
            </VCol>
          </VRow>
        </VContainer>
      </VStepperVerticalItem>
      <VStepperVerticalItem title="Flashing" value="3" :hide-actions="true" :complete="flashComplete"
                            :color="flashComplete ? 'green' : (failed ? 'red' : 'blue')">
        <VRow>
          <VCol class="d-flex align-center flex-column flex-grow-0 flex-shrink-0">
            <VLabel>{{ PHASE_LABELS[progressText] || PHASE_LABELS.erase }}</VLabel>
            <br>
            <VProgressCircular :model-value="progress" :rotate="360" :size="100" :width="15"
                               :color="flashComplete ? 'green' : (failed ? 'red' : 'blue')">
              <template v-slot:default> {{ progress }} %</template>
            </VProgressCircular>
            <div v-if="failed">
              <VLabel>Flash failed</VLabel>
            </div>
            <VBtn v-if="failed" @click="closeDevice" color="red">Try Again</VBtn>
          </VCol>
          <VCol cols="1" class="flex-grow-1 flex-shrink-0"/>
        </VRow>
      </VStepperVerticalItem>
      <VStepperVerticalItem title="Done" value="4" :hide-actions="true" :complete="flashComplete"
                            :color="flashComplete ? 'green' : (failed ? 'red' : 'blue')">
        <VContainer>
          <VRow>
            <VCol>
              <VBtn v-if="flashComplete" @click="another" color="primary">Flash Another</VBtn>
            </VCol>
            <VCol>
              <VBtn v-if="flashComplete" @click="reset" color="secondary">Back to Start</VBtn>
            </VCol>
          </VRow>
        </VContainer>
      </VStepperVerticalItem>
    </VStepperVertical>

    <VSnackbar v-model="noDevice" vertical color="red-darken-3" content-class="td-error-snackbar">
      <div class="text-subtitle-1 pb-2">No Device Selected</div>

      <p>A USB device must be selected to perform flashing.</p>
      <template v-slot:actions>
        <VBtn variant="text" color="white" @click="noDevice = false">✕</VBtn>
      </template>
    </VSnackbar>

    <VSnackbar v-model="noWebUsb" vertical color="red-darken-3" content-class="td-error-snackbar">
      <div class="text-subtitle-1 pb-2">WebUSB Not Available</div>

      <p>USB DFU flashing needs WebUSB. Use Chrome or Edge on a desktop computer.</p>
      <template v-slot:actions>
        <VBtn variant="text" color="white" @click="noWebUsb = false">✕</VBtn>
      </template>
    </VSnackbar>

    <VSnackbar v-model="fetchFailed" vertical color="red-darken-3" content-class="td-error-snackbar">
      <div class="text-subtitle-1 pb-2">Firmware Fetch Failed</div>

      <p>{{ fetchFailedMessage }}</p>
      <template v-slot:actions>
        <VBtn variant="text" color="white" @click="fetchFailed = false">✕</VBtn>
      </template>
    </VSnackbar>
  </div>
</template>
