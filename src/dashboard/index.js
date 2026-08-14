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
import {FEATURE_OPTIONS_WRITE} from '../js/usbconfig.js'

// Panels register themselves as custom elements on import.
import './pages/info-panel.js'
import './pages/binding-panel.js'
import './pages/tx-options-panel.js'
import './pages/rx-options-panel.js'
import './pages/buttons-panel.js'
import './pages/models-panel.js'
import './pages/connections-panel.js'
import './pages/serial-panel.js'

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
  if (FEATURES.IS_TX) {
    const tabs = [
      {id: 'info', label: 'Information', icon: 'info', tag: 'info-panel'},
      {id: 'binding', label: 'Binding', icon: 'bind', tag: 'binding-panel'},
      {id: 'options', label: 'Options', icon: 'sliders', tag: 'tx-options-panel'},
    ]
    if (config['button-actions'] && config['button-actions'].length) {
      tabs.push({id: 'buttons', label: 'Buttons', icon: 'button', tag: 'buttons-panel'})
    }
    tabs.push({id: 'models', label: 'Import/Export', icon: 'box', tag: 'models-panel'})
    return tabs
  }
  const tabs = [
    {id: 'info', label: 'Information', icon: 'info', tag: 'info-panel'},
    {id: 'binding', label: 'Binding', icon: 'bind', tag: 'binding-panel'},
    {id: 'options', label: 'Options', icon: 'sliders', tag: 'rx-options-panel'},
    {id: 'serial', label: 'Serial', icon: 'serial', tag: 'serial-panel'},
  ]
  // Absent on every current STM32 target (GPIO_PIN_PWM_OUTPUTS_COUNT == 0), so this tab
  // stays hidden — exactly as the on-device UI hides it.
  if (config.pwm !== undefined) {
    tabs.push({id: 'connections', label: 'Connections', icon: 'link', tag: 'connections-panel'})
  }
  return tabs
}
