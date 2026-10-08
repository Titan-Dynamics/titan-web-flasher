import {State} from "@lit-app/state";
import {saveAndReboot, saveWithReboot} from "./feedback.js";
import {transport} from "./transport.js";

class ElrsState extends State {
    config = {}
    options = {}
    settings = {}
}

export function formatBand() {
    if (elrsState.settings) {
        if (elrsState.settings.reg_domain_low && elrsState.settings.reg_domain_high) {
            return elrsState.settings.reg_domain_low + '/' + elrsState.settings.reg_domain_high
        }
        if (elrsState.settings.reg_domain_low)
            return elrsState.settings.reg_domain_low
        return elrsState.settings.reg_domain_high
    }
}

// Merge posted changes over the live config, carrying the PWM channel settings across (they are
// held as objects in the state but posted as raw values).
function mergeConfig(changes) {
    const currentPWM = elrsState.config.pwm
    if (changes.pwm) {
        // update pwm settings
        for (let i = 0; i < currentPWM.length; i++) {
            currentPWM[i].config = changes.pwm[i]
        }
    } else if (currentPWM) {
        // preserve original pwm settings
        changes.pwm = []
        for (let i = 0; i < currentPWM.length; i++) {
            changes.pwm.push(currentPWM[i].config)
        }
    }
    return {newConfig: {...elrsState.config, ...changes}, currentPWM}
}

/**
 * Save device configuration.
 *
 * Config changes take effect at boot, so this is the same confirm-save-reboot flow the options
 * saves use — one behaviour and one set of button labels across every panel, TX and RX. `dialog`
 * overrides the wording for saves that are not a plain "Save" (e.g. Reset to Unbound).
 */
export function saveConfig(changes, successCB, {title = 'Save & Reboot', ...dialog} = {}) {
    const {newConfig, currentPWM} = mergeConfig(changes)
    return saveAndReboot(title, 'Configuration Update Failed',
        (cfg) => transport.saveConfig(cfg), newConfig, () => {
            elrsState.config = {...newConfig, pwm: currentPWM}
            if (successCB) successCB()
        }, dialog)
}

/**
 * Save firmware options.
 *
 * Every option is applied during setup() (UID, regulatory domain, baud rates), so callers whose
 * panel offers a "Save & Reboot" button pass `reboot: true` to get the confirm-save-reboot flow
 * instead of the save-then-offer-a-reboot one.
 */
export function saveOptions(changes, successCB, {reboot = false} = {}) {
    const newOptions = {...elrsState.options, ...changes, customised: true}
    const apply = () => {
        elrsState.options = newOptions
        if (successCB) successCB()
    }
    const save = (opts) => transport.saveOptions(opts)
    if (reboot) {
        return saveAndReboot('Save & Reboot', 'Configuration Update Failed', save, newOptions, apply)
    }
    return saveWithReboot('Configuration Update Succeeded', 'Configuration Update Failed',
        save, newOptions, apply)
}

// Options + config in one transaction. The options half is always reboot-to-apply, so this is
// always the confirm-save-reboot flow.
export function saveOptionsAndConfig(changes, successCB) {
    const newOptions = {...elrsState.options, ...changes.options, customised: true}
    const {newConfig, currentPWM} = mergeConfig(changes.config)
    return saveAndReboot('Save & Reboot', 'Configuration Update Failed',
        () => Promise.resolve()
            .then(() => transport.saveOptions(newOptions))
            .then(() => transport.saveConfig(newConfig)),
        null, () => {
            elrsState.options = newOptions
            elrsState.config = {...newConfig, pwm: currentPWM}
            if (successCB) successCB()
        })
}

/*
 * Re-read the whole config document from the device.
 *
 * A live CRSF PARAM_WRITE (packet rate, telemetry ratio, …) changes settings that also appear in
 * the config document read once at connect, so without this the Options tab would keep showing
 * the pre-write value and the two views would disagree about the same setting. Debounced, because
 * a write is normally followed by a burst of parameter reloads.
 */
let refreshTimer = null
export function refreshDeviceConfig({delay = 400} = {}) {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
        refreshTimer = null
        Promise.resolve(transport.getConfig())
            .then((data) => {
                if (data.settings) elrsState.settings = data.settings
                if (data.options) elrsState.options = data.options
                if (data.config) elrsState.config = data.config
            })
            // A stale cache is a cosmetic problem; a popup over the Parameters tab is not.
            .catch(() => {})
    }, delay)
}

export let elrsState = new ElrsState()
