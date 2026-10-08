import {html, LitElement} from "lit"
import {customElement} from "lit/decorators.js"
import '../components/filedrag.js'
import {saveWithReboot} from "../utils/feedback.js"
import {downloadExport, transport} from "../utils/transport.js"

@customElement('models-panel')
class ModelsPanel extends LitElement {
    createRenderRoot() {
        return this
    }

    render() {
        return html`
            <div class="td-h2" style="margin-bottom: var(--td-s-4);">Import / Export</div>
            <div class="td-card" style="margin-bottom: var(--td-s-4);">
                <div class="td-card-header">
                    <span class="td-h4">Export module settings</span>
                </div>
                <div class="td-card-body">
                    <p class="td-small td-mute" style="margin-bottom: var(--td-s-3);">
                        Backup global transmitter module and model configurations.
                    </p>
                    <button class="td-btn td-btn-primary" @click="${this.download}">Export module settings</button>
                </div>
            </div>
            <div class="td-card">
                <div class="td-card-header">
                    <span class="td-h4">Import module settings</span>
                </div>
                <div class="td-card-body">
                    <p class="td-small td-mute" style="margin-bottom: var(--td-s-3);">
                        Restore from a previous export file.
                    </p>
                    <file-drop label="Import module settings" @file-drop=${this.upload}>
                        or drop model JSON configuration file here
                    </file-drop>
                </div>
            </div>
        `
    }

    download() {
        downloadExport('models.json').catch(() => {})
    }

    upload(e) {
        const files = e.detail.files
        const reader = new FileReader()
        reader.onload = (x) => saveWithReboot(
            'Upload Model Configuration',
            'An error occurred while uploading model configuration file',
            (text) => transport.importConfig(text),
            x.target.result,
            () => { return 'Model configuration updated, reboot for them to take effect' }
        )
        reader.readAsText(files[0])
    }
}
