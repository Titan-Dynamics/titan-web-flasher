import {html, LitElement} from "lit";
import {customElement, query, state} from "lit/decorators.js";
import {elrsState, saveConfig, saveOptions} from "../utils/state.js";
import {calcMD5} from "../utils/md5.js";
import FEATURES from "../features.js"

@customElement('binding-panel')
class BindingPanel extends LitElement {
    @query('#phrase') accessor phrase
    @query('#uid-direct') accessor uidDirectEl

    @state() accessor uid = []
    @state() accessor bindType = 0
    @state() accessor uidData = {}
    @state() accessor uidSource = 'current'
    @state() accessor canResetToUnbound = false

    originalUIDType = ''
    originalUID = []

    createRenderRoot() {
        this._submitOptions = this._submitOptions.bind(this)
        return this
    }

    firstUpdated(_changedProperties) {
        this.uid = this._savedUID()
        this.bindType = elrsState.config.vbind
        this.originalUID = this.uid
        this.originalUIDType = (elrsState.settings && elrsState.settings.uidtype) ? elrsState.settings.uidtype : ''
        this._updateUIDType(this.originalUIDType)
    }

    // The UID this panel edits, which is not always the one the radio is running on.
    _savedUID() {
        // On a TX the binding phrase lives in the options block and is only copied into the
        // running UID during setup(), so `config.uid` keeps reporting the pre-save value until
        // the module reboots. Read the saved value, or the panel appears to discard the save
        // every time it is re-rendered (tab switch, reconnect).
        if (FEATURES.IS_TX) {
            const saved = elrsState.options && elrsState.options.uid
            if (Array.isArray(saved) && saved.length) return saved.slice()
        }
        return elrsState.config.uid
    }

    render() {
        const uidChipClass = this._uidChipClass()
        const isDirty = this.uidData.uidtype === 'Modified'
        const uidStr = Array.isArray(this.uid) && this.uid.length ? this.uid.join(',') : '\u2014'
        const sourceChipClass = this.uidSource === 'invalid' ? 'td-chip-bad' : isDirty ? 'td-chip-brand' : ''
        return html`
            <div class="td-row td-spread" style="margin-bottom: var(--td-s-4);">
                <span class="td-h2">Binding</span>
                ${this.uidData.uidtype ? html`
                    <span class="td-chip ${uidChipClass}">${this.uidData.uidtype}</span>
                ` : ''}
            </div>
            <div class="td-card">
                <div class="td-card-header">
                    <span class="td-h4">Binding configuration</span>
                </div>

                ${!FEATURES.IS_TX ? html`
                <div class="td-card-row">
                    <span class="td-label">Binding storage</span>
                    <select class="td-select" style="width: auto;" @change="${(e) => {this.bindType = parseInt(e.target.value)}}" .value="${this.bindType}">
                        <option value="0">Persistent (Default)</option>
                        <option value="1">Volatile</option>
                        <option value="2">Returnable</option>
                        <option value="3">Administered</option>
                    </select>
                </div>
                ` : ''}

                ${this.bindType !== 1 ? html`
                    <div class="td-card-body">
                        <p class="td-small td-mute" style="margin-bottom: var(--td-s-4);">
                            Enter a new binding phrase to replace the current binding information. This will persist across reboots, but will be reset if the firmware is flashed with a binding phrase. Note: The Binding phrase is not remembered; it is a temporary field used to generate the binding UID. You may also enter a binding UID directly (as six comma-separated numbers),
which will be copied to the UID field and used as-is.
                        </p>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--td-s-4); margin-bottom: var(--td-s-4);">
                            <div class="td-field">
                                <label class="td-field-label">Binding phrase</label>
                                <input class="td-input" type="text" id="phrase"
                                       style="height: 40px;"
                                       placeholder="e.g. my bind phrase"
                                       autocomplete="off" spellcheck="false"
                                       @input="${this._onPhraseInput}"/>
                                <span class="td-field-help">Hashed into the UID. Not stored on device.</span>
                            </div>
                            <div class="td-field">
                                <label class="td-field-label">Binding UID</label>
                                <input class="td-input td-input-mono" type="text" id="uid-direct"
                                       style="height: 40px;"
                                       placeholder="85,132,48,83,229,41"
                                       autocomplete="off" spellcheck="false"
                                       @input="${this._onUidInput}"/>
                                <span class="td-field-help">Six bytes, comma separated (0\u2013255 each).</span>
                            </div>
                        </div>

                        <div class="td-uid-preview" style="margin-bottom: var(--td-s-3); height: 40px;">
                            <span class="td-xs">Resolved UID</span>
                            <span class="td-mono" style="flex: 1; ${isDirty ? 'color: var(--td-warn);' : ''}">${uidStr}</span>
                            <span class="td-chip ${sourceChipClass}" style="width: fit-content;">${this.uidSource}</span>
                        </div>

                        ${!FEATURES.IS_TX && this.uidData.uidtype === 'Loaned' ? html`
                            <div class="td-notice" style="margin-bottom: var(--td-s-3);">
                                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="var(--td-warn)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;"><circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v3.5M8 5.25v.01"/></svg>
                                <p class="td-small td-mute" style="margin: 0; line-height: 1.5;">
                                    This receiver is currently <strong>on loan</strong> from another transmitter.
                                    Saving here will only update what is restored on return.
                                </p>
                            </div>
                        ` : ''}
                    </div>
                ` : ''}

                <div style="padding: var(--td-s-3) var(--td-s-4); border-top: 1px solid var(--td-line); display: flex; align-items: center; gap: var(--td-s-2);">
                    <div style="flex: 1;"></div>
                    ${!FEATURES.IS_TX ? html`
                        <button class="td-btn td-btn-danger"
                                @click="${this._resetToUnbound}">Reset to Unbound</button>
                    ` : ''}
                    ${this._canSave() ? html`
                        <button class="td-btn td-btn-primary"
                                ?disabled=${!this.checkChanged() || this.uidSource === 'invalid'}
                                @click="${this._submitOptions}">Save &amp; Reboot</button>
                    ` : html`
                        <span class="td-small td-mute">Read-only — the TX binding phrase is set when the firmware is flashed</span>
                    `}
                </div>
            </div>
        `
    }

    _uidChipClass() {
        const type = this.uidData.uidtype || ''
        if (!type || type.startsWith('Not set')) return 'td-chip-bad'
        switch (type) {
            case 'Flashed':    return 'td-chip-info'    // blue  — baked in at build time
            case 'Overridden': return 'td-chip-ok'      // green — set via web UI
            case 'Bound':      return 'td-chip-ok'      // green — receiver is linked
            case 'Modified':   return 'td-chip-violet'  // purple — unsaved pending change
            case 'Not Bound':  return 'td-chip-warn'    // amber  — will enter bind mode
            case 'Loaned':     return 'td-chip-warn'    // amber  — temporary loan
            case 'Volatile':   return 'td-chip-warn'    // amber  — transient, won't persist
            default:           return ''
        }
    }

    _onPhraseInput(e) {
        const text = e.target.value
        if (this.uidDirectEl) this.uidDirectEl.value = ''
        if (!text.trim()) {
            this.uid = this.originalUID.slice()
            this.uidSource = 'current'
            this._updateUIDType(this.originalUIDType)
        } else {
            const bindingPhraseFull = `-DMY_BINDING_PHRASE="${text.trim()}"`
            this.uid = [...calcMD5(bindingPhraseFull).subarray(0, 6)]
            this.uidSource = 'from phrase'
            this._updateUIDType('Modified')
        }
    }

    _onUidInput(e) {
        const text = e.target.value.trim()
        if (this.phrase) this.phrase.value = ''
        if (!text) {
            this.uid = this.originalUID.slice()
            this.uidSource = 'current'
            this._updateUIDType(this.originalUIDType)
        } else {
            const parsed = this._parseDirectUID(text)
            if (parsed) {
                this.uid = parsed
                this.uidSource = 'from UID'
                this._updateUIDType('Modified')
            } else {
                this.uidSource = 'invalid'
                this.uidData = { ...this.uidData }
            }
        }
    }

    _parseDirectUID(text) {
        if (!/^[0-9, ]+$/.test(text)) return null
        const parts = text.split(',').filter(s => this._isValidUidByte(s)).map(Number)
        if (parts.length < 4 || parts.length > 6) return null
        while (parts.length < 6) parts.unshift(0)
        return parts
    }

    _discard() {
        if (this.phrase) this.phrase.value = ''
        if (this.uidDirectEl) this.uidDirectEl.value = ''
        this.uid = this.originalUID.slice()
        this.uidSource = 'current'
        this._updateUIDType(this.originalUIDType)
        this.requestUpdate()
    }

    _resetToUnbound() {
        const zeroUID = [0,0,0,0,0,0]
        saveConfig({ uid: zeroUID, vbind: 0 }, () => {
            this.originalUID = zeroUID
            this.originalUIDType = ''
            this.bindType = 0
            if (this.phrase) this.phrase.value = ''
            if (this.uidDirectEl) this.uidDirectEl.value = ''
            this.uidSource = 'current'
            this._updateUIDType('Not bound')
            return this.requestUpdate()
        }, {
            title: 'Reset to Unbound',
            message: 'This clears the binding on this receiver and reboots it. It will wait to be bound again. Continue?',
            confirmText: 'Reset & Reboot',
        })
    }

    _isValidUidByte(s) {
        let f = parseFloat(s)
        return !isNaN(f) && isFinite(s) && Number.isInteger(f) && f >= 0 && f < 256
    }

    #UID_CONFIG = {
        'Flashed':          { uidtype: 'Flashed' },
        'Overridden':       { uidtype: 'Overridden' },
        'Modified':         { uidtype: 'Modified' },
        'Volatile':         { uidtype: 'Volatile' },
        'Loaned':           { uidtype: 'Loaned' },
        'DEFAULT_NOT_SET':  { uidtype: 'Not set' },
        'RX_NOT_BOUND':     { uidtype: 'Not bound' },
        'RX_BOUND':         { uidtype: 'Bound' },
    }

    _updateUIDType(uidtype) {
        let config
        if (!uidtype || uidtype.startsWith('Not set')) {
            config = this.#UID_CONFIG.DEFAULT_NOT_SET
        } else if (this.#UID_CONFIG[uidtype]) {
            config = this.#UID_CONFIG[uidtype]
        } else {
            const configKey = this.uid.toString().endsWith('0,0,0,0') ? 'RX_NOT_BOUND' : 'RX_BOUND'
            config = this.#UID_CONFIG[configKey]
        }
        this.uidData = { uidtype: config.uidtype || uidtype }
    }

    /** RX binding always saves; TX binding needs writable options. */
    _canSave() {
        return !FEATURES.IS_TX || FEATURES.OPTIONS_WRITABLE
    }

    _submitOptions(e) {
        e.stopPropagation()
        e.preventDefault()

        if (FEATURES.IS_TX) {
            // TX binding lives in the options block, which is only writable on firmware that
            // reports HELLO feature bit0 (the dynamic-options follow-up).
            if (!FEATURES.OPTIONS_WRITABLE) return
            const tx_changes = { customised: true, uid: this.uid }
            // The UID is only applied during setup(), so this is a confirm-save-reboot flow.
            saveOptions(tx_changes, () => {
                this.originalUID = this.uid
                this.originalUIDType = 'Overridden'
                if (this.phrase) this.phrase.value = ''
                if (this.uidDirectEl) this.uidDirectEl.value = ''
                this.uidSource = 'current'
                this._updateUIDType(this.originalUIDType)
                return this.requestUpdate()
            }, {reboot: true})
            return
        }
        // RX binding saves through config.uid, which is always writable.
        const rx_changes = { uid: this.uid, vbind: this.bindType }
        saveConfig(rx_changes, () => {
            if (this.bindType !== 1) {
                this.originalUID = this.uid
                this.originalUIDType = 'Overridden'
                if (this.phrase) this.phrase.value = ''
                if (this.uidDirectEl) this.uidDirectEl.value = ''
                this.uidSource = 'current'
                this._updateUIDType(this.originalUIDType)
            }
            return this.requestUpdate()
        })
    }

    checkChanged() {
        return (this.bindType !== elrsState.config.vbind || this.uidData.uidtype === 'Modified')
            && this.uidSource !== 'invalid'
    }
}
