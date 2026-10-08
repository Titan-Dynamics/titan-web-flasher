<script setup>
import {isStm32, store} from "../js/state.js";
import BindPhraseInput from "../components/BindPhraseInput.vue";
import RFSelect from "../components/RFSelect.vue";
import WiFiSettingsInput from "../components/WiFiSettingsInput.vue";
import FlashMethodSelect from "../components/FlashMethodSelect.vue";
import WiFiAutoOn from "../components/WiFiAutoOn.vue";
import TXOptions from "../components/TXOptions.vue";
</script>

<template>
  <div class="hw-select">
    <div class="hw-select-title">
      <span class="td-h4">Transmitter Options</span>
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
          <TXOptions/>
        </VExpansionPanelText>
      </VExpansionPanel>
    </VExpansionPanels>
  </div>
</template>