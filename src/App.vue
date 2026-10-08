<script setup>
import {computed, defineAsyncComponent} from 'vue';
import {resetState, store} from './js/state';
import {DEVICE_CONFIG_ENABLED} from './js/featureFlags';

import FirmwareSelect from './pages/FirmwareSelect.vue';
import MainHardwareSelect from './pages/MainHardwareSelect.vue';
import VRXHardwareSelect from "./pages/BackpackHardwareSelect.vue";

import TransmitterOptions from './pages/TransmitterOptions.vue';
import ReceiverOptions from './pages/ReceiverOptions.vue';
import BackpackOptions from "./pages/BackpackOptions.vue";

import Download from "./pages/Download.vue";
import SerialFlash from "./pages/SerialFlash.vue";
import STLinkFlash from "./pages/STLinkFlash.vue";
import DFUFlash from "./pages/DFUFlash.vue";

// Lazy so the flashing path never downloads the dashboard or its ported Lit panels.
const DeviceDashboard = defineAsyncComponent(() => import('./pages/DeviceDashboard.vue'));

import ReloadPrompt from './components/ReloadPrompt.vue';
import SiteBar from './components/SiteBar.vue';

const isLastStep = computed(() => store.currentStep === 3);
const nextLabel = computed(() => (isLastStep.value ? 'Done' : 'Next'));

function goHome() {
  resetState()
  window.history.replaceState({}, '', window.location.pathname)
}

/** Header menu: FIRMWARE is the flasher's landing page, CONFIGURATOR the USB config dashboard. */
function onNavigate(page) {
  goHome()
  if (page === 'configurator') store.view = 'dashboard'
}

function stepPrev() {
  if (store.currentStep === 1) {
    resetState()
  } else {
    store.currentStep--
  }
}

function disableNext() {
  if (store.currentStep === 1) {
    return !store.target ? "next" : false
  } else if (store.currentStep === 2) {
    return !store.options.flashMethod ? "next" : false
  } else if (store.currentStep === 3) {
    return false
  }
  return false
}

function stepNext() {
  if (isLastStep.value) {
    goHome()
    return
  }
  store.currentStep++
}

// Handle any query params
let urlParams = new URLSearchParams(window.location.search);
store.targetType = urlParams.get('type');
if (store.targetType === "tx" || store.targetType === "rx")
  store.firmware = 'firmware'
else if (store.targetType)
  store.firmware = 'backpack'

store.options.flashMethod = urlParams.get('method');

// Deep link into the configurator: ?dashboard opens its connect panel, and ?dashboard&mock=tx|rx
// (dev) connects it to the built-in mock device straight away.
if (DEVICE_CONFIG_ENABLED && urlParams.has('dashboard')) store.view = 'dashboard';

</script>

<template>
  <VApp class="td-app">
    <ReloadPrompt />
    <div class="td-shell">
      <!--
        The titandynamics.aero header on every page. The configurator reproduces the firmware's
        full-viewport shell (fixed left nav + topbar) under it, so the bar is pinned there.
      -->
      <SiteBar :active="store.view === 'dashboard' ? 'configurator' : 'firmware'"
               :fixed="store.view === 'dashboard'" @home="goHome" @navigate="onNavigate"/>
      <DeviceDashboard v-if="store.view === 'dashboard'"/>
      <main v-else class="td-main">
        <div class="section">
          <div class="td-title__sub">TitanLRS Firmware Flasher</div>
          <VFadeTransition mode="out-in" >
            <VContainer max-width="1280px" v-if="!store.targetType" style="display: grid; gap: 40px;">
              <FirmwareSelect/>
            </VContainer>
            <VContainer max-width="1024px" v-else>
              <div class="containerMain">

                <VStepper v-model="store.currentStep" :items="['Hardware', 'Options', 'Flashing']" hideActions>
                  <template v-slot:item.1>
                    <MainHardwareSelect v-if="store.firmware==='firmware'"/>
                    <VRXHardwareSelect vendor-label="Transmitter Module" v-if="store.targetType==='txbp'"/>
                    <VRXHardwareSelect vendor-label="VRx Type" v-if="store.targetType==='vrx'"/>
                    <VRXHardwareSelect vendor-label="Antenna Tracker Type" v-if="store.targetType==='aat'"/>
                    <VRXHardwareSelect vendor-label="Timer Type" v-if="store.targetType==='timer'"/>
                  </template>
                  <template v-slot:item.2>
                    <TransmitterOptions v-if="store.targetType==='tx'"/>
                    <ReceiverOptions v-else-if="store.targetType==='rx'"/>
                    <BackpackOptions v-else/>
                  </template>
                  <template v-slot:item.3>
                    <Download v-if="store.options.flashMethod==='download'"/>
                    <Download v-else-if="store.options.flashMethod==='wifi'"/>
                    <STLinkFlash v-else-if="store.options.flashMethod==='stlink'"/>
                    <DFUFlash v-else-if="store.options.flashMethod==='dfu'"/>
                    <SerialFlash v-else/>
                  </template>
                  <VStepperActions :disabled="disableNext()" :next-text="nextLabel" @click:prev="stepPrev" @click:next="stepNext"/>
                </VStepper>
              </div>
            </VContainer>
          </VFadeTransition>
        </div>
      </main>
    </div>
  </VApp>
</template>

<style>
/* Full-height column: the bar on top, the page content centred in what is left. */
.td-shell {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

/* Centre the page horizontally (the containers' max-width) and vertically (auto margins). Auto
   margins, unlike justify-content: center, fall back to top-aligned scrolling when the content is
   taller than the screen, so small devices never lose the top of the page. */
.td-main {
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
}

.td-main > .section {
  width: 100%;
  margin: auto 0;
  gap: 16px;
}

.td-title__sub {
  font-size: 22px;
  font-weight: 400;
  color: var(--td-fg-mute);
  letter-spacing: 0.04em;
  text-align: center;
  font-family: var(--td-font);
}

@media (max-width: 640px) {
  .td-main > .section {
    gap: 10px;
  }

  .td-title__sub {
    font-size: 15px;
  }
}
</style>
