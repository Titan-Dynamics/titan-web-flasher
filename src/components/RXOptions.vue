<script setup>
import {hasFeature, store} from "../js/state.js";
import FanRuntime from "./FanRuntime.vue";
</script>

<template>
  <div class="hw-row">
    <span class="hw-label">UART Baud Rate</span>
    <VTextField v-model="store.options.rx.uartBaud" hide-details/>
  </div>
  <div class="hw-row">
    <span class="hw-label">Lock on First Connect</span>
    <VCheckbox v-model="store.options.rx.lockOnFirstConnect" hide-details density="compact"/>
  </div>
  <div class="hw-row" v-if="hasFeature('sbus-uart')">
    <span class="hw-label">SBUS Pins as UART</span>
    <VCheckbox v-model="store.options.rx.r9mmMiniSBUS" hide-details density="compact"/>
  </div>
  <FanRuntime v-model="store.options.rx.fanMinRuntime"/>
</template>
