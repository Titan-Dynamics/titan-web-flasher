<script setup>
import { watch } from 'vue'

let model = defineModel()
const props = defineProps({methods: Array})

const flashMethods = [
  {value: 'download', title: 'Local Download'},
  {value: 'uart',     title: 'Serial UART'},
  {value: 'betaflight', title: 'Betaflight Passthrough'},
  {value: 'etx',     title: 'EdgeTX Passthrough'},
  {value: 'passthru', title: 'Passthrough'},
  {value: 'stlink',  title: 'STLink'},
]

function getFlashMethods() {
  return flashMethods.filter(v => v.value === 'download' || (props.methods && props.methods.includes(v.value)))
}

// Auto-select first available method whenever the methods list changes
watch(() => props.methods, () => {
  const available = getFlashMethods()
  if (available.length && !available.find(m => m.value === model.value)) {
    model.value = available[0].value
  }
}, { immediate: true })
</script>

<template>
  <div class="hw-row hw-row--align-top">
    <span class="hw-label" style="padding-top: 6px;">Flashing Method</span>
    <div class="td-segment fms-segment">
      <button
        v-for="m in getFlashMethods()"
        :key="m.value"
        type="button"
        :class="{ 'is-active': model === m.value }"
        @click="model = m.value"
      >{{ m.title }}</button>
    </div>
  </div>
</template>

<style scoped>
.fms-segment {
  flex-wrap: wrap;
  height: auto;
  width: fit-content;
}
</style>
