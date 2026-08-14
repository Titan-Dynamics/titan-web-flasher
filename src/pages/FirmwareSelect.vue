<script setup>
import {onMounted, ref} from 'vue';
import {store} from '../js/state';
import HoverCard from '../components/HoverCard.vue';

import controllerIcon from '../assets/brand/controller-icon.png';
import radioIcon from '../assets/brand/radio-icon.png';
import moduleIcon from '../assets/brand/module-icon.png';
import vrxIcon from '../assets/brand/video-receiver-combined-icon.png';

const emit = defineEmits(['onClick']);

const connecting = ref(false);
const webUsbSupported = ref(true);
const mockParam = new URLSearchParams(window.location.search).get('mock');

onMounted(async () => {
  // Warm the chunk so the click handler below reaches requestDevice() without spending its
  // transient user activation on a network fetch.
  const usb = await import('../js/usbconfig.js');
  webUsbSupported.value = usb.isWebUsbSupported() || !!mockParam;
});

/**
 * Open the device and hand the live session to the dashboard.
 *
 * The WebUSB device chooser requires transient user activation, so it has to be raised from
 * this click — which is why the session is opened here rather than after the dashboard mounts.
 */
async function connectDevice() {
  if (connecting.value) return;
  store.usbError = '';
  connecting.value = true;
  try {
    const usb = await import('../js/usbconfig.js');
    const session = mockParam
      ? new usb.MockTransport(mockParam)
      : new usb.UsbConfigSession();
    // WebUSB permission persists per origin, so a device the user has granted before can be
    // reopened without raising the chooser again.
    const known = mockParam ? [] : await usb.getKnownDevices();
    await session.connect(known.length === 1 ? known[0] : null);
    store.usbSession = session;
    store.view = 'dashboard';
    emit('onClick');
  } catch (err) {
    // Dismissing the device chooser is not an error worth reporting.
    if (!(err && err.name === 'NotFoundError')) {
      store.usbError = (err && err.message) || String(err);
    }
  } finally {
    connecting.value = false;
  }
}

// Set firmware and targetType in state store, then update page to pages selection page
function setFirmware(firmware, targetType) {
  store.firmware = firmware;
  store.targetType = targetType;
  emit('onClick');
}
</script>

<template>
  <div class="firmware-grid">
    <div class="containerMain firmware-group">
      <div class="containerHeader">
        <VCardTitle>Main Firmware</VCardTitle>
      </div>
      <VRow class="firmware-row firmware-options" no-gutters>
        <VCol cols="12" md="12">
        <HoverCard min-height="100%" @click="setFirmware('firmware', 'tx')"
                    :image="controllerIcon" :hover-image="controllerIcon"
                    title="Transmitter"
                    text="Install or update the main TitanLRS firmware on any compatible Transmitter module.
                    Internal and external modules supported."/>
        </VCol>
        <VCol cols="12" md="12">
        <HoverCard min-height="100%" @click="setFirmware('firmware', 'rx')"
                    :image="radioIcon" :hover-image="radioIcon"
                    title="Receiver"
                    text="Install or update the main TitanLRS firmware on any compatible Receiver. Serial and PWM
                    Receivers supported."/>
        </VCol>
      </VRow>
    </div>
    <div class="containerMain firmware-group">
      <div class="containerHeader">
        <VCardTitle>Backpack Firmware</VCardTitle>
      </div>
      <VRow class="firmware-row firmware-options" no-gutters>
        <VCol cols="12" md="12">
        <HoverCard min-height="100%" @click="setFirmware('backpack', 'txbp')"
                    :image="moduleIcon" :hover-image="moduleIcon"
                    title="Transmitter Backpack"
                    text="Install or update the firmware on the secondary Backpack module inside the Transmitter."/>
        </VCol>
        <VCol cols="12" md="12">
        <HoverCard min-height="100%" @click="setFirmware('backpack', 'vrx')"
                    :image="vrxIcon" :hover-image="vrxIcon"
                    title="Backpack Receiver"
                    text="Install or update the firmware on a Backpack receiver. For example: A VRX Backpack RX."/>
        </VCol>
      </VRow>
    </div>
    <div class="containerMain firmware-group firmware-group--wide">
      <div class="containerHeader">
        <VCardTitle>Device Configuration</VCardTitle>
      </div>
      <VAlert v-if="store.usbError" type="error" variant="tonal" class="dashboard-alert"
              closable @click:close="store.usbError = ''">
        {{ store.usbError }}
      </VAlert>
      <VAlert v-else-if="!webUsbSupported" type="warning" variant="tonal" class="dashboard-alert">
        This browser does not support WebUSB. Use Chrome, Edge or another Chromium-based
        browser to configure a device over USB.
      </VAlert>
      <VRow class="firmware-row firmware-options" no-gutters>
        <VCol cols="12" md="12">
          <HoverCard min-height="100%" :interactive="false"
                     :image="moduleIcon" :hover-image="moduleIcon"
                     title="USB Device Config"
                     text="Connect a TitanLRS device over USB
                     and click &quot;Connect to Device&quot; to edit the settings straight from the browser.">
            <template #action>
              <VBtn color="primary" size="large" :loading="connecting"
                    :disabled="!webUsbSupported" @click="connectDevice">
                Connect to Device
              </VBtn>
            </template>
          </HoverCard>
        </VCol>
      </VRow>
    </div>
  </div>
  <!--
  <VRow>
    <VCol md="3">
      <HoverCard min-height="100%" @click="setFirmware('backpack', 'aat')"
                  image="satellite_2637312.png" hover-image="satellite_2637314.png"
                  title="Antenna Tracker"
                  text="Flying long-range and need your antenna pointed in just the right direction? This is the backpack
                  for you!"/>
    </VCol>
    <VCol md="3">
      <HoverCard min-height="100%" @click="setFirmware('backpack', 'timer')"
                  image="stopwatch_4354897.png" hover-image="stopwatch_4355918.png"
                  title="Race Timer"
                  text="Connects to the RotorHazard race timing system and sends OSD message with lap times and current
                  place during the race so you always know where you're placed."/>
    </VCol>
  </VRow>
  -->
</template>

<style scoped>
.v-card-title {
  padding: 0;
  font-size: var(--td-fs-xl);
  font-weight: 600;
  line-height: var(--td-lh-xl);
  color: var(--td-brand);
  letter-spacing: -0.01em;
}

.v-card-subtitle {
  padding: 0;
  font-size: var(--td-fs-md);
  font-weight: 400;
  color: var(--td-fg-mute);
}

.firmware-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 32px;
  justify-content: center;
  width: 1032px;
  margin: 0 auto;
}

.firmware-group {
  width: 500px;
  height: 383px;
}

.firmware-group :deep(.v-row) {
  height: 100%;
  align-content: space-between;
}

.firmware-group :deep(.firmware-options) {
  width: 100%;
  height: 266px;
  margin: 0;
  row-gap: 12px;
}

.firmware-group :deep(.firmware-options > .v-col) {
  padding: 0;
}

/* Full-width third cell. Must come after the .firmware-group rules above so the fixed
   383px/266px heights of the two-card panels do not apply to this single-card one. */
.firmware-group.firmware-group--wide {
  grid-column: 1 / -1;
  width: auto;
  height: auto;
}

.firmware-group.firmware-group--wide :deep(.firmware-options) {
  height: auto;
}

.dashboard-alert {
  margin-bottom: 12px;
}

@media (max-width: 960px) {
  .firmware-grid {
    grid-template-columns: 1fr;
    justify-items: center;
    width: 100%;
    height: auto;
  }

  .firmware-group {
    width: min(500px, 100%);
    height: auto;
  }

  .firmware-group.firmware-group--wide {
    width: min(500px, 100%);
  }

  .firmware-group :deep(.v-row) {
    height: auto;
    align-content: flex-start;
  }

  .firmware-group :deep(.firmware-options) {
    height: auto;
    row-gap: 12px;
  }
}

@media (max-width: 640px) {
  .firmware-group :deep(.firmware-options) {
    row-gap: 12px;
  }
}
</style>