import {html, LitElement} from "lit"
import {customElement, state} from "lit/decorators.js"
import {_uintInput} from "../utils/libs.js"
import {elrsState, saveConfig, saveOptionsAndConfig} from "../utils/state.js"
import {actionWithConfirm} from "../utils/feedback.js"
import {transport} from "../utils/transport.js"
import FEATURES from "../features.js"

@customElement('rx-options-panel')
class RxOptionsPanel extends LitElement {
    @state() accessor domain
    @state() accessor enableModelMatch
    @state() accessor lockOnFirst
    @state() accessor modelId
    @state() accessor forceTlmOff

    createRenderRoot() {
        this.domain = elrsState.options.domain
        this.lockOnFirst = elrsState.options['lock-on-first-connection']
        this.enableModelMatch = elrsState.config.modelid !== undefined && elrsState.config.modelid !== 255
        this.modelId = elrsState.config.modelid === undefined ? 0 : elrsState.config.modelid
        this.forceTlmOff = elrsState.config['force-tlm']
        this.save = this.save.bind(this)
        return this
    }

    render() {
        return html`
            <div class="td-row td-spread" style="margin-bottom: var(--td-s-4);">
                <span class="td-h2">Runtime Options</span>
                ${elrsState.options.customised ? html`<span class="td-chip td-chip-warn">Modified</span>` : ''}
            </div>
            <div class="td-card" style="margin-bottom: var(--td-s-4);">
                <div class="td-card-header">
                    <span class="td-h4">RF &amp; Protocol</span>
                </div>

                ${FEATURES.HAS_SUBGHZ ? html`
                <div class="td-card-row">
                    <span class="td-label">Regulatory domain</span>
                    <select class="td-select" style="width: auto;"
                            ?disabled="${!FEATURES.OPTIONS_WRITABLE}"
                            @change="${(e) => this.domain = parseInt(e.target.value)}"
                            .value="${this.domain}">
                        ${['AU915', 'FCC915', 'EU868', 'IN866', 'AU433', 'EU433', 'US433', 'US433-Wide'].map((d, i) => html`
                            <option value="${i}" ?selected="${this.domain === i}">${d}</option>
                        `)}
                    </select>
                </div>
                ` : ''}

                <div class="td-card-row">
                    <span class="td-label">Lock on first connection</span>
                    <div class="td-row td-gap-3">
                        <span class="td-toggle ${this.lockOnFirst ? 'is-on' : ''}"
                              style="${FEATURES.OPTIONS_WRITABLE ? '' : 'opacity: 0.5; cursor: not-allowed;'}"
                              @click="${() => {
                                  if (!FEATURES.OPTIONS_WRITABLE) return
                                  this.lockOnFirst = !this.lockOnFirst
                                  this.requestUpdate()
                              }}"></span>
                        <span class="td-small td-mute">Stop cycling RF modes once linked</span>
                    </div>
                </div>

                <div class="td-card-row">
                    <span class="td-label">Model Match</span>
                    <div class="td-row td-gap-3">
                        <span class="td-toggle ${this.enableModelMatch ? 'is-on' : ''}"
                              @click="${() => { this.enableModelMatch = !this.enableModelMatch; this.requestUpdate() }}"></span>
                        <span class="td-small td-mute">Restrict RX to specific handset model ID</span>
                    </div>
                </div>

                ${this.enableModelMatch ? html`
                    <div class="td-card-row">
                        <span class="td-label">Receiver ID</span>
                        <div class="td-field">
                            <input class="td-input td-input-mono" id="modelId" min="0" max="63" type="number" required
                                   style="width: 80px;"
                                   @change="${(e) => this.modelId = parseInt(e.target.value)}"
                                   .value="${this.modelId}"
                                   @keypress="${_uintInput}"/>
                            <span class="td-field-help">0 – 63</span>
                        </div>
                    </div>
                ` : ''}

                <div class="td-card-row">
                    <span class="td-label">Force telemetry off</span>
                    <div class="td-row td-gap-3">
                        <span class="td-toggle ${this.forceTlmOff ? 'is-on' : ''}"
                              @click="${() => { this.forceTlmOff = !this.forceTlmOff; this.requestUpdate() }}"></span>
                        <span class="td-small td-mute">Never send telemetry (for multi-RX setups)</span>
                    </div>
                </div>

                <div style="padding: var(--td-s-3) var(--td-s-4); border-top: 1px solid var(--td-line); display: flex; align-items: center; gap: var(--td-s-2);">
                    <div style="flex: 1;"></div>
                    ${elrsState.options.customised ? html`
                        <button class="td-btn td-btn-danger"
                                @click="${actionWithConfirm('Reset to defaults',
                                    'Restore the original values (including bind phrase) and reboot?',
                                    'Reset & Reboot', 'An error occurred resetting runtime options',
                                    () => transport.reset({options: true}))}">
                            Reset to defaults
                        </button>
                    ` : ''}
                    <button class="td-btn td-btn-primary"
                            ?disabled="${!this.checkChanged()}"
                            @click="${this.save}">${FEATURES.OPTIONS_WRITABLE ? 'Save & Reboot' : 'Save'}</button>
                </div>
            </div>
        `
    }

    save(e) {
        e.preventDefault()
        const config = {
            'modelid': this.enableModelMatch ? this.modelId : 255,
            'force-tlm': this.forceTlmOff
        }
        if (!FEATURES.OPTIONS_WRITABLE) {
            // Options are read-only on this firmware — save only the config half.
            saveConfig(config, () => {
                this.modelId = config.modelid
                return this.requestUpdate()
            })
            return
        }
        const changes = {
            options: {
                ...(FEATURES.HAS_SUBGHZ ? {'domain': this.domain} : {}),
                'lock-on-first-connection': this.lockOnFirst,
            },
            config
        }
        saveOptionsAndConfig(changes, () => {
            this.modelId = changes.config.modelid
            return this.requestUpdate()
        })
    }

    checkChanged() {
        let changed = false
        if (FEATURES.OPTIONS_WRITABLE) {
            if (FEATURES.HAS_SUBGHZ) changed |= this.domain !== elrsState.options['domain']
            changed |= this.lockOnFirst !== elrsState.options['lock-on-first-connection']
        }
        changed |= this.enableModelMatch && this.modelId !== elrsState.config['modelid']
        changed |= !this.enableModelMatch && this.modelId !== 255
        changed |= this.forceTlmOff !== elrsState.config['force-tlm']
        return !!changed
    }
}
