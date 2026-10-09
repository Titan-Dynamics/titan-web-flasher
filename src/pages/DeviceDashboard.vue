<script setup>
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch} from 'vue'
import HoverCard from '../components/HoverCard.vue'
import moduleIcon from '../assets/brand/module-icon.png'
import controllerIcon from '../assets/brand/controller-icon.png'
import radioIcon from '../assets/brand/radio-icon.png'

// The Configurator page. On opening it looks for a TitanLRS device on its USB network interface
// (netconfig.js) by itself, behind a spinner; if exactly one answers the dashboard takes the
// session. Otherwise it falls back to the connect panel, whose Connect to Device button runs the
// same search. On a first visit the search raises Chrome's Local Network Access prompt.
// probing -> idle (connect panel) | connecting -> connected -> lost
const phase = ref('probing')
const errorText = ref('')
const connectError = ref('')       // shown on the connect panel
const connectBusy = ref(false)
const choices = shallowRef([])     // more than one device answered: [{address, hello}]
const hello = ref(null)
const tabs = shallowRef([])
const activeTab = ref('info')
const panelHost = ref(null)
const rebooting = ref(false)
const drawerOpen = ref(false)   // mobile: the firmware shell's slide-in sidebar

const session = shallowRef(null)
const dashboard = shallowRef(null)   // the lazily-imported src/dashboard/index.js module
// Which device we were talking to, so a reconnect goes back to the same one.
const retainedAddress = ref(null)

const mockParam = new URLSearchParams(window.location.search).get('mock')


async function loadDashboardModule() {
  if (!dashboard.value) {
    dashboard.value = await import('../dashboard/index.js')
  }
  return dashboard.value
}

/** Take over an already-connected session and build the panels for it. */
async function adopt(s) {
  errorText.value = ''
  phase.value = 'connecting'
  session.value = s
  hello.value = s.hello
  retainedAddress.value = s.address || null

  s.onLost((reason) => {
    // A reboot/reset drops the port too; the dashboard announces those in advance so we can
    // say "reconnect once it comes back" instead of reporting a failure.
    errorText.value = rebooting.value ? '' : reason
    phase.value = 'lost'
  })

  const mod = await loadDashboardModule()
  const data = await mod.initDashboard(s)
  tabs.value = mod.tabsFor(data.config || {})
  activeTab.value = tabs.value[0]?.id || 'info'
  phase.value = 'connected'
  await renderPanel()
}

async function newSession() {
  if (mockParam) {
    const {MockTransport} = await import('../js/usbconfig.js')
    return new MockTransport(mockParam)
  }
  const {HttpConfigSession} = await import('../js/netconfig.js')
  return new HttpConfigSession()
}

/** Open a session to `address` (or the first device found) and build the panels for it. */
async function connect(address = null) {
  const s = await newSession()
  await s.connect(address ? {address} : {})
  await adopt(s)
}

/**
 * The connect panel's button: find the devices on USB network links. One answers -> connect to
 * it; a TX and an RX both plugged in -> let the user pick.
 */
async function connectDevice(address = null) {
  if (connectBusy.value) return
  connectError.value = ''
  connectBusy.value = true
  try {
    if (!address && !mockParam) {
      const {discoverDevices, unreachableHelp} = await import('../js/netconfig.js')
      const found = await discoverDevices()
      if (found.length === 0) {
        connectError.value = unreachableHelp()
        return
      }
      if (found.length > 1) {
        choices.value = found
        return
      }
      address = found[0].address
    }
    choices.value = []
    await connect(address)
  } catch (err) {
    resetToIdle()
    connectError.value = (err && err.message) || String(err)
  } finally {
    connectBusy.value = false
  }
}

/**
 * Opening the page: look for the device without waiting for the button. One device answers ->
 * connect to it. None (each probe times out) -> the connect panel, without an error, as nothing
 * was asked for yet. Several -> the panel with the choice.
 *
 * On a first visit the search raises Chrome's Local Network Access prompt, and the probes time
 * out while it is still open. If the user then allows it, search again from the panel.
 */
async function autoConnect() {
  if (mockParam) {
    await connectDevice()
    return
  }
  let found = []
  try {
    const {discoverDevices, localNetworkPermission} = await import('../js/netconfig.js')
    const permission = await localNetworkPermission()
    if (permission && permission.state !== 'granted') {
      permission.addEventListener('change', () => {
        if (permission.state === 'granted' && phase.value === 'idle' && !connectBusy.value && !unmounted) {
          connectDevice()
        }
      }, {once: true})
    }
    // Blocked: every request fails at once, so there is nothing to wait for; the panel explains.
    if (permission?.state !== 'denied') found = await discoverDevices()
  } catch { /* fall back to the panel */ }
  if (unmounted || phase.value !== 'probing') return
  if (found.length === 1) {
    try {
      await connect(found[0].address)
    } catch (err) {
      resetToIdle()
      connectError.value = (err && err.message) || String(err)
    }
    return
  }
  choices.value = found
  phase.value = 'idle'
}

// The device chooser's cards, from each device's /hello.
function deviceIcon(h) {
  return h['module-type'] === 'RX' ? radioIcon : controllerIcon
}

function deviceTitle(h) {
  return h['module-type'] === 'RX' ? 'Receiver' : 'Transmitter'
}

function deviceText({address, hello: h}) {
  return `${h['product-name']} · firmware ${h.version} · ${address}`
}

/** The chooser's Search again: forget the list and look for devices afresh. */
function rescan() {
  choices.value = []
  connectDevice()
}

/** Drop the device and the panels, and show the connect panel again. */
function resetToIdle() {
  session.value = null
  retainedAddress.value = null
  hello.value = null
  tabs.value = []
  rebooting.value = false
  drawerOpen.value = false
  errorText.value = ''
  clearPanel()
  phase.value = 'idle'
}

/**
 * Go back to the same device once it is reachable again. After a reboot it takes a few seconds
 * for the board to come back and the host to renew its address, so keep trying for a while.
 */
async function reconnect() {
  rebooting.value = false
  errorText.value = ''
  phase.value = 'connecting'
  try { await session.value?.disconnect() } catch { /* ignore */ }
  session.value = null
  const deadline = Date.now() + RECONNECT_WINDOW_MS
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      await connect(retainedAddress.value)
      return
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  errorText.value = (lastErr && lastErr.message) || 'Device did not come back'
  phase.value = 'lost'
}

function clearPanel() {
  if (panelHost.value) panelHost.value.innerHTML = ''
}

async function renderPanel() {
  // On the first render the host does not exist yet — the connected branch of the template is
  // only created once Vue flushes the `phase` change. Without this wait the first panel comes up
  // blank and only appears after switching tabs.
  await nextTick()
  if (!panelHost.value) return
  const tab = tabs.value.find((t) => t.id === activeTab.value)
  panelHost.value.innerHTML = tab ? `<${tab.tag}></${tab.tag}>` : ''
}

watch(activeTab, () => { renderPanel() })

/** Nav icons come from the ported design-system helper (dashboard/assets/td.js). */
function navIcon(name) {
  return window.TD ? window.TD.icon(name) : ''
}

// The device is only "live" while connected and not on its way through a reboot. Otherwise the
// status bar above the panel says why and offers Reconnect.
const isLive = computed(() => phase.value === 'connected' && !rebooting.value)

const statusText = computed(() => {
  if (isLive.value) return ''
  if (phase.value === 'connecting') return 'Reconnecting…'
  if (rebooting.value) return 'Device is rebooting...'
  return 'Connection to the device lost'
})

function selectTab(id) {
  if (activeTab.value !== id) activeTab.value = id
  drawerOpen.value = false
}

function onRebootAnnounced() {
  rebooting.value = true
}

// How long a reconnect keeps looking for the device after a reboot, and how long to wait before
// starting to look.
const RECONNECT_WINDOW_MS = 20000
const REBOOT_SETTLE_MS = 2000

// Over the network there is no chooser needing a click, so a device that announced a reboot is
// picked up again on its own once it is back.
watch(phase, async (p) => {
  if (p === 'lost' && rebooting.value && retainedAddress.value) {
    // The device answers the reboot request before it goes down: give it time to actually leave,
    // or the first attempt reconnects to it just before it reboots.
    await new Promise((r) => setTimeout(r, REBOOT_SETTLE_MS))
    if (phase.value === 'lost' && rebooting.value) reconnect()
  }
})

let unmounted = false

onMounted(async () => {
  window.addEventListener('td-device-rebooting', onRebootAnnounced)
  // ?dashboard&mock=tx|rx (dev): the fixture transport needs no device.
  await autoConnect()
})

onBeforeUnmount(() => {
  unmounted = true
  window.removeEventListener('td-device-rebooting', onRebootAnnounced)
  if (session.value) session.value.disconnect().catch(() => {})
})

</script>

<template>
  <!--
    Before a device is open: the connect panel, laid out like the flasher's pages. Once connected:
    the firmware's shell (#sidedrawer / #main-wrapper / #main) with the scoped copy of its CSS, so
    the config pages look like the on-device UI, under the site header, which App.vue pins while
    this page is shown. The shell's own topbar and sidebar brand are left out (the site header
    replaces them). Additions: a status bar with Reconnect while the device is unreachable (the
    port re-enumerates on a reboot), and on phones a button that opens the slide-in sidebar.
    Leaving the page (FIRMWARE) closes the device.
  -->
  <main v-if="phase === 'idle'" class="td-main">
    <div class="section">
      <div class="td-title__sub">TitanLRS Configurator</div>
      <VContainer max-width="720px">
        <div class="containerMain">
          <div class="containerHeader">
            <VCardTitle>Device Configuration</VCardTitle>
          </div>
          <VAlert v-if="connectError" type="error" variant="tonal" class="td-dash-connect-alert"
                  style="white-space: pre-line" closable @click:close="connectError = ''">
            {{ connectError }}
          </VAlert>
          <!-- More than one device answered: one card per device, as on the Firmware page. -->
          <template v-if="choices.length">
            <p class="td-dash-choose">{{ choices.length }} devices found. Choose the one to configure.</p>
            <div class="td-dash-choices">
              <HoverCard v-for="c in choices" :key="c.address" min-height="100%"
                         :image="deviceIcon(c.hello)" :hover-image="deviceIcon(c.hello)"
                         :title="deviceTitle(c.hello)" :text="deviceText(c)"
                         @click="connectDevice(c.address)"/>
            </div>
            <div class="td-dash-rescan">
              <VBtn variant="text" size="small" :disabled="connectBusy" @click="rescan">Search again</VBtn>
            </div>
          </template>
          <HoverCard v-else min-height="100%" :interactive="false"
                     :image="moduleIcon" :hover-image="moduleIcon"
                     title="USB Device Config"
                     text="Connect a TitanLRS device over USB
                     and click &quot;Connect to Device&quot; to edit the settings straight from the browser.
                     Chrome will ask to allow access to devices on your local network: the device
                     appears to your computer as a USB network adapter.">
            <template #action>
              <VBtn color="primary" size="large" :loading="connectBusy" @click="connectDevice()">
                Connect to Device
              </VBtn>
            </template>
          </HoverCard>
        </div>
      </VContainer>
    </div>
  </main>

  <!-- The automatic search on opening, then the gap before the first panel; no controls. -->
  <div v-else-if="phase === 'probing' || (phase === 'connecting' && !tabs.length)" class="td-dash-loading">
    <VProgressCircular indeterminate color="primary" size="28"/>
    <span>{{ phase === 'probing' ? 'Looking for a device…' : 'Reading device configuration…' }}</span>
  </div>

  <div v-else class="td-dashboard">
    <div class="td">
      <div id="sidedrawer" :class="{active: drawerOpen}">
        <div id="sidebar">
          <nav id="sidebar-nav">
            <div class="td-nav-section">Workspace</div>
            <a v-for="t in tabs" :key="t.id" class="td-nav-item"
               :class="{'is-active': activeTab === t.id}"
               href="#" @click.prevent="selectTab(t.id)">
              <span class="td-dash-nav-icon" v-html="navIcon(t.icon)"></span>{{ t.label }}
            </a>
          </nav>
        </div>
      </div>

      <div id="main-wrapper">
        <!-- Only while the device is unreachable: why, and the way back. -->
        <div v-if="statusText" class="td-dash-status-bar" :title="errorText">
          <span>{{ statusText }}</span>
          <button class="td-btn td-btn-primary" :disabled="phase === 'connecting'" @click="reconnect">Reconnect</button>
        </div>
        <!-- The ported Lit panels render here, exactly as #main does on-device. -->
        <div id="main" ref="panelHost"></div>
      </div>

      <div id="sidebar-backdrop" :class="{active: drawerOpen}" @click="drawerOpen = false"></div>
      <!-- Phones: the firmware shell's slide-in sidebar, opened from here as there is no topbar. -->
      <button class="td-btn td-btn-icon td-mobile-only td-dash-drawer-toggle" type="button"
              @click="drawerOpen = !drawerOpen" aria-label="Toggle navigation"
              v-html="navIcon('sidebar')"></button>
    </div>
  </div>
</template>

<style scoped>
/* Shown only between mounting with a live session and the first panel render. */
.td-dash-loading {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--td-fg-mute);
}

.td-dash-connect-alert {
  margin-bottom: 12px;
}

.td-dash-choose {
  margin: 0 0 12px;
  color: var(--td-fg-mute);
}

.td-dash-choices {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.td-dash-rescan {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

/* ── Connected shell ────────────────────────────────────────────────────────
   Layout for #sidedrawer / #main-wrapper / #main comes from the scoped copy of the firmware's
   td-extensions.css. Only the flasher-specific changes live here. Deep selectors are required
   because those elements are styled by the ported global stylesheet, not by this component.

   The site header is pinned at the top (App.vue + SiteBar.vue) and replaces the shell's topbar,
   so the fixed sidebar starts below the header and the content no longer leaves room for a
   topbar. #main-wrapper is in the flow after the header's spacer. */
.td-dashboard :deep(#sidedrawer) {
  top: var(--td-sitebar-h);
  height: calc(100vh - var(--td-sitebar-h));
}

.td-dashboard :deep(#main-wrapper) {
  padding-top: 0;
  min-height: calc(100vh - var(--td-sitebar-h));
}

.td-dashboard :deep(#sidebar-nav) {
  padding-top: var(--td-s-3);
}

.td-dashboard :deep(.td-dash-nav-icon) {
  display: inline-flex;
  align-items: center;
}

/* Shown only while the device is unreachable (lost, rebooting, reconnecting). */
.td-dashboard .td-dash-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 32px;
  font-size: 13px;
  color: var(--td-fg-mute);
  background: var(--td-bg-1);
  border-bottom: 1px solid var(--td-line);
}

/* Phones only (td-mobile-only): opens the slide-in sidebar. */
.td-dashboard .td-dash-drawer-toggle {
  position: fixed;
  left: 16px;
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 210;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--td-bg-2);
  border: 1px solid var(--td-line);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
}

@media (max-width: 768px) {
  .td-dashboard .td-dash-status-bar {
    padding: 8px 16px;
  }
}
</style>
