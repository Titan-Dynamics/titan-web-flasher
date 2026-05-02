<script setup>
import {hasFeature} from "../js/state.js";

let model = defineModel()
</script>

<template>
  <div class="hw-row" v-if="hasFeature('fan')">
    <span class="hw-label">Min Fan Runtime</span>
    <VNumberInput v-model="model" suffix="seconds" :step="10" :min="0" :max="3600" hide-details/>
  </div>
</template>
