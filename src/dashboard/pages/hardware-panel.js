import {html, LitElement, nothing} from 'lit'
import {customElement, state} from 'lit/decorators.js'
import {actionWithConfirm, errorAlert, saveAndReboot} from '../utils/feedback.js'
import '../components/filedrag.js'
import HARDWARE_SCHEMA, {STM32_HARDWARE_KEYS} from '../utils/hardware-schema.js'
import {_arrayInput, _intInput, _uintInput} from '../utils/libs.js'
import {transport} from '../utils/transport.js'
import FEATURES from '../features.js'

/*
 * Dashboard port of html/src/pages/hardware-layout.js — see PORTING.md for what changed:
 * compile-time FEATURE blocks are evaluated at runtime, the schema is limited to the keys the
 * unified STM32 headers read, pins are STM32 names ("PE12"), the layout is read and written over
 * the USB config API, and the config-flash rows are read-only.
 */

/** A schema `feature: 'X'` / `'NOT X'` tag, resolved against the connected device. */
function featureEnabled(tag) {
    if (!tag) return true
    const negate = tag.startsWith('NOT ')
    const name = negate ? tag.slice(4) : tag
    const radio = FEATURES.RADIO_TYPE
    const flags = {
        IS_TX: FEATURES.IS_TX,
        IS_8285: false,
        HAS_SX127X: radio === 'SX127X',
        HAS_SX128X: radio === 'SX128X',
        // The firmware gates the dual-band rows (RF switch, power_values_dual) on LR1121; the
        // LR2021 is dual-band too.
        HAS_LR1121: radio === 'LR1121' || radio === 'LR2021',
    }
    return negate ? !flags[name] : !!flags[name]
}

function visibleSchema() {
    return HARDWARE_SCHEMA
        .filter(section => featureEnabled(section.feature))
        .map(section => ({
            ...section,
            rows: section.rows.filter(row => featureEnabled(row.feature) && STM32_HARDWARE_KEYS.includes(row.id)),
        }))
        .filter(section => section.rows.length)
}

// STM32 pin names: "P" + port letter + pin number, e.g. "PE12".
function _pinInput(e) {
    if (!/^[A-Za-z0-9]$/.test(e.key)) e.preventDefault()
}

@customElement('hardware-panel')
export class HardwarePanel extends LitElement {

    @state() accessor customised = false

    createRenderRoot() {
        return this
    }

    render() {
        return html`
            <div class="td-h2" style="margin-bottom: var(--td-s-4);">Hardware Layout</div>

            <div class="td-card" style="margin-bottom: var(--td-s-4);">
                <div class="td-card-header">
                    <span class="td-h4">Upload configuration</span>
                </div>
                <div class="td-card-body">
                    <p class="td-small td-mute" style="margin-bottom: var(--td-s-3);">
                        Upload target configuration file, then press "Save" below.
                    </p>
                    <file-drop id="filedrag" label="Upload" @file-drop=${this._onFileDrop}>or drop files here</file-drop>
                </div>
            </div>

            <div class="td-card">
                <div class="td-card-header">
                    <span class="td-h4">Pin configuration</span>
                    ${this.customised ? html`<span class="td-chip td-chip-warn">Customised</span>` : ''}
                </div>

                ${this.customised ? html`
                    <div class="td-card-body td-warning-banner">
                        This hardware configuration has been customised. Safe to ignore for custom hardware builds.
                        <a href="#" style="color: var(--td-brand);" @click=${this._download}>Download</a> it, or
                        use <em>Reset to default layout</em> below to return to the layout it was flashed with.
                    </div>
                ` : ''}

                <form id="upload_hardware">
                    ${this._renderTable()}
                    <div style="padding: var(--td-s-3) var(--td-s-4); border-top: 1px solid var(--td-line); display: flex; align-items: center; gap: var(--td-s-2);">
                        <div style="flex: 1;"></div>
                        ${this.customised ? html`
                            <button type="button" class="td-btn td-btn-danger"
                                    @click="${actionWithConfirm('Reset to default layout',
                                        'This discards the saved hardware layout and reboots the device into the layout it was flashed with. Continue?',
                                        'Reset & Reboot', 'An error occurred resetting the hardware layout',
                                        () => transport.resetHardware())}">
                                Reset to default layout
                            </button>
                        ` : ''}
                        <button type="button" class="td-btn td-btn-primary" @click=${this._submitConfig}>
                            Save Target Configuration
                        </button>
                    </div>
                </form>
            </div>
        `
    }

    _renderTable() {
        return html`
            <table class="td-table">
                <tbody>
                ${visibleSchema().map(section => html`
                    <tr class="td-table-section-header">
                        <td colspan="3">
                            <span class="td-xs">${section.title}</span>
                        </td>
                    </tr>
                    ${section.rows.map(row => html`
                        <tr>
                            <td style="color: var(--td-fg-mute);">${row.label}</td>
                            <td>${this._renderField(row)}</td>
                            <td class="td-small td-mute">${row.desc || ''}</td>
                        </tr>
                    `)}
                `)}
                </tbody>
            </table>
        `
    }

    _renderField(row) {
        if (row.readonly) {
            // Reaching a stored override needs these pins, so the device always takes them from
            // the flashed layout. Shown for reference, never submitted.
            return html`<input id="${row.id}" type="text" class="td-input td-input-mono" style="width: 60px; opacity: 0.6;"
                               readonly tabindex="-1"/>`
        }
        switch (row.type) {
            case 'checkbox':
                return html`<input id="${row.id}" name="${row.id}" type="checkbox" class="td-check"/>`
            case 'select':
                return html`<select id="${row.id}" name="${row.id}" class="td-select" style="width: auto;">
                    ${row.options?.map(opt => html`
                        <option value="${opt.value}">${opt.label}</option>`)}
                </select>`
            case 'int':
                return html`<input id="${row.id}" name="${row.id}" size=${row.size ?? 3} maxlength=${row.size ?? 3}
                                   type="text" class="td-input td-input-mono" style="width: 60px;"
                                   @keypress="${_intInput}"/>`
            case 'uint':
                // Every uint row the STM32 key list keeps is a pin, and STM32 pins are names.
                if (row.icon) {
                    return html`<input id="${row.id}" name="${row.id}" size=${row.size ?? 4} maxlength=${row.size ?? 4}
                                       type="text" class="td-input td-input-mono pin" style="width: 60px; text-transform: uppercase;"
                                       @keypress="${_pinInput}"/>`
                }
                return html`<input id="${row.id}" name="${row.id}" size=${row.size ?? 3} maxlength=${row.size ?? 3}
                                   type="text" class="td-input td-input-mono" style="width: 60px;"
                                   @keypress="${_uintInput}"/>`
            case 'array':
                return html`<input id="${row.id}" name="${row.id}" size=${row.size ?? nothing}
                                   maxlength=${row.size ?? nothing} type="text" class="td-input td-input-mono array"
                                   @keypress="${_arrayInput}"/>`
        }
    }

    connectedCallback() {
        super.connectedCallback()
        this._loadData()
    }

    _loadData() {
        Promise.resolve(transport.getHardware())
            .then((data) => {
                this.customised = !!data.customised
                // Wait for the table to exist before filling it in.
                return this.updateComplete.then(() => this._updateHardwareSettings(data))
            })
            .catch(async (err) => {
                await errorAlert('Hardware Layout', (err && err.message) || 'Could not read the hardware layout')
            })
    }

    _download(e) {
        e.preventDefault()
        Promise.resolve(transport.getHardware())
            .then((data) => {
                const text = JSON.stringify(data, null, 2)
                const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}))
                const a = document.createElement('a')
                a.href = url
                a.download = 'hardware.json'
                document.body.appendChild(a)
                a.click()
                a.remove()
                setTimeout(() => URL.revokeObjectURL(url), 1000)
            })
            .catch(() => {})
    }

    _onFileDrop(e) {
        const files = e.detail.files
        const form = document.getElementById('upload_hardware')
        if (form) form.reset()
        for (const file of files) {
            const reader = new FileReader()
            reader.onload = (ev) => {
                let data
                try {
                    data = JSON.parse(ev.target.result)
                } catch {
                    errorAlert('Upload Failed', 'The file is not a valid hardware layout (JSON)')
                    return
                }
                // The config-flash pins always come from the flashed layout; an imported file
                // cannot change them, so do not show its values either.
                for (const row of HARDWARE_SCHEMA.flatMap(s => s.rows)) {
                    if (row.readonly) delete data[row.id]
                }
                this._updateHardwareSettings(data)
            }
            reader.readAsText(file)
        }
    }

    _updateHardwareSettings(data) {
        for (const [key, value] of Object.entries(data)) {
            const el = document.getElementById(key)
            if (el) {
                if (el.type === 'checkbox') {
                    el.checked = !!value
                } else {
                    el.value = Array.isArray(value) ? value.toString() : value
                }
            }
        }
    }

    _submitConfig() {
        const form = document.getElementById('upload_hardware')
        const formData = new FormData(form)
        const body = JSON.stringify(Object.fromEntries(formData), (k, v) => {
            if (v === '') return undefined
            const el = document.getElementById(k)
            if (el && el.type === 'checkbox') return v === 'on'
            if (el && el.classList.contains('array')) {
                const arr = v.split(',').map((element) => Number(element))
                return arr.length === 0 ? undefined : arr
            }
            if (el && el.classList.contains('pin') && isNaN(v)) return v.toUpperCase()
            return isNaN(v) ? v : +v
        })
        // The read-only config-flash rows carry no `name`, so FormData never includes them.
        saveAndReboot('Save & Reboot', 'Upload Failed', (doc) => transport.saveHardware(doc),
            {...JSON.parse(body), customised: true}, () => { this.customised = true },
            {message: 'The hardware layout is applied when the device boots. Save it and reboot now?'})
        return false
    }
}
