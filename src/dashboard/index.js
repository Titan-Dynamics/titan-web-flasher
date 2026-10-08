/*
 * Dashboard entry point.
 *
 * Everything under src/dashboard/ is a copy of the firmware's own web UI
 * (TitanLRS/src/html/src) — see PORTING.md for the source commit and the sync procedure.
 * This module is the only place the copies are wired to the outside world:
 *
 *   - installs the transport (a UsbConfigSession, or MockTransport in dev),
 *   - resolves the runtime FEATURES that replace the firmware build's compile-time blocks,
 *   - loads the config document into the shared elrsState.
 *
 * It is imported dynamically by DeviceDashboard.vue so the flashing path never pays for it.
 */

import './assets/td.js'
import './assets/td.css'
import './assets/td-extensions.css'

import {setTransport} from './utils/transport.js'
import {elrsState} from './utils/state.js'
import {applyFeatures, FEATURES} from './features.js'
import {FEATURE_CRSF_PARAMS, FEATURE_HARDWARE_WRITE, FEATURE_OPTIONS_WRITE} from '../js/usbconfig.js'

// Panels register themselves as custom elements on import.
import './pages/info-panel.js'
import './pages/binding-panel.js'
import './pages/tx-options-panel.js'
import './pages/rx-options-panel.js'
import './pages/buttons-panel.js'
import './pages/models-panel.js'
import './pages/connections-panel.js'
import './pages/serial-panel.js'
import './pages/params-panel.js'
import './pages/hardware-panel.js'

export {FEATURES, elrsState}

/**
 * Install a transport and load the device's configuration into the shared state.
 * @returns {Promise<{settings, config, options, features}>}
 */
export async function initDashboard(session) {
  setTransport(session)
  const data = await session.getConfig()
  elrsState.settings = data.settings || {}
  elrsState.options = data.options || {}
  elrsState.config = data.config || {}
  applyFeatures({
    hello: session.hello,
    settings: elrsState.settings,
    optionsWritable: typeof session.hasFeature === 'function'
      ? session.hasFeature(FEATURE_OPTIONS_WRITE)
      : false,
    crsfParams: typeof session.hasFeature === 'function'
      ? session.hasFeature(FEATURE_CRSF_PARAMS)
      : false,
    hardwareWrite: typeof session.hasFeature === 'function'
      ? session.hasFeature(FEATURE_HARDWARE_WRITE)
      : false,
  })
  return {...data, features: FEATURES}
}

/**
 * Re-read the device after something changed underneath us (e.g. after a reboot + reconnect).
 */
export async function reloadDashboard(session) {
  return initDashboard(session)
}

/**
 * Which tabs a device gets. Driven entirely by HELLO + the shape of the config document, which
 * is how the firmware build's per-target feature blocks are replaced at runtime.
 */
export function tabsFor(config) {
  // The live CRSF parameter tree (packet rate, RF power, …). Gated on the HELLO feature bit
  // rather than on module type: the firmware serves the tunnel from the same shared CRSFRouter on
  // both TX and RX, so an RX plugged in directly serves its own tree. Placed right after
  // Information — it is the tab users reach for most often.
  const paramsTab = FEATURES.CRSF_PARAMS
    ? [{id: 'params', label: 'Parameters', icon: 'sliders', tag: 'params-panel'}]
    : []
  // The hardware-layout override (ESP's /hardware.json). Last: it is a board-bring-up tool, not
  // something a user reaches for day to day.
  const hardwareTab = FEATURES.HARDWARE_WRITE
    ? [{id: 'hardware', label: 'Hardware', icon: 'cpu', tag: 'hardware-panel'}]
    : []

  if (FEATURES.IS_TX) {
    const tabs = [
      {id: 'info', label: 'Information', icon: 'info', tag: 'info-panel'},
      ...paramsTab,
      {id: 'binding', label: 'Binding', icon: 'bind', tag: 'binding-panel'},
      {id: 'options', label: 'Options', icon: 'sliders', tag: 'tx-options-panel'},
    ]
    if (config['button-actions'] && config['button-actions'].length) {
      tabs.push({id: 'buttons', label: 'Buttons', icon: 'button', tag: 'buttons-panel'})
    }
    tabs.push({id: 'models', label: 'Import/Export', icon: 'box', tag: 'models-panel'})
    tabs.push(...hardwareTab)
    return tabs
  }
  const tabs = [
    {id: 'info', label: 'Information', icon: 'info', tag: 'info-panel'},
    ...paramsTab,
    {id: 'binding', label: 'Binding', icon: 'bind', tag: 'binding-panel'},
    {id: 'options', label: 'Options', icon: 'sliders', tag: 'rx-options-panel'},
    {id: 'serial', label: 'Serial', icon: 'serial', tag: 'serial-panel'},
  ]
  // Absent on every current STM32 target (GPIO_PIN_PWM_OUTPUTS_COUNT == 0), so this tab
  // stays hidden — exactly as the on-device UI hides it.
  if (config.pwm !== undefined) {
    tabs.push({id: 'connections', label: 'Connections', icon: 'link', tag: 'connections-panel'})
  }
  tabs.push(...hardwareTab)
  return tabs
}
