<script setup>
import {ref} from "vue";
import {store} from "../js/state.js";

let enabled = defineModel('enabled')
let type = defineModel('type')
type.value = "0"

let items = ref([
  {title: "RX as Internal TX module (Full-duplex)", value: "0"},
  {title: "RX as External TX module (Half-duplex)", value: "1"}
])
</script>

<template>
  <div class="hw-row">
    <div>
      <span class="hw-label">Flash RX as TX</span>
      <span class="hw-note" v-if="!store.target.config.platform.startsWith('esp32')">full-duplex internal module only</span>
    </div>
    <VCheckbox v-model="enabled" hide-details density="compact"/>
  </div>
  <div class="hw-row" v-if="store.target.config.platform.startsWith('esp32') && enabled">
    <span class="hw-label">RX Mode</span>
    <VSelect v-model="type" :items="items" hide-details/>
  </div>
</template>

<style scoped>
.hw-note {
  display: block;
  font-size: var(--td-fs-xs);
  color: var(--td-fg-dim);
  margin-top: 1px;
}
</style>
