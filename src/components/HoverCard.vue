<script setup>
import {VCard, VCardText, VCardTitle, VHover} from 'vuetify/components'

// `interactive` is on by default: the card is a button and lights up on hover. Pass false for a
// card that only hosts its own controls (the Device Dashboard card and its Connect button).
const props = defineProps({
  image: String,
  hoverImage: String,
  title: String,
  text: String,
  interactive: {type: Boolean, default: true},
})
</script>

<template>
  <VHover v-slot:default="{ isHovering, props }">
    <VCard v-bind="$attrs, props" class='default-card'
           :class="{'hover-card' : isHovering && interactive}">
      <div class="option-card">
        <div class="option-icon">
          <img :src="image" height="56" width="56"/>
        </div>
        <div class="option-content">
          <VCardTitle>{{ title }}</VCardTitle>
          <VCardText>{{ text }}</VCardText>
        </div>
        <div v-if="$slots.action" class="option-action">
          <slot name="action"/>
        </div>
      </div>
    </VCard>
  </VHover>
</template>

<style scoped>
.default-card {
  border-radius: var(--td-r-lg) !important;
  border: 1px solid var(--td-line) !important;
  background: var(--td-bg-2) !important;
  transition: background var(--td-dur) var(--td-ease), border-color var(--td-dur) var(--td-ease);
  box-shadow: none !important;
  text-align: left;
  padding: 0;
  width: 100%;
  height: 125px;
}

.hover-card {
  background: var(--td-bg-3) !important;
  border-color: var(--td-line-2) !important;
  box-shadow: none !important;
}

.option-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
}

.option-icon {
  position: relative;
  width: 56px;
  height: 56px;
  flex: 0 0 56px;
}

.option-icon img {
  width: 56px;
  height: 56px;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 320px;
  height: 85px;
  justify-content: center;
}

.option-action {
  margin-left: auto;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

/*
 * A card with an action behaves differently from the four plain ones: its text cannot sit at the
 * fixed 320px they use, or the action squeezes it into a narrow column while the card grows tall.
 * Let the text flex, and drop the action onto its own row once the two no longer fit side by side.
 */
.default-card:has(.option-action) {
  height: auto;
  min-height: 125px;
}

.option-card:has(.option-action) {
  flex-wrap: wrap;
  row-gap: 12px;
}

.option-card:has(.option-action) .option-content {
  width: auto;
  height: auto;
  min-width: 0;
  flex: 1 1 240px;
}

.v-card-title {
  padding: 0;
  margin: 0;
  font-weight: 600;
  font-size: var(--td-fs-lg);
  color: var(--td-fg);
  letter-spacing: -0.005em;
}

.v-card-text {
  padding: 0;
  font-size: var(--td-fs-md);
  line-height: 1.5;
  color: var(--td-fg-mute);
}

@media (max-width: 640px) {
  .default-card {
    height: auto;
  }

  .option-card {
    gap: 12px;
    padding: 16px;
    align-items: center;
  }

  .option-icon {
    width: 44px;
    height: 44px;
    flex: 0 0 44px;
  }

  .option-icon img {
    width: 44px;
    height: 44px;
  }

  .option-content {
    width: 100%;
    min-width: 0;
    height: auto;
  }

  /* Keep the text beside the icon as on every other card; only the action takes a row of its own.
     Basis 0 (not auto, and not the 100% above) is what does it: either of those makes the text
     wider than the space left by the icon, so it wraps onto its own line and the icon sits alone. */
  .option-card:has(.option-action) .option-content {
    width: auto;
    flex: 1 1 0;
  }

  .option-action {
    margin-left: 0;
    width: 100%;
  }

  .option-action :deep(.v-btn) {
    width: 100%;
  }
}

</style>