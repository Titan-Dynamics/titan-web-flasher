<script setup>
import {ref} from "vue";

let ssid = defineModel('ssid')
let password = defineModel('password')

let showPassword = ref(false)
</script>

<template>
  <div class="hw-row">
    <span class="hw-label">WiFi SSID</span>
    <VTextField v-model="ssid" name="wifi-ssid" hide-details/>
  </div>
  <div class="hw-row">
    <span class="hw-label">WiFi Password</span>
    <VTextField v-model="password" name="wifi-password"
                :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                :type="showPassword ? 'text' : 'password'"
                @click:append-inner="showPassword = !showPassword"
                hide-details/>
  </div>
</template>
