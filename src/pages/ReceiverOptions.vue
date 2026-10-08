<script setup>
import {watch} from "vue";
import {isStm32, store} from "../js/state.js";

import BindPhraseInput from "../components/BindPhraseInput.vue";
import RFSelect from "../components/RFSelect.vue";
import WiFiSettingsInput from "../components/WiFiSettingsInput.vue";
import FlashMethodSelect from "../components/FlashMethodSelect.vue";
import WiFiAutoOn from "../components/WiFiAutoOn.vue";
import RXasTX from "../components/RXasTX.vue";
import RXOptions from "../components/RXOptions.vue";
import TXOptions from "../components/TXOptions.vue";

// STM32 receivers cannot be flashed as a TX: never leave RX-as-TX set from an earlier target.
watch(() => isStm32() && store.options.rx.rxAsTx, (forced) => {
  if (forced) store.options.rx.rxAsTx = false
}, {immediate: true})
</script>

<template>
  <div class="hw-select">
    <div class="hw-select-title">
      <span class="td-h4">Receiver Options</span>
      <span class="td-small td-dim">Set the flashing options and method for your <b>{{ store.target?.config?.product_name }}</b></span>
    </div>
    <VForm autocomplete="on" method="POST">
      <BindPhraseInput v-model="store.options.uid"/>
      <RFSelect v-model:region="store.options.region" v-model:domain="store.options.domain" :radio="store.radio"/>
      <WiFiSettingsInput v-model:ssid="store.options.ssid" v-model:password="store.options.password"
                         v-if="!isStm32()"/>
      <FlashMethodSelect v-model="store.options.flashMethod" :methods="store.target?.config?.upload_methods"/>
    </VForm>
    <VExpansionPanels variant="popout">
      <VExpansionPanel title="Advanced Settings">
        <VExpansionPanelText>
          <WiFiAutoOn v-model="store.options.wifiOnInternal"/>
          <RXasTX v-if="!isStm32()" v-model:enabled="store.options.rx.rxAsTx" v-model:type="store.options.rx.rxAsTxType"/>
          <RXOptions v-if="!store.options.rx.rxAsTx"/>
          <TXOptions v-else/>
        </VExpansionPanelText>
      </VExpansionPanel>
    </VExpansionPanels>
  </div>
</template>