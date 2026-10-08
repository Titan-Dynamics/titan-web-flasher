<script setup>
import {ref, watch, watchEffect, watchPostEffect} from 'vue';
import {store} from '../js/state';
import {compareSemanticVersions} from '../js/version';

defineProps(['vendorLabel'])

let firmware = ref(null);
let hardware = ref(null);
let versions = ref([]);
let vendors = ref([]);
let targets = ref([]);
let fetchFailed = ref(false)
let fetchFailedMessage = ref('')
let quickSearch = ref(null);
let quickSearchItems = ref([]);

watchPostEffect(() => {
  fetch(`./assets/${store.firmware}/index.json`).then(r => r.json()).then(r => {
    firmware.value = r
  })
})

function updateVersions() {
  if (firmware.value) {
    hardware.value = null
    store.version = null
    versions.value = []
    const savedVersion = localStorage.getItem(`titan-last-version-${store.firmware}`)
    Object.keys(firmware.value.tags).sort(compareSemanticVersions).reverse().forEach((key) => {
      versions.value.push({title: key, value: firmware.value.tags[key]})
      if (!store.version) store.version = firmware.value.tags[key]
    })
    if (savedVersion) {
      const found = versions.value.find(v => v.value === savedVersion)
      if (found) store.version = found.value
    }
  }
}

watch(firmware, updateVersions)

watch(() => store.version, v => { if (v) localStorage.setItem(`titan-last-version-${store.firmware}`, v) })

watchPostEffect(() => {
  if (store.version) {
    store.folder = `./assets/${store.firmware}/${store.version}`
    const targetUrls = [
      `./assets/${store.firmware}/${store.version}/hardware/targets.json`,
      `./assets/${store.firmware}/backpack-${store.version}/hardware/targets.json`,
      `./assets/${store.firmware}/hardware/targets.json`
    ]
    const loadTargets = async () => {
      let loaded = false
      for (const url of targetUrls) {
        try {
          const response = await fetch(url)
          if (!response.ok) throw new Error('Failed to load targets.json')
          const data = await response.json()
          hardware.value = data
          store.vendor = null
          vendors.value = []
          for (const [k, v] of Object.entries(hardware.value)) {
            let hasTargets = v.hasOwnProperty(store.targetType)
            if (hasTargets && v.name) vendors.value.push({title: v.name, value: k})
          }
          vendors.value.sort((a, b) => a.title.localeCompare(b.title))
          loaded = true
          return
        } catch (_ignore) {
        }
      }
      if (!loaded) {
        fetchFailedMessage.value = 'Failed to fetch targets for Backpack hardware.'
        fetchFailed.value = true
      }
    }
    loadTargets()
  }
})

watchEffect(() => {
  targets.value = []
  let keepTarget = false
  if (store.vendor && hardware.value) {
    for (const [vk, v] of Object.entries(hardware.value)) {
      if (v[store.targetType] && (vk === store.vendor || store.vendor === null)) {
        for (const [ck, c] of Object.entries(v[store.targetType])) {
          targets.value.push({title: c.product_name, value: {vendor: vk, target: ck, config: c}})
          if (store.target && store.target.vendor === vk && store.target.target === ck) keepTarget = true
        }
      }
    }
    targets.value.sort((a, b) => a.title.localeCompare(b.title))
    if (targets.value.length === 1) {
      store.target = targets.value[0].value
      keepTarget = true
    }
  }
  if (!keepTarget) store.target = null
})

watchEffect(() => {
  quickSearchItems.value = []
  if (store.version && hardware.value) {
    for (const [vk, v] of Object.entries(hardware.value)) {
      if (!v[store.targetType]) continue
      const vendorName = v.name || vk
      for (const [ck, c] of Object.entries(v[store.targetType])) {
        quickSearchItems.value.push({
          title: c.product_name,
          vendorName,
          value: { vendor: vk, target: ck, config: c }
        })
      }
    }
    quickSearchItems.value.sort((a, b) => a.title.localeCompare(b.title))
  }
})

watch(quickSearch, (v) => {
  if (v) {
    store.vendor = v.vendor
    store.target = v
  }
})

function onQuickSearchClear() {
  store.vendor = null
  store.target = null
}

watch(() => store.target, (v) => {
  if (v) {
    store.vendor = v.vendor
    store.vendor_name = hardware.value[v.vendor].name
  } else {
    quickSearch.value = null
  }
})

</script>

<template>
  <div class="hw-select">
    <div class="hw-select-title">
      <span class="td-h4" v-if="store.targetType==='txbp'">Transmitter Backpack</span>
      <span class="td-h4" v-else-if="store.targetType==='vrx'">VRx Hardware</span>
      <span class="td-h4" v-else-if="store.targetType==='aat'">Antenna Tracker Hardware</span>
      <span class="td-h4" v-else-if="store.targetType==='timer'">Race Timer Hardware</span>
      <span class="td-small td-dim" v-if="store.targetType==='txbp'">Choose the transmitter module having its backpack flashed</span>
      <span class="td-small td-dim" v-else-if="store.targetType==='vrx'">Choose the video receiver type and hardware to be flashed</span>
      <span class="td-small td-dim" v-else-if="store.targetType==='aat'">Choose the antenna tracker type and hardware to be flashed</span>
      <span class="td-small td-dim" v-else-if="store.targetType==='timer'">Choose the race timer and hardware to be flashed</span>
    </div>

    <div class="hw-row">
      <span class="hw-label">Firmware Version</span>
      <VSelect :items="versions" v-model="store.version" hide-details/>
    </div>
    <div class="hw-row">
      <span class="hw-label">Quick Search</span>
      <VAutocomplete
        :items="quickSearchItems"
        :filter-keys="['title', 'raw.vendorName']"
        v-model="quickSearch"
        placeholder="Device name or vendor…"
        clearable
        :disabled="!hardware"
        @click:clear="onQuickSearchClear"
        :menu-props="{ maxWidth: 'min-content', minWidth: '100%' }"
        hide-details
      />
    </div>
    <div class="hw-row">
      <span class="hw-label">{{ vendorLabel }}</span>
      <VSelect :items="vendors" v-model="store.vendor" :disabled="!store.version" hide-details/>
    </div>
    <div class="hw-row hw-row--last">
      <span class="hw-label">Hardware Target</span>
      <VAutocomplete :items="targets" v-model="store.target" :disabled="!store.vendor" hide-details/>
    </div>
  </div>

  <VSnackbar v-model="fetchFailed" vertical color="red-darken-3" content-class="td-error-snackbar">
    <div class="text-subtitle-1 pb-2">Targets Fetch Failed</div>
    <p>{{ fetchFailedMessage }}</p>
    <template v-slot:actions>
      <VBtn variant="text" color="white" @click="fetchFailed = false">✕</VBtn>
    </template>
  </VSnackbar>
</template>

<style scoped>
</style>