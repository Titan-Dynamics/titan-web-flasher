import {html, LitElement} from "lit";
import {customElement} from "lit/decorators.js";
import {elrsState, saveConfig} from "../utils/state.js";
import {_, _renderOptions} from "../utils/libs.js";
import {transport} from "../utils/transport.js";

@customElement('buttons-panel')
class ButtonsPanel extends LitElement {

    colorTimer = undefined;
    colorUpdated = false;
    buttonActions = [];

    createRenderRoot() {
        this._timeoutCurrentColors = this._timeoutCurrentColors.bind(this);
        this._checkEnableButtonActionSave = this._checkEnableButtonActionSave.bind(this);
        return this;
    }

    render() {
        return html`
            <div class="td-h2" style="margin-bottom: var(--td-s-4);">Buttons &amp; Actions</div>
            <div class="td-card">
                <div class="td-card-header">
                    <span class="td-h4">Button action mapping</span>
                </div>
                ${elrsState.config['button-actions'] ? html`
                    <table class="td-table td-table-roomy">
                        <thead>
                            <tr>
                                <th>Button</th>
                                <th>Action</th>
                                <th>Press type</th>
                                <th>Count / Duration</th>
                            </tr>
                        </thead>
                        <tbody id="button-actions">
                            ${this._appendButtonActions()}
                        </tbody>
                    </table>
                ` : ''}
                ${this.buttonActions[0] && this.buttonActions[0]['color'] !== undefined ? html`
                    <div class="td-card-row">
                        <span class="td-label">Button 1 color</span>
                        <input type="color"
                               @input="${(e) => this._changeCurrentColors(e, 0)}"
                               .value="${this._toRGB(this.buttonActions[0]['color'])}"/>
                    </div>
                ` : ''}
                ${this.buttonActions[1] && this.buttonActions[1]['color'] !== undefined ? html`
                    <div class="td-card-row">
                        <span class="td-label">Button 2 color</span>
                        <input type="color"
                               @input="${(e) => this._changeCurrentColors(e, 1)}"
                               .value="${this._toRGB(this.buttonActions[1]['color'])}"/>
                    </div>
                ` : ''}
                <div style="padding: var(--td-s-3) var(--td-s-4); border-top: 1px solid var(--td-line); display: flex; align-items: center;">
                    <div style="flex: 1;"></div>
                    <button class="td-btn td-btn-primary"
                            @click="${this._submitButtonActions}"
                            ?disabled="${this._checkEnableButtonActionSave()}">Save &amp; Reboot</button>
                </div>
            </div>
        `;
    }

    _appendButtonActions() {
        let result = []
        this.buttonActions = elrsState.config['button-actions'];
        for (const [b, _v] of Object.entries(this.buttonActions)) {
            for (const [p, v] of Object.entries(_v.action)) {
                result.push(this._appendButtonActionRow(parseInt(b), parseInt(p), v));
            }
        }
        return result
    }

    _appendButtonActionRow(b, p, v) {
        return html`
            <tr>
                <td class="td-mono">Button ${parseInt(b) + 1}</td>
                <td>
                    <select class="td-select" style="width: auto;" @change="${(e) => this._changeAction(b, p, parseInt(e.target.value))}">
                        ${_renderOptions(['Unused','Increase Power','Go to VTX Band Menu','Go to VTX Channel Menu',
                            'Send VTX Settings','Start WiFi','Enter Binding Mode','Start BLE Joystick'], v.action)}
                    </select>
                </td>
                <td>
                    <select id="select-press-${b}-${p}" class="td-select" style="width: auto;"
                            @change="${(e) => this._changePress(b, p, e.target.value)}"
                            ?disabled="${v.action === 0}">
                        ${v.action === 0 ? html`<option value="" disabled selected></option>` : ''}
                        <option value="false" ?selected="${v['is-long-press'] === false}">Short press</option>
                        <option value="true"  ?selected="${v['is-long-press'] === true}">Long press</option>
                    </select>
                </td>
                <td>
                    <select id="select-timing-${b}-${p}" class="td-select" style="width: auto;"
                            @change="${(e) => this._changeCount(b, p, parseInt(e.target.value))}"
                            ?disabled="${v.action === 0}">
                        ${v.action === 0 ? html`<option value="" disabled selected></option>` : ''}
                        ${v['is-long-press'] === true
                            ? _renderOptions(['0.5 s','1 s','1.5 s','2 s','2.5 s','3 s','3.5 s','4 s'], v.count)
                            : _renderOptions(['1×','2×','3×','4×','5×','6×','7×','8×'], v.count)}
                    </select>
                </td>
            </tr>
        `
    }

    _submitButtonActions(e) {
        e.preventDefault();
        saveConfig({'button-actions': this.buttonActions})
    }

    _toRGB(c) {
        let r = c & 0xE0;
        r = ((r << 16) + (r << 13) + (r << 10)) & 0xFF0000;
        let g = c & 0x1C;
        g = ((g << 11) + (g << 8) + (g << 5)) & 0xFF00;
        let b = ((c & 0x3) << 1) + ((c & 0x3) >> 1);
        b = (b << 5) + (b << 2) + (b >> 1);
        return '#' + (r + g + b).toString(16).padStart(6, '0');
    }

    _to8bit(v) {
        v = parseInt(v.substring(1), 16)
        return ((v >> 16) & 0xE0) + ((v >> (8 + 3)) & 0x1C) + ((v >> 6) & 0x3)
    }

    _changeCurrentColors(e, index) {
        this.buttonActions[index].color = this._to8bit(e.target.value);
        if (this.colorTimer === undefined) {
            this._sendCurrentColors();
            this.colorTimer = setInterval(this._timeoutCurrentColors, 50);
        } else {
            this.colorUpdated = true;
        }
    }

    _sendCurrentColors() {
        let colors = [this.buttonActions[0].color];
        if (this.buttonActions[1] && this.buttonActions[1].color !== undefined) colors.push(this.buttonActions[1].color);
        Promise.resolve(transport.previewButtonColors(colors)).catch(() => {})
        this.colorUpdated = false;
    }

    _timeoutCurrentColors() {
        if (this.colorUpdated) {
            this._sendCurrentColors();
        } else {
            clearInterval(this.colorTimer);
            this.colorTimer = undefined;
        }
    }

    _checkEnableButtonActionSave() {
        for (const [b, _v] of Object.entries(this.buttonActions)) {
            for (const [p, v] of Object.entries(_v.action)) {
                if (v.action !== 0 && (_(`select-press-${b}-${p}`)?.value === '' || _(`select-timing-${b}-${p}`)?.value === '')) {
                    return true;
                }
            }
        }
        return false;
    }

    _changeAction(b, p, value) {
        (this.buttonActions)[b].action[p].action = value;
        if (value === 0) {
            _(`select-press-${b}-${p}`).value = '';
            _(`select-timing-${b}-${p}`).value = '';
        }
        this.requestUpdate()
    }

    _changePress(b, p, value) {
        (this.buttonActions)[b].action[p]['is-long-press'] = (value === 'true');
        this.requestUpdate()
    }

    _changeCount(b, p, value) {
        (this.buttonActions)[b].action[p].count = parseInt(value);
        this.requestUpdate()
    }
}
