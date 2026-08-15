/*
 * features.js (dashboard) — runtime replacement for the firmware build's compile-time
 * feature blocks.
 *
 * The on-device web UI is built once per target and the vite feature-blocks-plugin physically
 * strips `<!-- FEATURE:X -->` regions it doesn't need. The dashboard is built once and must
 * serve any connected device, so the same decisions are made at runtime from the HELLO metadata
 * and the shape of the config document. PORTING.md lists the substitutions that were applied
 * to each copied panel.
 */

export const FEATURES = {
  IS_TX: false,
  HAS_SUBGHZ: false,
  HAS_LR1121: false,
  // HELLO feature bit0. Firmware with dynamic options sets it and the options panels and TX
  // binding phrase become writable; firmware still in the field reports 0 and they render
  // read-only (options rows disabled rather than hidden, save replaced by a note).
  OPTIONS_WRITABLE: false,
  // HELLO feature bit3. Firmware with the TCFG_CRSF tunnel gets the Parameters tab; firmware
  // without it never sees the tab at all, rather than a tab that silently times out.
  CRSF_PARAMS: false,
}

export function applyFeatures({hello, settings, optionsWritable, crsfParams}) {
  FEATURES.IS_TX = (hello?.['module-type'] || settings?.['module-type']) === 'TX'
  FEATURES.HAS_SUBGHZ = !!settings?.has_low_band
  FEATURES.HAS_LR1121 = (hello?.['radio-type'] || settings?.['radio-type']) === 'LR1121'
  FEATURES.OPTIONS_WRITABLE = !!optionsWritable
  FEATURES.CRSF_PARAMS = !!crsfParams
  return FEATURES
}

export default FEATURES
