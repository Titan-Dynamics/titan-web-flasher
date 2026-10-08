<script setup>
import {isStm32} from "../js/state.js";

let model = defineModel()
</script>

<template>
  <div class="hw-row" v-if="!isStm32()">
    <span class="hw-label">WiFi Auto-On</span>
    <VNumberInput v-model="model" suffix="seconds" :step="10" :min="0" :max="120" hide-details/>
  </div>
</template>
