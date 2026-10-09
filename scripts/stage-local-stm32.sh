#!/bin/bash
# Stage locally built TitanLRS unified STM32 firmware, targets and layouts for `npm run dev`.
#
#   scripts/stage-local-stm32.sh <FW path> [version=4.99.0-local] [extra env ...]
#
# <FW path> is a TitanLRS checkout (the directory holding src/platformio.ini). Builds the
# Unified_STM32H743_LR2021_{TX,RX} envs (FCC only), copies the binaries under
# public/assets/firmware/<version>/FCC/, adds <version> to public/assets/firmware/index.json, and
# writes the dev-only targets override (public/assets/targets-local/) that src/js/targets.js merges
# in dev builds. The layouts are copied from <FW path>/src/hardware (the targets repo checkout), so
# edits there are what gets flashed. Run ./get_artifacts.sh FIRST: it wipes public/assets/firmware.
#
# Extra envs (full PlatformIO names, e.g. Unified_ESP32_LR1121_TX_via_UART) are built too and staged
# as CI stages them: every .bin of the build under FCC/<env without _via_*>/. Use this to put ESP
# builds of the same tree into the local version, e.g. to check them for regressions.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <FW path> [version=4.99.0-local] [extra env ...]" >&2
  exit 1
fi

FW="$(cd "$1" && pwd)"
VERSION="${2:-4.99.0-local}"
WF="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${FW}/src"
ENVS=(Unified_STM32H743_LR2021_TX Unified_STM32H743_LR2021_RX)
EXTRA_ENVS=("${@:3}")

if [ ! -f "${SRC}/platformio.ini" ]; then
  echo "❌ ${SRC}/platformio.ini not found - is ${FW} a TitanLRS checkout?" >&2
  exit 1
fi

PIO="$(command -v pio || true)"
if [ -z "${PIO}" ]; then
  PIO="${HOME}/.platformio/penv/bin/pio"
fi
if [ ! -x "${PIO}" ]; then
  echo "❌ PlatformIO not found (not on PATH, nor at ~/.platformio/penv/bin/pio)" >&2
  exit 1
fi

# Staged builds are for local testing only. A binding phrase or regulatory domain baked in at build
# time overrides what the web flasher patches in, and a DEBUG_ define changes runtime behaviour, so
# list any such overrides from either define file (PlatformIO reads both, python/build_flags.py).
for defines in "${SRC}/user_defines.txt" "${SRC}/super_defines.txt"; do
  [ -f "${defines}" ] || continue
  overrides="$(grep -E '^[[:space:]]*-D(MY_BINDING_PHRASE|Regulatory_Domain|DEBUG_)' "${defines}" | sed 's/^[[:space:]]*//' || true)"
  if [ -n "${overrides}" ]; then
    echo "⚠️  ${defines} has build overrides that will be in the staged firmware:"
    echo "${overrides}" | sed 's/^/     /'
  fi
done

if [ ! -f "${WF}/public/assets/firmware/index.json" ]; then
  echo "⚠️  public/assets/firmware/index.json is missing. Run ./get_artifacts.sh first (it wipes"
  echo "   public/assets/firmware, so run it before this script, never after)."
fi

echo "🔨 Building ${ENVS[*]} (FCC)"
for env in "${ENVS[@]}"; do
  PLATFORMIO_BUILD_FLAGS="-DRegulatory_Domain_FCC_915" "${PIO}" run -d "${SRC}" -e "${env}_via_STLINK"
done

FW_OUT="${WF}/public/assets/firmware/${VERSION}/FCC"
for env in "${ENVS[@]}"; do
  mkdir -p "${FW_OUT}/${env}"
  cp "${SRC}/.pio/build/${env}_via_STLINK/firmware.bin" "${FW_OUT}/${env}/firmware.bin"
  echo "📦 ${FW_OUT}/${env}/firmware.bin"
done

for env in ${EXTRA_ENVS[@]+"${EXTRA_ENVS[@]}"}; do
  echo "🔨 Building ${env} (FCC)"
  PLATFORMIO_BUILD_FLAGS="-DRegulatory_Domain_FCC_915" "${PIO}" run -d "${SRC}" -e "${env}"
  out="${FW_OUT}/${env%%_via_*}"
  rm -rf "${out}"
  mkdir -p "${out}"
  cp "${SRC}/.pio/build/${env}/"*.bin "${out}/"
  echo "📦 ${out}/{$(cd "${out}" && ls *.bin | paste -sd, -)}"
done

LOCAL="${WF}/public/assets/targets-local"
mkdir -p "${LOCAL}/TX" "${LOCAL}/RX"

python3 -I - "${WF}/public/assets/firmware/index.json" "${LOCAL}" "${VERSION}" "${SRC}/hardware" <<'PY'
import json, os, sys

index_path, local, version, hardware = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

# Firmware index: add the local version alongside whatever get_artifacts.sh staged.
index = {"tags": {}, "branches": {}}
if os.path.exists(index_path):
    with open(index_path) as f:
        index = json.load(f)
index.setdefault("tags", {})[version] = version
index.setdefault("branches", {})
os.makedirs(os.path.dirname(index_path), exist_ok=True)
with open(index_path, "w") as f:
    json.dump(index, f, indent=2)

# Targets override (Part C1 of the STM32 web-flasher plan), merged over any existing local file.
targets = {
    "titan_dynamics": {
        "name": "Titan Dynamics",
        "tx_dual": {
            "lr2021_gemini_stm32h7_tx": {
                "product_name": "Titan Dynamics LR2021 STM32H7 TX Gemini",
                "lua_name": "TD LR2021 G TX",
                "layout_file": "TD LR2021 STM32H7 Gemini TX.json",
                "upload_methods": ["dfu"],
                "min_version": version,
                "platform": "stm32",
                "firmware": "Unified_STM32H743_LR2021_TX",
                "dfu": {"address": "0x08000000"},
                "usb": {"app": {"vendorId": 4617, "productId": 1}},
            }
        },
        "rx_dual": {
            "lr2021_gemini_stm32h7_rx": {
                "product_name": "Titan Dynamics LR2021 STM32H7 RX Gemini",
                "lua_name": "TD LR2021 G RX",
                "layout_file": "TD LR2021 STM32H7 Gemini RX.json",
                "upload_methods": ["dfu"],
                "min_version": version,
                "platform": "stm32",
                "firmware": "Unified_STM32H743_LR2021_RX",
                "dfu": {"address": "0x08000000"},
                "usb": {"app": {"vendorId": 4617, "productId": 1}},
            }
        },
    }
}
targets_path = os.path.join(local, "targets.json")
merged = {}
if os.path.exists(targets_path):
    with open(targets_path) as f:
        merged = json.load(f)
for vendor, radios in targets.items():
    v = merged.setdefault(vendor, {})
    for radio, entries in radios.items():
        if radio == "name":
            v[radio] = entries
        else:
            v.setdefault(radio, {}).update(entries)
with open(targets_path, "w") as f:
    json.dump(merged, f, indent=2)

# Layouts: the ones in the firmware checkout's targets repo (src/hardware), so local edits there
# (LED invert, fan pins, ...) are what gets flashed. The built-in copy below is only a fallback for
# a checkout without them. Power levels are POWERMGNT PowerLevels_e: PWR_10mW = 0, PWR_100mW = 3.
tx = {
    "serial_rx": "PB10", "serial_tx": "PB10",
    "radio_nss": "PE0", "radio_sck": "PE12", "radio_miso": "PE13", "radio_mosi": "PE14",
    "radio_rst": "PE7", "radio_dio1": "PE1", "radio_busy": "PE9",
    "radio_nss_2": "PE8", "radio_rst_2": "PE5", "radio_dio1_2": "PE6", "radio_busy_2": "PE15",
    "radio_dcdc": True,
    "config_flash_cs": "PD6", "config_flash_sck": "PB3", "config_flash_miso": "PB4", "config_flash_mosi": "PD7",
    "led_red": "PE3",
    "button": "PE2", "button_active_high": True,
    "power_min": 0, "power_high": 3, "power_max": 3, "power_default": 0,
    "power_control": 0,
    "power_values": [19, 25, 31, 37],
    "power_values2": [19, 25, 31, 37],
    "power_values_dual": [0, 8, 16, 24],
}
rx = dict(tx, serial_rx="PB11", serial_tx="PB10")
for sub, name, layout in (("TX", "TD LR2021 STM32H7 Gemini TX.json", tx),
                          ("RX", "TD LR2021 STM32H7 Gemini RX.json", rx)):
    source = os.path.join(hardware, sub, name)
    if os.path.exists(source):
        with open(source) as f:
            layout = json.load(f)
        print(f"   layout:   {sub}/{name} from {source}")
    else:
        print(f"⚠️  {source} not found; staging the built-in {sub} layout")
    with open(os.path.join(local, sub, name), "w") as f:
        json.dump(layout, f, indent=2)
PY

echo ""
echo "✅ Staged ${VERSION}:"
echo "   firmware: public/assets/firmware/${VERSION}/FCC/{$(IFS=,; echo "${ENVS[*]}")}/firmware.bin"
echo "   targets:  public/assets/targets-local/targets.json (+ TX/ and RX/ layouts)"
echo "Reminder: ./get_artifacts.sh wipes public/assets/firmware - re-run this script after it."
echo "Run: npm run dev"
