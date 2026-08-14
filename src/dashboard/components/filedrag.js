import {html, LitElement} from 'lit';
import {customElement, property} from "lit/decorators.js";

@customElement('file-drop')
export class FileDrop extends LitElement {
    @property()
    accessor label

    constructor() {
        super();
        this._projectedHTML = '';
    }

    createRenderRoot() {
        return this;
    }

    connectedCallback() {
        if (this._projectedHTML === '' && this.innerHTML.trim() !== '') {
            this._projectedHTML = this.innerHTML;
            this.innerHTML = '';
        }
        super.connectedCallback();
    }

    render() {
        return html`
            <div class="td-upload-btn">
                <button class="td-btn td-btn-primary">
                    ${this.label}
                </button>
                <input type="file" id="fileselect" name="fileselect[]" @change=${this._selectFiles} />
            </div>
            <div
                class="td-drop-zone"
                @dragover=${this._handleDragOver}
                @dragleave=${this._handleDragLeave}
                @drop=${this._handleDrop}
            >
                ${this._projectedHTML}
            </div>
        `;
    }

    _handleDragOver(event) {
        event.preventDefault();
        event.currentTarget.classList.add('dragover');
    }

    _handleDragLeave(event) {
        event.currentTarget.classList.remove('dragover');
    }

    _handleDrop(event) {
        event.preventDefault();
        event.currentTarget.classList.remove('dragover');
        this._callback(event.dataTransfer.files);
    }

    _selectFiles(event) {
        this._callback(event.target.files);
    }

    _callback(files) {
        if (files.length) {
            this.dispatchEvent(new CustomEvent('file-drop', {
                detail: {files},
                bubbles: true,
                composed: true
            }));
        }
    }
}
