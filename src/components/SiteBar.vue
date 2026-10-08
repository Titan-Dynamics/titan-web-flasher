<script setup>
import {ref} from 'vue'
import {DEVICE_CONFIG_ENABLED} from '../js/featureFlags'
import logoUrl from '../assets/brand/td-full-logo-white.png'
import flagUrl from '../assets/brand/us-flag.svg'

// The titandynamics.aero header (.sitebar), with this app's two pages as its menu.
defineProps({
  // 'firmware' | 'configurator': the app page to mark as active.
  active: {type: String, default: 'firmware'},
  // Pin the bar to the top of the viewport (the configurator's fixed shell sits under it).
  fixed: {type: Boolean, default: false},
})
const emit = defineEmits(['home', 'navigate'])

const appLinks = [
  {key: 'firmware', label: 'FIRMWARE'},
  ...(DEVICE_CONFIG_ENABLED ? [{key: 'configurator', label: 'CONFIGURATOR'}] : []),
]

const navOpen = ref(false)

function closeNav() {
  navOpen.value = false
}

function go(key) {
  closeNav()
  emit('navigate', key)
}

function home() {
  closeNav()
  emit('home')
}
</script>

<template>
  <header class="td-sitebar" :class="{'is-nav-open': navOpen, 'td-sitebar--fixed': fixed}">
    <button class="td-sitebar-home" type="button" @click="home" aria-label="Back to the Web Flasher">
      <img class="td-sitebar-logo" :src="logoUrl" alt="Titan Dynamics" />
    </button>
    <button class="td-sitebar-burger" type="button" aria-label="Toggle navigation"
            :aria-expanded="String(navOpen)" aria-controls="td-sitebar-nav" @click.stop="navOpen = !navOpen">
      <span></span><span></span><span></span>
    </button>
    <nav class="td-sitebar-nav" id="td-sitebar-nav">
      <a v-for="l in appLinks" :key="l.key" class="td-sitebar-link" :class="{'is-active': active === l.key}"
         href="#" @click.prevent="go(l.key)">{{ l.label }}</a>
    </nav>
    <span class="td-sitebar-flag" :style="{'--flag-url': `url('${flagUrl}')`}" role="img" aria-label="Made in USA"></span>
  </header>
  <!-- Holds the bar's place in the flow while it is pinned. -->
  <div v-if="fixed" class="td-sitebar-spacer"></div>
  <div class="td-sitebar-backdrop" :class="{'is-active': navOpen}" @click="closeNav"></div>
</template>

<style>
/* The site's heading face, served from titandynamics.aero with CORS; system-ui until it loads. */
@font-face {
  font-family: "Technovier";
  src: url("https://titandynamics.aero/fonts/Technovier-Regular.otf") format("opentype");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  size-adjust: 88%;
}

@font-face {
  font-family: "Technovier";
  src: url("https://titandynamics.aero/fonts/Technovier-Bold.otf") format("opentype");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
  size-adjust: 88%;
}

:root {
  --td-sitebar-h: clamp(54px, 8vw, 68px);
}

@media (orientation: landscape) and (max-height: 500px) {
  :root {
    --td-sitebar-h: 44px;
  }
}

/* Mirrors titandynamics.aero's .sitebar: height, gradient, blur, hairline, safe-area padding,
   menu styling, and the burger + drop-down on narrow screens. The site switches at 940px for its
   five links; with two, the bar fits down to 600px. */
.td-sitebar {
  position: relative;
  z-index: 300;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: clamp(12px, 2.4vw, 28px);
  height: var(--td-sitebar-h);
  padding: 0 max(18px, env(safe-area-inset-right));
  padding-left: max(18px, env(safe-area-inset-left));
  border-bottom: 1px solid rgba(180, 180, 180, 0.12);
  background: linear-gradient(180deg, #161616eb, #0c0c0c9e);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}

.td-sitebar--fixed {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
}

.td-sitebar-spacer {
  flex: 0 0 auto;
  height: var(--td-sitebar-h);
}

.td-sitebar-home {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  line-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

/* No focus ring, as on the homepage's logo link. */
.td-sitebar-home:focus,
.td-sitebar-home:focus-visible {
  outline: none;
}

.td-sitebar-logo {
  display: block;
  height: clamp(26px, 5vw, 40px);
  width: auto;
}

.td-sitebar-nav {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: clamp(4px, 1.2vw, 18px);
}

.td-sitebar-link {
  position: relative;
  font-family: "Technovier", system-ui, sans-serif;
  font-weight: 600;
  font-size: clamp(12px, 1.25vw, 14px);
  letter-spacing: 0.16em;
  color: #828282;
  text-decoration: none;
  white-space: nowrap;
  padding: 8px 6px;
  transition: color 0.15s;
}

.td-sitebar-link::after {
  content: "";
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 2px;
  height: 2px;
  background: #a39c63;
  box-shadow: 0 0 8px rgba(85, 83, 51, 0.55);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.18s ease;
}

.td-sitebar-link:hover {
  color: #d6d6d6;
}

.td-sitebar-link:hover::after {
  transform: scaleX(0.5);
}

.td-sitebar-link.is-active {
  color: #a39c63;
  text-shadow: 0 0 10px rgba(85, 83, 51, 0.55);
}

.td-sitebar-link.is-active::after {
  transform: scaleX(1);
}

/* The flag is drawn white through the SVG as a mask, as on the homepage. */
.td-sitebar-flag {
  flex: 0 0 auto;
  margin-left: 4px;
  height: clamp(18px, 4.6vw, 38px);
  aspect-ratio: 2431 / 1280;
  background-color: #fff;
  -webkit-mask: var(--flag-url) center / contain no-repeat;
  mask: var(--flag-url) center / contain no-repeat;
}

.td-sitebar-burger {
  display: none;
  margin-left: auto;
  flex-direction: column;
  justify-content: center;
  gap: 5px;
  width: 42px;
  height: 36px;
  padding: 9px;
  cursor: pointer;
  background: #0a0a0a99;
  border: 1px solid rgba(180, 180, 180, 0.12);
}

.td-sitebar-burger span {
  display: block;
  width: 100%;
  height: 2px;
  background: #a39c63;
  box-shadow: 0 0 6px rgba(85, 83, 51, 0.55);
  transition: transform 0.2s, opacity 0.2s;
}

.td-sitebar.is-nav-open .td-sitebar-burger span:nth-child(1) {
  transform: translateY(7px) rotate(45deg);
}

.td-sitebar.is-nav-open .td-sitebar-burger span:nth-child(2) {
  opacity: 0;
}

.td-sitebar.is-nav-open .td-sitebar-burger span:nth-child(3) {
  transform: translateY(-7px) rotate(-45deg);
}

.td-sitebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 290;
}

.td-sitebar-backdrop.is-active {
  display: block;
}

@media (max-width: 600px) {
  .td-sitebar-burger {
    display: flex;
  }

  .td-sitebar-flag {
    display: none;
  }

  .td-sitebar-nav {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    margin: 0;
    padding: 6px 0 10px;
    background: linear-gradient(180deg, #121212d9, #0a0a0ae0);
    backdrop-filter: blur(16px) saturate(140%);
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    border-bottom: 1px solid rgba(163, 156, 99, 0.15);
    box-shadow: 0 24px 40px #00000059;
    transform: translateY(-10px);
    opacity: 0;
    visibility: hidden;
    transition: transform 0.2s ease, opacity 0.2s ease, visibility 0.2s;
  }

  .td-sitebar.is-nav-open .td-sitebar-nav {
    transform: none;
    opacity: 1;
    visibility: visible;
  }

  .td-sitebar ~ * {
    transition: filter 0.2s ease;
  }

  .td-sitebar.is-nav-open ~ *:not(.td-sitebar-backdrop) {
    filter: blur(4px);
  }

  .td-sitebar-link {
    padding: 14px 22px;
    font-size: 15px;
    letter-spacing: 0.2em;
    border-left: 2px solid transparent;
    opacity: 0;
    transform: translateX(-14px);
    transition: opacity 0.14s ease, transform 0.14s ease, color 0.15s, border-color 0.15s, background 0.15s;
  }

  .td-sitebar.is-nav-open .td-sitebar-link {
    opacity: 1;
    transform: none;
  }

  .td-sitebar.is-nav-open .td-sitebar-link:nth-child(1) { transition-delay: 0.04s; }
  .td-sitebar.is-nav-open .td-sitebar-link:nth-child(2) { transition-delay: 0.08s; }

  .td-sitebar-link::after {
    display: none;
  }

  .td-sitebar-link.is-active {
    border-left-color: #a39c63;
    background: rgba(85, 83, 51, 0.18);
  }
}

@media (orientation: landscape) and (max-height: 500px) {
  .td-sitebar {
    padding: 0 14px;
  }

  .td-sitebar-logo,
  .td-sitebar-flag {
    height: 22px;
  }
}
</style>
