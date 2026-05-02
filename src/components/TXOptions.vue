<script setup>
import {hasFeature, store} from "../js/state.js";
import FanRuntime from "./FanRuntime.vue";
import MelodyInput from "./MelodyInput.vue";
</script>

<template>
  <div class="hw-row">
    <span class="hw-label">TLM Report Interval</span>
    <VNumberInput v-model="store.options.tx.telemetryInterval" suffix="ms" :step="10" :min="100" :max="1000" hide-details/>
  </div>
  <div class="hw-row" v-if="store.target?.config?.platform==='stm32'">
    <span class="hw-label">UART Inverted</span>
    <VCheckbox v-model="store.options.tx.uartInverted" hide-details density="compact"/>
  </div>
  <FanRuntime v-model="store.options.tx.fanMinRuntime"/>
  <div class="hw-row" v-if="hasFeature('unlock-higher-power')">
    <span class="hw-label">Unlock Higher Power</span>
    <VCheckbox v-model="store.options.tx.higherPower" hide-details density="compact"/>
  </div>
  <MelodyInput v-model:melody-type="store.options.tx.melodyType"
               v-model:melody-tune="store.options.tx.melodyTune"
               v-if="hasFeature('buzzer')"/>
</template>
