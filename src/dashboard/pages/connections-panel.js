import {html, LitElement} from "lit";
import {customElement} from "lit/decorators.js";
import {elrsState, saveConfig} from "../utils/state.js";
import {_} from "../utils/libs.js";
import {actionWithConfirm} from "../utils/feedback.js";
import {transport} from "../utils/transport.js";

export const PWM_MODE_SERIAL = 10;
export const PWM_MODE_SERIAL2RX = 14;
export const PWM_MODE_SERIAL2TX = 15;

@customElement('connections-panel')
class ConnectionsPanel extends LitElement {
    pinModes = []
    pinRxIndex = undefined
    pinTxIndex = undefined

    createRenderRoot() {
        return this
    }

    render() {
        return html`
            <style>
                .connections-panel-root { container-type: inline-size; }
                .connections-panel-root .connections-mobile-warning { display: none; }
                .connections-panel-root select:disabled,
                .connections-panel-root input:disabled { opacity: 0.3; cursor: not-allowed; }
                @container (max-width: 80ch) {
                    .connections-panel-root .connections-mobile-warning { display: block; }
                    .connections-panel-root .connections-panel { display: none !important; }
                }
                @supports not (container-type: inline-size) {
                    @media (max-width: 48em) {
                        .connections-panel-root .connections-mobile-warning { display: block; }
                        .connections-panel-root .connections-panel { display: none !important; }
                    }
                }
            </style>
            <div class="connections-panel-root">
                <div class="td-h2" style="margin-bottom: var(--td-s-4);">PWM Pin Functions</div>
                <div class="connections-mobile-warning td-card" style="margin-bottom: var(--td-s-4);">
                    <div class="td-card-header">
                        <span class="td-h4">Rotate to landscape</span>
                        <span class="td-chip td-chip-warn">Screen too narrow</span>
                    </div>
                    <div class="td-card-body td-mute td-small">
                        The connections panel requires landscape orientation on small screens.
                    </div>
                </div>
                <div class="td-card connections-panel">
                    <div class="td-card-header">
                        <span class="td-h4">PWM output configuration</span>
                    </div>
                    <div style="overflow-x: auto;">
                        <table class="td-table td-table-roomy" style="min-width: 700px;">
                            <thead>
                                <tr>
                                    <th>Output</th>
                                    <th>Features</th>
                                    <th>Mode</th>
                                    <th>Input</th>
                                    <th style="text-align:center;">Invert</th>
                                    <th style="text-align:center;">Stretch</th>
                                    <th>Failsafe Mode</th>
                                    <th>Failsafe Pos</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${this._renderConnectionPins()}
                            </tbody>
                        </table>
                    </div>
                    <div style="padding: var(--td-s-3) var(--td-s-4); border-top: 1px solid var(--td-line); display: flex; gap: 8px; align-items: center;">
                        <div style="flex: 1;"></div>
                        ${elrsState.options.customised ? html`
                            <button class="td-btn td-btn-danger"
                                    @click="${actionWithConfirm('Reset to defaults',
                                        'This discards the configuration saved on the device, restores the values it was flashed with and reboots it. Continue?',
                                        'Reset & Reboot', 'An error occurred resetting the configuration',
                                        () => transport.reset({config: true}))}">
                                Reset to defaults
                            </button>
                        ` : ''}
                        <button class="td-btn td-btn-primary" @click="${this._savePwmConfig}">Save &amp; Reboot</button>
                    </div>
                    <div class="td-divider"></div>
                    <div style="padding: var(--td-s-3) var(--td-s-4);">
                        <ul class="td-small td-mute" style="padding-left: 16px; margin: 0; line-height: 2;">
                            <li><strong class="td-fg">Output</strong> — receiver output pin</li>
                            <li><strong class="td-fg">Mode</strong> — output frequency, duty cycle, digital, DShot, Serial, or I2C</li>
                            <li><strong class="td-fg">Input</strong> — handset channel</li>
                            <li><strong class="td-fg">Invert</strong> — invert channel position</li>
                            <li><strong class="td-fg">Stretch</strong> — widen pulse to 500–2500 us</li>
                            <li><strong class="td-fg">Failsafe</strong> — Set Position / No Pulses / Last Position</li>
                        </ul>
                    </div>
                </div>
            </div>
        `;
    }

    firstUpdated() {
        elrsState.config.pwm.forEach((item, index) => {
            const modeField = _(`pwm_${index}_mode`)
            this._pinModeChange(modeField, index)
            const failsafeModeField = _(`pwm_${index}_fsmode`)
            this._failsafeModeChange(failsafeModeField, index)
        })
    }

    _enumSelectGenerate(id, val, arOptions, onchange) {
        return html`
            <select id="${id}" @change="${onchange}">
                ${arOptions.map((item, idx) => {
                    if (item) {
                        return html`<option value="${idx}" ?selected=${idx === val}>${item}</option>`
                    }
                    return null
                })}
            </select>
        `
    }

    _generateFeatureBadges(features) {
        let str = []
        if (!!(features & 1)) str.push(html`<span class="td-chip td-chip-mono" style="font-size:10px; height:16px; padding: 0 5px;">TX</span>`)
        else if (!!(features & 2)) str.push(html`<span class="td-chip td-chip-mono" style="font-size:10px; height:16px; padding: 0 5px;">RX</span>`)
        if ((features & 12) === 12) str.push(html`<span class="td-chip" style="font-size:10px; height:16px; padding: 0 5px;">I2C</span>`)
        else if (!!(features & 4)) str.push(html`<span class="td-chip" style="font-size:10px; height:16px; padding: 0 5px;">SCL</span>`)
        else if (!!(features & 8)) str.push(html`<span class="td-chip" style="font-size:10px; height:16px; padding: 0 5px;">SDA</span>`)
        if ((features & 96) === 96) str.push(html`<span class="td-chip td-chip-info" style="font-size:10px; height:16px; padding: 0 5px;">Serial2</span>`)
        else if (!!(features & 32)) str.push(html`<span class="td-chip td-chip-info" style="font-size:10px; height:16px; padding: 0 5px;">RX2</span>`)
        else if (!!(features & 64)) str.push(html`<span class="td-chip td-chip-info" style="font-size:10px; height:16px; padding: 0 5px;">TX2</span>`)
        return str
    }

    _renderConnectionPins() {
        this.pinRxIndex = undefined
        this.pinTxIndex = undefined
        this.pinModes = []
        const htmlFields = []
        elrsState.config.pwm.forEach((item, index) => {
            const failsafe = (item.config & 2047) + 476;
            const ch = (item.config >> 11) & 15;
            const inv = (item.config >> 15) & 1;
            const mode = (item.config >> 16) & 15;
            const stretch = (item.config >> 20) & 1;
            const failsafeMode = (item.config >> 22) & 3;
            const features = item.features
            const modes = ['50Hz', '60Hz', '100Hz', '160Hz', '333Hz', '400Hz', '10KHzDuty', 'On/Off']
            if (features & 16) {
                modes.push('DShot', 'DShot-3D');
            } else {
                modes.push(undefined, undefined)
            }
            if (features & 1) {
                this.pinRxIndex = index
                modes.push('Serial TX')
            } else if (features & 2) {
                this.pinTxIndex = index
                modes.push('Serial RX')
            } else {
                modes.push(undefined)
            }
            modes.push(features & 4 ? 'I2C SCL' : undefined)
            modes.push(features & 8 ? 'I2C SDA' : undefined)
            modes.push(undefined)
            modes.push(features & 32 ? 'Serial2 RX' : undefined)
            modes.push(features & 64 ? 'Serial2 TX' : undefined)

            htmlFields.push(html`
                <tr>
                    <td class="td-mono" style="text-align:center;">${index + 1}</td>
                    <td>${this._generateFeatureBadges(features)}</td>
                    <td>${this._enumSelectGenerate(`pwm_${index}_mode`, mode, modes, (e) => {this._pinModeChange(e.target, index)})}</td>
                    <td>${this._enumSelectGenerate(`pwm_${index}_ch`, ch,
                            ['ch1','ch2','ch3','ch4','ch5 (AUX1)','ch6 (AUX2)','ch7 (AUX3)','ch8 (AUX4)',
                             'ch9 (AUX5)','ch10 (AUX6)','ch11 (AUX7)','ch12 (AUX8)',
                             'ch13 (AUX9)','ch14 (AUX10)','ch15 (AUX11)','ch16 (AUX12)'])}</td>
                    <td style="text-align:center;"><input type="checkbox" id="pwm_${index}_inv" ?checked="${inv}"></td>
                    <td style="text-align:center;"><input type="checkbox" id="pwm_${index}_stretch" ?checked="${stretch}"></td>
                    <td>${this._enumSelectGenerate(`pwm_${index}_fsmode`, failsafeMode,
                            ['Set Position', 'No Pulses', 'Last Position'],
                            (e) => {this._failsafeModeChange(e.target, index)})}</td>
                    <td><input id="pwm_${index}_fs" type="number" value="${failsafe}" size="6" style="width:70px;"/></td>
                </tr>
            `);
            this.pinModes[index] = mode
        });
        return htmlFields
    }

    _pinModeChange(pinMode, index) {
        const setDisabled = (index, onoff) => {
            _(`pwm_${index}_ch`).disabled = onoff
            _(`pwm_${index}_inv`).disabled = onoff
            _(`pwm_${index}_stretch`).disabled = onoff
            _(`pwm_${index}_fs`).disabled = onoff
            _(`pwm_${index}_fsmode`).disabled = onoff
        }
        setDisabled(index, Number.parseInt(pinMode.value) >= PWM_MODE_SERIAL);
        const updateOthers = (value, enable) => {
            if (value > PWM_MODE_SERIAL) {
                elrsState.config.pwm.forEach((item, other) => {
                    if (other !== index) {
                        document.querySelectorAll(`#pwm_${other}_mode option`).forEach(opt => {
                            if (opt.value === value) opt.disabled = enable
                        })
                    }
                })
            }
        }
        updateOthers(pinMode.value, true)
        updateOthers(this.pinModes[index], false)
        this.pinModes[index] = pinMode.value

        if (this.pinRxIndex !== undefined && this.pinTxIndex !== undefined) {
            const pinRxMode = _(`pwm_${this.pinRxIndex}_mode`)
            const pinTxMode = _(`pwm_${this.pinTxIndex}_mode`)
            const pinRxModeValue = Number.parseInt(pinRxMode.value)
            const pinTxModeValue = Number.parseInt(pinTxMode.value)
            if (index === this.pinRxIndex) {
                if (pinRxModeValue === PWM_MODE_SERIAL) {
                    pinTxMode.value = PWM_MODE_SERIAL
                    setDisabled(this.pinRxIndex, true)
                    setDisabled(this.pinTxIndex, true)
                    pinTxMode.disabled = true
                } else if (pinTxModeValue === PWM_MODE_SERIAL) {
                    pinTxMode.value = 0
                    setDisabled(this.pinRxIndex, false)
                    setDisabled(this.pinTxIndex, false)
                    pinTxMode.disabled = false
                }
            }
            if (index === this.pinTxIndex) {
                if (pinTxModeValue === PWM_MODE_SERIAL) {
                    pinRxMode.value = PWM_MODE_SERIAL
                    setDisabled(this.pinRxIndex, true)
                    setDisabled(this.pinTxIndex, true)
                    pinTxMode.disabled = true
                }
            }
            const pinTx = pinTxMode.value
            if (pinRxModeValue !== PWM_MODE_SERIAL) pinTxMode.value = pinTx
        }
    }

    _failsafeModeChange(failsafeMode, index) {
        const mode = _(`pwm_${index}_mode`).value
        if (mode < PWM_MODE_SERIAL) {
            const failsafeField = _(`pwm_${index}_fs`)
            if (failsafeMode.value === '0') {
                failsafeField.disabled = false
                failsafeField.style.display = 'block'
            } else {
                failsafeField.disabled = true
                failsafeField.style.display = 'none'
            }
        }
    }

    _getPwmFormData() {
        let ch = 0
        let inField
        const outData = []
        while (inField = _(`pwm_${ch}_ch`)) {
            const inChannel = inField.value
            const mode = _(`pwm_${ch}_mode`).value
            const invert = _(`pwm_${ch}_inv`).checked ? 1 : 0
            const stretch = _(`pwm_${ch}_stretch`).checked ? 1 : 0
            const failsafeField = _(`pwm_${ch}_fs`)
            const failsafeModeField = _(`pwm_${ch}_fsmode`)
            let failsafe = failsafeField.value
            if (failsafe > 2523) failsafe = 2523;
            if (failsafe < 476) failsafe = 476;
            failsafeField.value = failsafe
            let failsafeMode = failsafeModeField.value
            const raw = (failsafeMode << 22) | (stretch << 20) | (mode << 16) | (invert << 15) | (inChannel << 11) | (failsafe - 476)
            outData.push(raw)
            ++ch
        }
        return outData
    }

    _savePwmConfig(e) {
        e.preventDefault();
        const data = this._getPwmFormData()
        saveConfig({'pwm': data})
    }

    checkChanged() {
        const data = this._getPwmFormData()
        for (let i = 0; i < data.length; i++) {
            if (elrsState.config.pwm[i].config !== data[i]) return true
        }
        return false
    }
}
