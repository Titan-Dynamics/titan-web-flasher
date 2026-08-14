import {html, LitElement} from "lit";
import {customElement} from "lit/decorators.js";
import {elrsState, formatBand} from "../utils/state.js";
import {SERIAL_OPTIONS1} from '../utils/globals.js'
import {downloadExport, transport} from "../utils/transport.js";
import FEATURES from "../features.js"

@customElement('info-panel')
class InfoPanel extends LitElement {
    createRenderRoot() {
        return this
    }

    render() {
        const productName = elrsState.settings?.product_name || 'TitanLRS Device'
        const gitHash = elrsState.settings?.['git-commit'] || ''
        const uid = Array.isArray(elrsState.config.uid) ? elrsState.config.uid.join(',') : elrsState.config.uid?.toString() || ''
        return html`
            <div style="margin-bottom: var(--td-s-4);">
                ${gitHash ? html`
                    <div class="td-eyebrow" style="margin-bottom: var(--td-s-2);">
                        <span class="td-mono">${gitHash}</span>
                        ${uid ? html`<span class="td-eyebrow-sep">·</span><span class="td-mono">UID ${uid}</span>` : ''}
                    </div>
                ` : ''}
                <div style="display: flex; align-items: center; gap: var(--td-s-3); flex-wrap: wrap;">
                    <h1 class="td-h1" style="margin: 0; flex: 1; min-width: min-content;">
                        ${productName}
                    </h1>
                    <div class="td-row td-gap-2" style="flex-shrink: 0; flex-wrap: wrap;">
                        <button class="td-btn td-btn-danger" @click="${this._reboot}">Reboot Device</button>
                        <button class="td-btn" @click="${this._export}">Export Config</button>
                    </div>
                </div>
            </div>
            <div class="td-card" style="margin-bottom: var(--td-s-4);">
                <div class="td-card-header">
                    <span class="td-h4">Device</span>
                </div>
                <div class="td-card-row"><span class="td-label">Product</span><span>${elrsState.settings.product_name}</span></div>
                <div class="td-card-row"><span class="td-label">Lua Name</span><span>${elrsState.settings.lua_name}</span></div>
                <div class="td-card-row"><span class="td-label">Version</span><span class="td-mono">${elrsState.settings.version}</span></div>
                <div class="td-card-row"><span class="td-label">Git Hash</span><span class="td-mono">${elrsState.settings['git-commit']}</span></div>
                <div class="td-card-row"><span class="td-label">Device Type</span><span>${elrsState.settings['module-type']}</span></div>
                <div class="td-card-row"><span class="td-label">Firmware</span><span class="td-mono">${elrsState.settings.target}</span></div>
                <div class="td-card-row"><span class="td-label">Radio</span><span>${elrsState.settings['radio-type']}</span></div>
                <div class="td-card-row"><span class="td-label">Domain</span><span class="td-chip td-chip-mono" style="width: fit-content;">${formatBand()}</span></div>
                <div class="td-card-row"><span class="td-label">Binding UID</span><span class="td-mono">${Array.isArray(elrsState.config.uid) ? elrsState.config.uid.join(',') : elrsState.config.uid?.toString()}</span></div>
            </div>
            ${this._hasCustomSettings() ? html`
                <div class="td-card">
                    <div class="td-card-header">
                        <span class="td-h4">Custom Settings</span>
                        <span class="td-chip td-chip-warn">Modified</span>
                    </div>
                    ${elrsState.options['is-airport'] ? html`
                        <div class="td-card-row"><span class="td-label">Airport Mode</span><span class="td-chip td-chip-ok" style="width: fit-content;">Enabled</span></div>
                    ` : ''}
                    ${(elrsState.options['wifi-on-interval'] ?? 60) !== 60 ? html`
                        <div class="td-card-row"><span class="td-label">WiFi Auto-on Interval</span><span class="td-mono">${elrsState.options['wifi-on-interval']} s</span></div>
                    ` : ''}
                    ${!FEATURES.IS_TX ? html`
                    ${elrsState.options['lock-on-first-connection'] !== true ? html`
                        <div class="td-card-row"><span class="td-label">Lock on First Connection</span><span class="td-chip td-chip-bad" style="width: fit-content;">Disabled</span></div>
                    ` : ''}
                    ${elrsState.config.modelid !== 255 ? html`
                        <div class="td-card-row"><span class="td-label">Model Match</span><span class="td-mono">ID ${elrsState.config.modelid}</span></div>
                    ` : ''}
                    ${elrsState.config.vbind !== 0 ? html`
                        <div class="td-card-row"><span class="td-label">Binding Storage</span><span>${elrsState.config.vbind === 1 ? 'Volatile' : elrsState.config.vbind === 2 ? 'Returnable' : 'Administered'}</span></div>
                    ` : ''}
                    ${elrsState.config['force-tlm'] !== false ? html`
                        <div class="td-card-row"><span class="td-label">Force Telemetry Off</span><span class="td-chip td-chip-warn" style="width: fit-content;">Enabled</span></div>
                    ` : ''}
                    ${elrsState.config['pwm'] === undefined && elrsState.config['serial-protocol'] !== 0 ? html`
                        <div class="td-card-row"><span class="td-label">Serial Protocol</span><span>${SERIAL_OPTIONS1[elrsState.config['serial-protocol']]}</span></div>
                    ` : ''}
                    ${elrsState.config['pwm'] === undefined && elrsState.options['rcvr-uart-baud'] !== 420000 ? html`
                        <div class="td-card-row"><span class="td-label">Baud Rate</span><span class="td-mono">${elrsState.options['rcvr-uart-baud']}</span></div>
                    ` : ''}
                    ` : ''}
                    ${FEATURES.IS_TX && elrsState.options['tlm-interval'] !== 240 ? html`
                        <div class="td-card-row"><span class="td-label">Telemetry Interval</span><span class="td-mono">${elrsState.options['tlm-interval']} ms</span></div>
                    ` : ''}
                    ${elrsState.settings?.custom_hardware ? html`
                        <div class="td-card-row"><span class="td-label">Custom Hardware</span><span class="td-chip td-chip-warn" style="width: fit-content;">Modified</span></div>
                    ` : ''}
                </div>
            ` : ''}
        `
    }

    _reboot() {
        Promise.resolve(transport.reboot()).catch(() => {})
    }

    _export() {
        downloadExport('config.json').catch(() => {})
    }

    _hasCustomSettings() {
        let custom = false
        custom = elrsState.options['is-airport'] || (elrsState.options['wifi-on-interval'] ?? 60) !== 60

        if (!FEATURES.IS_TX) {
            custom |= elrsState.config['pwm'] === undefined && elrsState.config['serial-protocol'] !== 0
            custom |= elrsState.config['pwm'] === undefined && elrsState.options['rcvr-uart-baud'] !== 420000
            custom |= elrsState.options['lock-on-first-connection'] !== true ||
                elrsState.config.modelid !== 255 ||
                elrsState.config.vbind !== 0 ||
                elrsState.config['force-tlm'] !== false
        } else {
            custom |= elrsState.options['tlm-interval'] !== 240
        }
        return custom
    }
}
