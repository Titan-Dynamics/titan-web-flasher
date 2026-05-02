<script setup>
import {ref, watch, onMounted} from "vue";
import {uidBytesFromText} from "../js/phrase.js";

let model = defineModel()

let bindPhrase = ref(null)
let uid = ref('Bind Phrase')

function generateUID() {
  if (!bindPhrase.value) uid.value = 'Bind Phrase'
  else {
    let val = Array.from(uidBytesFromText(bindPhrase.value))
    model.value = val
    uid.value = 'UID: ' + val
  }
}

onMounted(() => {
  const saved = localStorage.getItem('titan-bind-phrase')
  if (saved) {
    bindPhrase.value = saved
    generateUID()
  }
})

watch(bindPhrase, v => {
  if (v) localStorage.setItem('titan-bind-phrase', v)
  else localStorage.removeItem('titan-bind-phrase')
})
</script>

<template>
  <div class="hw-row">
    <span class="hw-label">Bind Phrase</span>
    <div class="bp-cell">
      <VTextField v-model="bindPhrase" name="bind-phrase" placeholder="Enter bind phrase…" :oninput="generateUID" hide-details/>
      <span class="bp-uid" v-if="uid !== 'Bind Phrase'">{{ uid }}</span>
    </div>
  </div>
</template>

<style scoped>
.bp-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bp-uid {
  font-size: var(--td-fs-xs);
  color: var(--td-fg-dim);
  font-family: var(--td-mono);
  padding-left: 2px;
}
</style>
