import {reactive} from 'vue'

export const store = reactive({
    // null = the normal flashing flow; 'dashboard' = the USB config dashboard (Configurator)
    view: null,
    currentStep: 1,
    firmware: null,
    folder: '',
    targetType: null,
    version: null,
    vendor: null,
    vendor_name: '',
    radio: null,
    target: null,
    name: '',
    options: {
        uid: null,
        region: 'FCC',
        domain: 1,
        ssid: null,
        password: null,
        wifiOnInternal: 60,
        tx: {
            telemetryInterval: 240,
            uartInverted: true,
            fanMinRuntime: 30,
            higherPower: false,
            melodyType: 3,
            melodyTune: null,
        },
        rx: {
            uartBaud: 420000,
            lockOnFirstConnect: true,
            r9mmMiniSBUS: false,
            fanMinRuntime: 30,
            rxAsTx: false,
            rxAsTxType: 0   // 0 = Internal (Full-duplex), 1 = External (Half-duplex)
        },
        flashMethod: null,
    }
})

export function resetState() {
    store.view = null
    store.currentStep = 1
    store.firmware = null
    store.folder = ''
    store.targetType = null
    store.version = null
    store.vendor = null
    store.radio = null
    store.target = null
    store.options = {
        uid: null,
        region: 'FCC',
        domain: 1,
        ssid: null,
        password: null,
        wifiOnInternal: 60,
        tx: {
            telemetryInterval: 240,
            uartInverted: true,
            fanMinRuntime: 30,
            higherPower: false,
            melodyType: 3,
            melodyTune: null,
        },
        rx: {
            uartBaud: 420000,
            lockOnFirstConnect: true,
            r9mmMiniSBUS: false,
            fanMinRuntime: 30,
        },
        flashMethod: null,
    }
}

/** The selected target is an STM32 board (no WiFi, flashed over USB DFU / STLink). */
export function isStm32() {
    return store.target?.config?.platform === 'stm32'
}

export function hasFeature(feature) {
    return store.target?.config?.features?.includes(feature)
}
