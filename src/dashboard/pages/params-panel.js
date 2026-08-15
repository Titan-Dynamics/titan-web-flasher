/*
 * params-panel.js — the ELRS CRSF parameter tree (what the handset LUA script shows), over USB.
 *
 * Ported from the TitanLRS-Backpack web UI's `CrsfParams` state machine
 * (TitanLRS-Backpack/html/src/shared/scan.js). That copy runs against a WiFi coprocessor over a
 * WebSocket; this one runs over the WebUSB config session's TCFG_CRSF tunnel. The protocol logic
 * — device discovery, sequential enumeration, chunk reassembly, retries, folder navigation,
 * command parameters — is the same, because the device end is the same CRSFEndpoint.
 * See WEB_LUA_PARAMS_PLAN.md §7.3 for the substitutions. The Backpack is reference only; the two
 * copies are expected to diverge from here.
 *
 * LAYOUT: the Backpack's shape — a device list beside one tree — but as a second-level nav column
 * inside the tab rather than a list stacked above the table. Selecting a device is what fetches
 * its tree, and this is not just presentation: a receiver is enumerated over the air through the
 * TX, so rendering every device's table at once would put a link-speed transfer in the way of
 * changing a TX setting. The local module is selected automatically; the receiver costs nothing
 * until you ask for it, and once fetched a tree is cached for the life of the panel.
 *
 * Protocol state lives in one DeviceParams engine per device (not as panel-wide singletons as in
 * the Backpack), and inbound frames are routed to an engine by their origin address — so a tree
 * loaded earlier stays valid while another device is selected.
 *
 * The retry and timeout logic is load-bearing and was NOT simplified away: USB is reliable, but
 * the interesting case is a receiver enumerated over the air through the linked TX, and that leg
 * is as lossy as any radio link.
 */

import {html, LitElement} from "lit";
import {customElement, state} from "lit/decorators.js";

import {CRSF} from "../../js/crsf.js";
import {transport} from "../utils/transport.js";
import {refreshDeviceConfig} from "../utils/state.js";
import {cuteAlert} from "../utils/feedback.js";
import FEATURES from "../features.js";

const SCAN_WINDOW_MS = 2000
const PARAM_TIMEOUT_MS = 3000
const MAX_RETRIES = 3
const LINKSTAT_POLL_MS = 1000

/**
 * The parameter tree of one CRSF device, and the conversation that loads it.
 *
 * One of these per device on the bus. All the state the Backpack kept as singletons on CrsfParams
 * — pending parameter/chunk, retry counters, folder stack — is per-instance here, which is what
 * lets several trees be on screen at once. Responses are matched on origin address *and*
 * parameter number, so neither another device's traffic nor a real handset's requests on the same
 * origin address can be mistaken for ours.
 */
class DeviceParams {
    constructor(device, panel) {
        this.device = device
        this.panel = panel

        this.parameters = []
        this.parameterCount = device.parametersTotal
        this.loadedCount = 0
        this.currentFolder = 0
        this.folderStack = []
        this.isLoading = false
        this.hasLoaded = false      // a tree already fetched is never fetched again on re-select
        this.statusMessage = ''
        this.linkStatus = null

        this.pendingChunks = []
        this.pendingParamNumber = 0
        this.pendingChunkNumber = 0
        this.paramTimeout = null
        this.retryCount = 0
        this.missingParams = new Set()
        this.consecutiveParamFailures = 0
        this.reloadSingleCallback = null
        this.retryMissingCallback = null
        this.commandPopup = null
        this.commandPollInterval = null
        this.elrsFlags = 0

        // Same rule as the handset LUA (and the Backpack): identify as the ELRS LUA client when
        // talking to an ELRS TX, otherwise as a generic handset. Both addresses are shared with a
        // real handset if one is attached — see WEB_LUA_PARAMS_PLAN.md §8 on the expected
        // crosstalk, which the matching below discards.
        this.isElrsTx = device.isElrs && device.address === CRSF.ADDR_TX
        this.originAddress = this.isElrsTx ? CRSF.ADDR_ELRS_LUA : CRSF.ADDR_RADIO_TRANSMITTER
    }

    get address() { return this.device.address }
    get name() { return this.device.name }

    changed() { this.panel.requestUpdate() }

    dispose() {
        clearTimeout(this.paramTimeout)
        this.paramTimeout = null
        this.stopCommandPolling()
        this.isLoading = false
    }

    send(type, payload) {
        // Fire-and-forget, exactly like the Backpack's ws.send(): a failure here means the device
        // went away, and the enumeration timeout is what surfaces that.
        Promise.resolve(
            transport.sendCrsf(CRSF.buildFrame(type, this.address, this.originAddress, payload))
        ).catch(() => {})
    }

    // ---- enumeration -----------------------------------------------------------
    loadParameters() {
        clearTimeout(this.paramTimeout)
        this.paramTimeout = null
        this.reloadSingleCallback = null
        this.retryMissingCallback = null

        this.parameters = []
        this.parameterCount = this.device.parametersTotal
        this.loadedCount = 0
        this.pendingChunks = []
        this.isLoading = true
        this.retryCount = 0
        this.missingParams = new Set()
        this.consecutiveParamFailures = 0
        this.statusMessage = ''
        this.changed()

        this.requestParameter(1, 0)
    }

    requestParameter(paramNum, chunkNum) {
        if (!this.isLoading && !this.reloadSingleCallback) return

        this.pendingParamNumber = paramNum
        this.pendingChunkNumber = chunkNum
        this.send(CRSF.PARAM_READ, new Uint8Array([paramNum, chunkNum]))

        clearTimeout(this.paramTimeout)
        this.paramTimeout = setTimeout(() => this.handleParameterTimeout(paramNum, chunkNum),
                                       PARAM_TIMEOUT_MS)
    }

    handleParamEntry(payload) {
        if (payload.length < 2) return

        const paramNumber = payload[0]
        const chunksRemaining = payload[1]
        const chunkData = payload.slice(2)

        // Accept the parameter we asked for, or the one a running command is being polled on.
        // Anything else is somebody else's traffic (a handset on the same address) — drop it.
        const isCommandPoll = this.commandPopup && paramNumber === this.commandPopup.paramNumber
        if (paramNumber !== this.pendingParamNumber && !isCommandPoll) return

        clearTimeout(this.paramTimeout)
        this.paramTimeout = null
        this.consecutiveParamFailures = 0

        this.pendingChunks.push(chunkData)

        if (chunksRemaining !== 0) {
            this.pendingChunkNumber = this.pendingChunks.length
            this.requestParameter(paramNumber, this.pendingChunkNumber)
            return
        }

        const totalLen = this.pendingChunks.reduce((n, c) => n + c.length, 0)
        const fullData = new Uint8Array(totalLen)
        let pos = 0
        for (const c of this.pendingChunks) { fullData.set(c, pos); pos += c.length }
        this.pendingChunks = []

        const param = this.parseParameter(paramNumber, fullData)
        if (param) {
            this.parameters[paramNumber] = param
            if (this.isLoading) this.loadedCount++
            this.changed()
            if (param.type === CRSF.PARAM_TYPE_COMMAND && isCommandPoll) {
                this.handleCommandStatusUpdate(param)
            }
        }

        if (this.reloadSingleCallback) {
            const cb = this.reloadSingleCallback
            this.reloadSingleCallback = null
            cb()
        } else if (this.retryMissingCallback) {
            const cb = this.retryMissingCallback
            this.retryMissingCallback = null
            cb()
        } else if (this.isLoading) {
            if (this.loadedCount < this.parameterCount) this.requestNextParameter()
            else this.retryMissingParameters()
        }
    }

    handleParameterTimeout(paramNum, chunkNum) {
        if (!this.isLoading && !this.reloadSingleCallback) return

        // A post-write reload is best-effort: skip rather than retry, or a slow device turns one
        // write into a long stall with the UI frozen on stale values.
        if (this.reloadSingleCallback) {
            this.pendingChunks = []
            const cb = this.reloadSingleCallback
            this.reloadSingleCallback = null
            cb()
            return
        }

        if (this.retryCount < MAX_RETRIES) {
            this.retryCount++
            this.requestParameter(paramNum, chunkNum)
            return
        }

        this.missingParams.add(paramNum)
        this.retryCount = 0
        this.pendingChunks = []

        // Several parameters exhausting every retry in a row means the far end is gone, not that
        // the tree has holes in it — stop rather than grind through the rest. This is the usual
        // outcome for a receiver whose link dropped mid-enumeration.
        this.consecutiveParamFailures++
        if (this.consecutiveParamFailures >= 3) {
            this.abortLoading('Lost contact with this device — press Reload to retry')
            return
        }

        if (this.retryMissingCallback) {
            const cb = this.retryMissingCallback
            this.retryMissingCallback = null
            cb()
        } else if (paramNum + 1 <= this.parameterCount) {
            this.requestParameter(paramNum + 1, 0)
        } else {
            this.retryMissingParameters()
        }
    }

    requestNextParameter() {
        if (!this.isLoading) return
        this.retryCount = 0
        const nextNum = this.loadedCount + 1
        if (nextNum > this.parameterCount) {
            this.retryMissingParameters()
            return
        }
        this.pendingChunks = []
        this.requestParameter(nextNum, 0)
    }

    retryMissingParameters() {
        if (this.missingParams.size === 0) {
            this.finishLoading()
            return
        }
        const missing = Array.from(this.missingParams)
        this.missingParams.clear()
        this.retryMissingParamsArray(missing, 0)
    }

    retryMissingParamsArray(missingArray, index) {
        if (index >= missingArray.length) {
            this.finishLoading()
            return
        }
        this.retryCount = 0
        this.pendingChunks = []
        this.retryMissingCallback = () => this.retryMissingParamsArray(missingArray, index + 1)
        this.requestParameter(missingArray[index], 0)
    }

    abortLoading(message) {
        clearTimeout(this.paramTimeout)
        this.paramTimeout = null
        this.reloadSingleCallback = null
        this.retryMissingCallback = null
        this.isLoading = false
        this.consecutiveParamFailures = 0
        this.statusMessage = message
        this.changed()
        this.panel.loadFinished(this)
    }

    finishLoading() {
        this.isLoading = false
        clearTimeout(this.paramTimeout)
        this.paramTimeout = null
        this.retryMissingCallback = null
        this.statusMessage = this.missingParams.size
            ? `${this.missingParams.size} parameter(s) could not be read`
            : ''
        this.hasLoaded = this.parameters.some((p) => p)
        this.changed()
        this.panel.loadFinished(this)
    }

    // ---- parsing ---------------------------------------------------------------
    parseParameter(number, data) {
        if (data.length < 3) return null

        let offset = 0
        const parentFolder = data[offset++]
        const typeByte = data[offset++]
        const type = typeByte & 0x3F
        const nameResult = CRSF.readString(data, offset)
        offset = nameResult.nextOffset

        const param = {
            number, parentFolder, type,
            hidden: (typeByte & CRSF.PARAM_HIDDEN) !== 0,
            name: nameResult.value,
            value: null, options: null, min: null, max: null, defaultValue: null, unit: '',
        }

        switch (type) {
            case CRSF.PARAM_TYPE_UINT8:
                param.value = data[offset++]
                param.min = data[offset++]
                param.max = data[offset++]
                param.defaultValue = data[offset++]
                param.unit = CRSF.readString(data, offset).value
                break

            case CRSF.PARAM_TYPE_INT8: {
                const signed = (b) => new Int8Array([b])[0]
                param.value = signed(data[offset++])
                param.min = signed(data[offset++])
                param.max = signed(data[offset++])
                param.defaultValue = signed(data[offset++])
                param.unit = CRSF.readString(data, offset).value
                break
            }

            case CRSF.PARAM_TYPE_TEXT_SELECTION: {
                const optionsResult = CRSF.readString(data, offset)
                param.options = optionsResult.value.split(';')
                offset = optionsResult.nextOffset
                param.value = data[offset++]
                param.min = data[offset++]
                param.max = data[offset++]
                param.defaultValue = data[offset++]
                param.unit = CRSF.readString(data, offset).value
                break
            }

            case CRSF.PARAM_TYPE_FOLDER:
                break                                  // nothing past the name

            case CRSF.PARAM_TYPE_INFO:
            case CRSF.PARAM_TYPE_STRING:
                param.value = CRSF.readString(data, offset).value
                break

            case CRSF.PARAM_TYPE_COMMAND:
                param.status = data[offset++]
                param.timeout = data[offset++]
                param.value = CRSF.readString(data, offset).value
                break
        }

        return param
    }

    // ---- writes ----------------------------------------------------------------
    updateParameter(paramNum, value) {
        const param = this.parameters[paramNum]
        if (!param) return

        let serialized
        switch (param.type) {
            case CRSF.PARAM_TYPE_UINT8:
            case CRSF.PARAM_TYPE_TEXT_SELECTION:
            case CRSF.PARAM_TYPE_COMMAND:
                serialized = new Uint8Array([paramNum, value])
                break
            case CRSF.PARAM_TYPE_INT8:
                serialized = new Uint8Array([paramNum, value & 0xFF])
                break
            default:
                return
        }

        // No armed check here, deliberately: these are live link settings and this matches the
        // handset LUA, which changes them in flight. The static-config saves on the other tabs
        // keep their armed guard because they need a reboot. See WEB_LUA_PARAMS_PLAN.md §9.
        this.send(CRSF.PARAM_WRITE, serialized)

        param.value = value                             // optimistic; the reload below confirms
        this.changed()

        // Give the device time to commit before reading back, as the LUA script does.
        setTimeout(() => this.reloadRelatedFields(param), 200)

        // The Options tab caches the config document read at connect, and a live write can change
        // something it displays. Re-read it so the two views cannot disagree.
        refreshDeviceConfig()
    }

    /** Re-read the written field, its siblings and its parent folder — mirrors the LUA script. */
    reloadRelatedFields(param) {
        if (this.isLoading || this.reloadSingleCallback) return

        const queue = []
        if (param.parentFolder > 0 && this.parameters[param.parentFolder]) {
            queue.push(param.parentFolder)              // its label may embed the new value
        }
        this.parameters.forEach((p, idx) => {
            if (!p || idx === 0 || idx === param.number) return
            if (p.parentFolder !== param.parentFolder) return
            const isEditable = p.type < CRSF.PARAM_TYPE_STRING || p.type === CRSF.PARAM_TYPE_FOLDER
            if (isEditable) queue.push(idx)
        })
        queue.push(param.number)                        // the written field last

        this.reloadQueuedParameters(queue, 0)
    }

    reloadQueuedParameters(queue, index) {
        if (index >= queue.length) {
            // A folder's name can embed a value ("TX Power (25mW)"), so the breadcrumb has to
            // follow the reload.
            this.folderStack = this.folderStack.map((folder) => {
                const p = this.parameters[folder.id]
                return p && p.name !== folder.name ? {...folder, name: p.name} : folder
            })
            this.changed()
            return
        }
        this.pendingChunks = []
        this.reloadSingleCallback = () => this.reloadQueuedParameters(queue, index + 1)
        this.requestParameter(queue[index], 0)
    }

    // ---- commands --------------------------------------------------------------
    executeCommand(paramNumber) {
        const param = this.parameters[paramNumber]
        if (!param || param.type !== CRSF.PARAM_TYPE_COMMAND) return

        this.send(CRSF.PARAM_WRITE, new Uint8Array([paramNumber, 1]))

        this.commandPopup = {paramNumber, timeout: param.timeout || 50}
        // The parameter's own timeout is in 10 ms ticks, and the LUA waits one full period before
        // the first poll — so let the interval fire it, do not poll immediately.
        this.commandPollInterval = setInterval(() => this.pollCommandStatus(paramNumber),
                                               this.commandPopup.timeout * 10)
    }

    pollCommandStatus(paramNumber) {
        if (!this.commandPopup) {
            this.stopCommandPolling()
            return
        }
        this.send(CRSF.PARAM_WRITE, new Uint8Array([paramNumber, 6]))   // 6 = lcsQuery
    }

    stopCommandPolling() {
        if (this.commandPollInterval) clearInterval(this.commandPollInterval)
        this.commandPollInterval = null
        this.commandPopup = null
    }

    handleCommandStatusUpdate(param) {
        const status = param.status

        if (status === 0) {                             // stopped
            this.stopCommandPolling()
            return
        }
        if (status === 2) return                        // still running

        if (status === 3) {                             // needs confirmation
            if (this.commandPollInterval) clearInterval(this.commandPollInterval)
            this.commandPollInterval = null
            const popup = this.commandPopup
            cuteAlert({
                type: 'question',
                title: `${this.name}: confirmation required`,
                message: param.value || 'Press OK to confirm',
                confirmText: 'OK',
                cancelText: 'Cancel',
            }).then((result) => {
                if (!this.commandPopup) return           // the panel moved on while we waited
                if (result === 'confirm') {
                    this.send(CRSF.PARAM_WRITE, new Uint8Array([param.number, 4]))
                    this.commandPollInterval = setInterval(
                        () => this.pollCommandStatus(param.number), popup.timeout * 10)
                } else {
                    // Matching the LUA: cancelling a confirmation just drops the popup, it does
                    // not send a cancel (status 5) to the device.
                    this.commandPopup = null
                }
            })
        }
    }

    // ---- link status -----------------------------------------------------------
    /** Only an ELRS TX answers this; on an RX parameter 0 has no callback and nothing happens. */
    pollLinkstat() {
        if (!this.isElrsTx) return
        this.send(CRSF.PARAM_WRITE, new Uint8Array([0, 0]))
    }

    handleELRSStatus(payload) {
        if (payload.length < 4) return

        // pktsBad(1), pktsGood(2, big-endian), flags(1), message(null-terminated)
        const badPkt = payload[0]
        const goodPkt = (payload[1] * 256) + payload[2]
        const newFlags = payload[3]
        const msg = payload.length > 4 ? CRSF.readString(payload, 4).value : ''

        this.linkStatus = {connected: (newFlags & 0x01) !== 0, badPkt, goodPkt}
        this.changed()

        const flagsChanged = newFlags !== this.elrsFlags
        this.elrsFlags = newFlags
        // Anything above 0x1F is a warning/error the device wants acknowledged, same threshold
        // the LUA script uses.
        if (flagsChanged && newFlags > 0x1F && msg) {
            cuteAlert({type: 'error', title: this.name, message: msg, confirmText: 'OK'})
                .then(() => {
                    // Acknowledging clears the condition on the device (LUA sends 0x2E, 0x00).
                    this.send(CRSF.PARAM_WRITE, new Uint8Array([0x2E, 0x00]))
                })
        }
    }

    // ---- navigation ------------------------------------------------------------
    navigateToFolder(folderId, folderName) {
        this.folderStack = [...this.folderStack,
                            {id: folderId, parentId: this.currentFolder, name: folderName}]
        this.currentFolder = folderId
        this.changed()
    }

    navigateBack() {
        if (!this.folderStack.length) return
        const stack = this.folderStack.slice()
        const prev = stack.pop()
        this.folderStack = stack
        this.currentFolder = prev.parentId
        this.changed()
    }
}

@customElement('params-panel')
class ParamsPanel extends LitElement {
    // The engines themselves are plain objects mutated in place; they call requestUpdate() through
    // changed(). Only the list identity is reactive.
    @state() accessor engines = []
    @state() accessor scanning = false
    @state() accessor selectedAddress = null

    scanTimeout = null
    linkstatPollInterval = null
    unsubscribe = null
    activeEngine = null          // the one engine allowed to enumerate at a time
    loadQueue = []

    createRenderRoot() {
        return this
    }

    connectedCallback() {
        super.connectedCallback()
        this.unsubscribe = transport.onCrsf((frame) => this.handleFrame(frame))
        this.linkstatPollInterval = setInterval(() => this.pollLinkstat(), LINKSTAT_POLL_MS)
        this.scanDevices()
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        if (this.unsubscribe) this.unsubscribe()
        this.unsubscribe = null
        clearTimeout(this.scanTimeout)
        this.scanTimeout = null
        clearInterval(this.linkstatPollInterval)
        this.linkstatPollInterval = null
        this.engines.forEach((e) => e.dispose())
        this.activeEngine = null
        this.loadQueue = []
    }

    // ---- discovery -------------------------------------------------------------
    scanDevices() {
        this.scanning = true
        Promise.resolve(transport.sendCrsf(
            CRSF.buildFrame(CRSF.DEVICE_PING, CRSF.ADDR_BROADCAST, CRSF.ADDR_RADIO_TRANSMITTER,
                            new Uint8Array(0)))).catch(() => {})
        clearTimeout(this.scanTimeout)
        this.scanTimeout = setTimeout(() => {
            this.scanTimeout = null
            this.scanning = false
            // The local module normally answers first and is selected on arrival. If it did not
            // answer at all, fall back to whatever did rather than showing an empty right pane.
            if (!this.selected && this.engines.length) this.selectDevice(this.engines[0])
        }, SCAN_WINDOW_MS)
    }

    /** Re-ping and drop every cached tree. */
    rescan() {
        this.engines.forEach((e) => e.dispose())
        this.engines = []
        this.selectedAddress = null
        this.activeEngine = null
        this.loadQueue = []
        this.scanDevices()
    }

    get selected() {
        return this.engines.find((e) => e.address === this.selectedAddress) || null
    }

    /**
     * Show a device, fetching its tree the first time only.
     *
     * This is the whole point of having a selector: a receiver's tree comes over the air through
     * the TX, so it must not be fetched to change a TX setting, and must not be re-fetched every
     * time the user glances back at it.
     */
    selectDevice(engine) {
        this.selectedAddress = engine.address
        if (!engine.hasLoaded && !engine.isLoading) this.enqueueLoad(engine)
    }

    handleFrame(bytes) {
        const frame = CRSF.parseFrame(bytes)
        if (!frame) return
        if (frame.type === CRSF.DEVICE_INFO) {
            this.handleDeviceInfo(frame)
            return
        }
        const engine = this.engines.find((e) => e.address === frame.origin)
        if (!engine) return
        if (frame.type === CRSF.PARAM_ENTRY) engine.handleParamEntry(frame.payload)
        else if (frame.type === CRSF.ELRS_STATUS) engine.handleELRSStatus(frame.payload)
    }

    handleDeviceInfo(frame) {
        const payload = frame.payload
        const nameResult = CRSF.readString(payload, 0)
        let offset = nameResult.nextOffset
        if (payload.length < offset + 14) return

        const view = new DataView(payload.buffer, payload.byteOffset, payload.length)
        const serialNumber = view.getUint32(offset, false); offset += 4
        const hardwareId = view.getUint32(offset, false); offset += 4
        const firmwareId = view.getUint32(offset, false); offset += 4
        const parametersTotal = payload[offset++]
        const parameterVersion = payload[offset++]

        const device = {
            name: nameResult.value,
            address: frame.origin,
            serialNumber, hardwareId, firmwareId, parametersTotal, parameterVersion,
            isElrs: serialNumber === 0x454C5253,   // 'ELRS'
        }

        // A device we already know re-announcing itself (its own ping answer crossing ours, or a
        // handset's ping) must not restart an enumeration that is already under way.
        if (this.engines.some((e) => e.address === device.address)) return

        const engine = new DeviceParams(device, this)
        // Address order puts the TX (0xEE) after the RX (0xEC) numerically, which is the wrong way
        // round for reading: the module you are plugged into belongs at the top.
        this.engines = [...this.engines, engine].sort((a, b) => rank(a) - rank(b))

        // Auto-select the module on the cable, and only that one. Anything else on the bus is
        // reached over the air, so it waits to be asked for.
        if (!this.selected && engine.address === localAddress()) this.selectDevice(engine)
    }

    // ---- one enumeration at a time ---------------------------------------------
    /*
     * Selection drives loading, so normally only one tree is ever being fetched. The queue is for
     * the case where the user picks a second device while the first is still coming in: the new
     * one waits rather than interleaving. Correctness does not require that — responses are
     * matched per engine on origin and parameter number — but a receiver is enumerated over the
     * air through the TX, and running two enumerations at once only adds traffic to that leg.
     */
    enqueueLoad(engine) {
        if (this.loadQueue.includes(engine) || this.activeEngine === engine) return
        this.loadQueue.push(engine)
        this.requestUpdate()
        this.startNextLoad()
    }

    startNextLoad() {
        if (this.activeEngine) return
        const next = this.loadQueue.shift()
        if (!next) return
        this.activeEngine = next
        next.loadParameters()
    }

    loadFinished(engine) {
        if (this.activeEngine === engine) this.activeEngine = null
        this.startNextLoad()
        this.requestUpdate()
    }

    pollLinkstat() {
        this.engines.forEach((e) => e.pollLinkstat())
    }

    // ---- rendering -------------------------------------------------------------
    render() {
        return html`
            <!-- Panel-local, because the ported dashboard stylesheets are kept in sync with the
                 firmware's copies and this layout exists only here. -->
            <style>
                /* The dashboard container caps content at 960px (td-extensions.css #main), a
                   readable measure for the single-column forms on every other tab. This tab is
                   two columns — a device list beside a parameter table — so it needs more, and
                   the override is scoped to this panel: the style element is part of the panel's
                   own light DOM and goes away with it, leaving the other tabs at 960px. */
                .td-dashboard #main:has(params-panel) { max-width: 1200px; }

                .td-dashboard .td-params-layout {
                    display: grid;
                    grid-template-columns: 416px minmax(0, 1fr);
                    gap: var(--td-s-4);
                    align-items: start;
                }
                .td-dashboard .td-params-nav { position: sticky; top: 0; }
                /* Device rows are a table like the parameter table, in a card like the
                   parameter card — the two columns are the same kind of thing, so they should
                   not look like two different kinds of thing. */
                .td-dashboard .td-params-device { cursor: pointer; }
                .td-dashboard .td-params-device.is-selected td:first-child {
                    box-shadow: inset 2px 0 0 var(--td-brand);
                }
                .td-dashboard .td-params-device-name {
                    display: block;
                    font-weight: 600;
                    margin-bottom: 2px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .td-dashboard .td-params-device-meta { display: block; line-height: 1.5; }
                @media (max-width: 720px) {
                    .td-dashboard .td-params-layout { grid-template-columns: minmax(0, 1fr); }
                    .td-dashboard .td-params-nav { position: static; }
                }
            </style>

            <!-- The heading owns its row; the link chips sit on the row below, pushed right so
                 they line up over the parameter table they describe. -->
            <div style="margin-bottom: var(--td-s-3);">
                <span class="td-h2">Parameters</span>
            </div>
            <div class="td-row td-gap-2"
                 style="margin-bottom: var(--td-s-4); align-items:center; justify-content:flex-end; min-height: 28px;">
                ${this.renderLinkStatus()}
            </div>

            <div class="td-params-layout">
                <aside class="td-params-nav">
                    <div class="td-card">
                        <div class="td-card-header">
                            <span class="td-h4">Devices</span>
                            <button class="td-btn" ?disabled=${this.scanning}
                                    @click="${() => this.rescan()}">Rescan</button>
                        </div>
                        ${this.engines.length === 0 ? html`
                            <div class="td-card-body">
                                <p class="td-small td-mute" style="margin: 0;">
                                    ${this.scanning ? 'Searching…' : 'None found'}
                                </p>
                            </div>
                        ` : html`
                            <table class="td-table td-table-roomy" style="width:100%;">
                                ${this.engines.map((engine) => this.renderDeviceRow(engine))}
                            </table>
                        `}
                    </div>
                </aside>

                <div>${this.renderSelected()}</div>
            </div>
        `
    }

    renderDeviceRow(engine) {
        const isSelected = engine === this.selected
        // Devices never fetched read as available rather than empty — selecting one is what
        // fetches it, and for a receiver that is a transfer over the air.
        // The count comes from DEVICE_INFO, so it is known before the tree is fetched — show it
        // either way, and say when what you are looking at has not been read yet.
        const count = `${engine.parameterCount} parameters`
        const state = engine.isLoading
            ? `loading ${engine.loadedCount}/${engine.parameterCount}`
            : this.loadQueue.includes(engine) ? `${count} · queued`
            : engine.hasLoaded ? count
            : `${count} · not loaded`
        return html`
            <tr class="td-params-device ${isSelected ? 'is-selected' : ''}"
                @click="${() => this.selectDevice(engine)}">
                <td>
                    <span class="td-params-device-name">${engine.name}</span>
                    <span class="td-params-device-meta td-small td-mute td-mono">0x${engine.address.toString(16).toUpperCase()}</span>
                    <span class="td-params-device-meta td-small td-mute">${state}</span>
                </td>
            </tr>
        `
    }

    renderSelected() {
        const engine = this.selected
        if (engine) return this.renderDevice(engine)
        return html`
            <div class="td-card">
                <div class="td-card-body">
                    <p class="td-small td-mute" style="margin: 0;">
                        ${this.scanning ? 'Looking for CRSF devices…'
                                        : 'No CRSF devices answered. Press Rescan to search again.'}
                    </p>
                </div>
            </div>
        `
    }

    /** One chip pair for the link, from whichever device reports ELRS status (the TX). */
    renderLinkStatus() {
        const engine = this.engines.find((e) => e.linkStatus)
        if (!engine) return ''
        const {connected, badPkt, goodPkt} = engine.linkStatus
        return html`
            <span class="td-chip ${connected ? 'td-chip-ok' : 'td-chip-bad'}">
                ${connected ? 'RX Connected' : 'RX Disconnected'}
            </span>
            <span class="td-chip td-chip-mono">${badPkt}/${goodPkt}</span>
        `
    }

    renderDevice(engine) {
        return html`
            <div class="td-card">
                <div class="td-card-header">
                    <span class="td-h4">${engine.name}
                        <span class="td-small td-mute td-mono">0x${engine.address.toString(16).toUpperCase()}</span>
                    </span>
                    <div class="td-row td-gap-2">
                        ${engine.folderStack.length ? html`
                            <button class="td-btn" @click="${() => engine.navigateBack()}">Back</button>
                        ` : ''}
                        <button class="td-btn"
                                ?disabled=${engine.isLoading || this.loadQueue.includes(engine)}
                                @click="${() => this.enqueueLoad(engine)}">Reload</button>
                    </div>
                </div>

                ${engine.folderStack.length ? html`
                    <div class="td-card-row">
                        <span class="td-small td-mute">${engine.folderStack.map((f) => f.name).join(' › ')}</span>
                    </div>
                ` : ''}

                <div class="td-card-body">
                    ${this.renderDeviceBody(engine)}
                </div>
            </div>
        `
    }

    renderDeviceBody(engine) {
        if (engine.isLoading) {
            return html`<p class="td-small td-mute" style="margin: 0;">
                Loading parameters… (${engine.loadedCount}/${engine.parameterCount})
            </p>`
        }
        if (this.loadQueue.includes(engine)) {
            return html`<p class="td-small td-mute" style="margin: 0;">Waiting to load…</p>`
        }
        if (!engine.hasLoaded) {
            // Never fetched, or the fetch failed. Either way there is no tree to show, and
            // "No parameters in this folder" would read as an answer rather than an absence.
            return html`
                ${engine.statusMessage ? html`
                    <p class="td-small" style="margin: 0 0 var(--td-s-2); color: var(--td-warn);">${engine.statusMessage}</p>
                ` : ''}
                <p class="td-small td-mute" style="margin: 0;">
                    ${engine.statusMessage ? 'Press Reload to try again.'
                                           : "Press Reload to fetch this device's parameters."}
                </p>
            `
        }

        const params = engine.parameters.filter(
            (p) => p && p.parentFolder === engine.currentFolder && !p.hidden)

        return html`
            ${engine.statusMessage ? html`
                <p class="td-small" style="margin: 0 0 var(--td-s-3); color: var(--td-warn);">${engine.statusMessage}</p>
            ` : ''}
            ${params.length === 0 ? html`
                <p class="td-small td-mute" style="margin: 0;">No parameters in this folder</p>
            ` : html`
                <table class="td-table td-table-roomy" style="width:100%;">
                    ${params.map((param) => html`
                        <tr>
                            <td style="width:40%;">${param.name}</td>
                            <td style="width:60%;">${this.renderParamControl(engine, param)}</td>
                        </tr>
                    `)}
                </table>
            `}
        `
    }

    renderParamControl(engine, param) {
        switch (param.type) {
            case CRSF.PARAM_TYPE_UINT8:
            case CRSF.PARAM_TYPE_INT8:
                return html`
                    <div class="td-row td-gap-2" style="align-items:center;">
                        <input type="number" class="td-input td-input-mono" style="max-width:100px;"
                               .value="${String(param.value)}"
                               min="${param.min}" max="${param.max}"
                               @change="${(e) => engine.updateParameter(param.number, parseInt(e.target.value, 10))}">
                        ${param.unit ? html`<span class="td-small td-mute">${param.unit}</span>` : ''}
                        <span class="td-small td-mute td-mono">[${param.min}–${param.max}]</span>
                    </div>
                `

            case CRSF.PARAM_TYPE_TEXT_SELECTION:
                return html`
                    <div class="td-row td-gap-2" style="align-items:center;">
                        <!-- selection is carried by .selected on each option, not a .value
                             binding on the select: the property would be applied before the
                             options exist, and the attribute form stops taking effect once the
                             user has touched the control. -->
                        <select class="td-select" style="flex:1;"
                                @change="${(e) => engine.updateParameter(param.number, parseInt(e.target.value, 10))}">
                            ${(param.options || []).map((opt, i) => opt.trim().length === 0 ? '' : html`
                                <option value="${i}" .selected=${i === param.value}>${opt}</option>
                            `)}
                        </select>
                        ${param.unit ? html`<span class="td-small td-mute">${param.unit}</span>` : ''}
                    </div>
                `

            case CRSF.PARAM_TYPE_FOLDER:
                return html`<button class="td-btn td-btn-primary"
                                    @click="${() => engine.navigateToFolder(param.number, param.name)}">Enter</button>`

            case CRSF.PARAM_TYPE_INFO:
                return html`<span class="td-small td-mute">${param.value || ''}</span>`

            case CRSF.PARAM_TYPE_COMMAND:
                return html`<button class="td-btn td-btn-primary"
                                    @click="${() => engine.executeCommand(param.number)}">${param.value || 'Execute'}</button>`

            case CRSF.PARAM_TYPE_STRING:
                return html`<span class="td-small td-mono">${param.value || ''}</span>`

            default:
                return html`<span class="td-small td-mute">Unsupported type (${param.type})</span>`
        }
    }
}

/**
 * The address of the module the USB cable is plugged into — the one device whose tree costs
 * nothing to read, and so the only one selected without being asked for.
 */
function localAddress() {
    return FEATURES.IS_TX ? CRSF.ADDR_TX : CRSF.ADDR_RX
}

/** Nav order: the module on the cable first, then the receiver, then anything else. */
function rank(engine) {
    if (engine.address === CRSF.ADDR_TX) return 0
    if (engine.address === CRSF.ADDR_RX) return 1
    return 2 + engine.address
}
