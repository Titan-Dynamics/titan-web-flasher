<script setup>
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch} from 'vue'
import HoverCard from '../components/HoverCard.vue'
import moduleIcon from '../assets/brand/module-icon.png'

// The Configurator page. It opens on a connect panel; its Connect to Device button raises the
// WebUSB chooser (which needs that click's user activation) and the dashboard takes the session.
// idle -> connecting -> connected -> lost
const phase = ref('idle')
const errorText = ref('')
const connectError = ref('')       // shown on the connect panel
const connectBusy = ref(false)
const webUsbSupported = ref(true)
const hello = ref(null)
const tabs = shallowRef([])
const activeTab = ref('info')
const panelHost = ref(null)
const rebooting = ref(false)
const drawerOpen = ref(false)   // mobile: the firmware shell's slide-in sidebar

const session = shallowRef(null)
const dashboard = shallowRef(null)   // the lazily-imported src/dashboard/index.js module
// A USBDevice object does not survive the device re-enumerating, but the permission does, so
// remember which device it was and re-resolve it through navigator.usb.getDevices().
const retainedSerial = ref(null)

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
  retainedSerial.value = s.device?.serialNumber || null

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

/** Open a fresh session for the reconnect path, preferring the device that was open before. */
async function connect({useChooser = false} = {}) {
  const usb = await import('../js/usbconfig.js')
  const s = mockParam ? new usb.MockTransport(mockParam) : new usb.UsbConfigSession()
  let device = null
  if (!useChooser && !mockParam) {
    const known = await usb.getKnownDevices()
    device = known.find((d) => d.serialNumber === retainedSerial.value) || known[0] || null
  }
  await s.connect(device)
  await adopt(s)
}

/**
 * The connect panel's button. WebUSB permission persists per origin, so a device granted before
 * is reopened without raising the chooser again; otherwise the chooser comes up from this click.
 */
async function connectDevice() {
  if (connectBusy.value) return
  connectError.value = ''
  connectBusy.value = true
  let s = null
  try {
    const usb = await import('../js/usbconfig.js')
    s = mockParam ? new usb.MockTransport(mockParam) : new usb.UsbConfigSession()
    const known = mockParam ? [] : await usb.getKnownDevices()
    await s.connect(known.length === 1 ? known[0] : null)
    await adopt(s)
  } catch (err) {
    if (s) { try { await s.disconnect() } catch { /* ignore */ } }
    resetToIdle()
    // Dismissing the device chooser is not an error worth reporting.
    if (!(err && err.name === 'NotFoundError')) {
      connectError.value = (err && err.message) || String(err)
    }
  } finally {
    connectBusy.value = false
  }
}

/** Drop the device and the panels, and show the connect panel again. */
function resetToIdle() {
  session.value = null
  retainedSerial.value = null
  hello.value = null
  tabs.value = []
  rebooting.value = false
  drawerOpen.value = false
  errorText.value = ''
  clearPanel()
  phase.value = 'idle'
}

/**
 * The on-device UI reloads the page after a reboot; over USB the device re-enumerates instead, so
 * offer an explicit reconnect. The granted permission survives the re-enumeration, so this
 * normally reconnects silently; if the device cannot be re-resolved, fall back to the chooser.
 */
async function reconnect() {
  rebooting.value = false
  errorText.value = ''
  phase.value = 'connecting'
  try { await session.value?.disconnect() } catch { /* ignore */ }
  session.value = null
  try {
    await connect()
  } catch (err) {
    // Could not re-resolve it — raise the chooser. This still runs inside the Reconnect click,
    // so the transient user activation WebUSB needs is intact.
    try {
      await connect({useChooser: true})
      return
    } catch (err2) {
      errorText.value = (err2 && err2.message) || String(err2)
    }
    phase.value = 'lost'
  }
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

onMounted(async () => {
  window.addEventListener('td-device-rebooting', onRebootAnnounced)
  // Load the chunk now so the Connect click reaches requestDevice() without spending its
  // transient user activation on a network fetch.
  const usb = await import('../js/usbconfig.js')
  webUsbSupported.value = usb.isWebUsbSupported() || !!mockParam
  // ?dashboard&mock=tx|rx (dev): the fixture transport needs no port and no user gesture.
  if (mockParam) await connectDevice()
})

onBeforeUnmount(() => {
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
                  closable @click:close="connectError = ''">
            {{ connectError }}
          </VAlert>
          <VAlert v-else-if="!webUsbSupported" type="warning" variant="tonal" class="td-dash-connect-alert">
            This browser does not support WebUSB. Use Chrome, Edge or another Chromium-based
            browser to configure a device over USB.
          </VAlert>
          <HoverCard min-height="100%" :interactive="false"
                     :image="moduleIcon" :hover-image="moduleIcon"
                     title="USB Device Config"
                     text="Connect a TitanLRS device over USB
                     and click &quot;Connect to Device&quot; to edit the settings straight from the browser.">
            <template #action>
              <VBtn color="primary" size="large" :loading="connectBusy"
                    :disabled="!webUsbSupported" @click="connectDevice">
                Connect to Device
              </VBtn>
            </template>
          </HoverCard>
        </div>
      </VContainer>
    </div>
  </main>

  <!-- Brief gap between connecting and the first panel; no controls, it is not a page. -->
  <div v-else-if="phase === 'connecting' && !tabs.length" class="td-dash-loading">
    <VProgressCircular indeterminate color="primary" size="28"/>
    <span>Reading device configuration…</span>
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
