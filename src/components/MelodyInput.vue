<script setup>
import {VSelect, VTextField} from "vuetify/components";

let melodyType = defineModel('melodyType')
let melodyTune = defineModel('melodyTune')

const melodyTypes = [
  {value: 0, title: 'Quiet, no beeps'},
  {value: 1, title: 'Just one beep'},
  {value: 2, title: 'No tune, just beeps'},
  {value: 3, title: 'Default tune'},
  {value: 4, title: 'Custom tune'}
]
</script>

<template>
  <div class="hw-row">
    <span class="hw-label">Beeper</span>
    <VSelect v-model="melodyType" :items="melodyTypes" hide-details/>
  </div>
  <div class="hw-row" v-if="melodyType===4">
    <span class="hw-label">Melody</span>
    <VTextField v-model="melodyTune" hide-details/>
  </div>
</template>
