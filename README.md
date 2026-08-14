# TitanLRS Web Flasher

Web-hosted flasher for TitanLRS firmware (ExpressLRS fork for Titan Dynamics).

# Using the Titan Web Flasher


Usage guide: https://github.com/Titan-Dynamics/titan-web-flasher/wiki/Using-the-Titan-Web-Flasher

## Supported Flashing Methods

- UART (Receivers do not need to be in bootloader mode)
- Betaflight passthrough
- EdgeTX passthrough

## Device Dashboard (USB configuration)

The **Device Dashboard** card on the landing page configures an already-flashed device over USB,
without WiFi. It connects over WebSerial and renders the same panels the ESP targets serve over
their built-in web UI.

Press **Connect to Device** on that card to pick the port and go straight into the dashboard —
the WebSerial port chooser has to be raised from that click, so there is no separate connect page.
`?dashboard` only opens the dashboard directly in mock mode (see *Developing the dashboard without
hardware* below).

### Supported devices

TitanLRS STM32H743 transmitters and receivers running firmware that includes the USB config API
(the `lib/USBConfig` service, first released in the USB Config API firmware release). The device
enumerates as USB `0483:5740` ("Titan Dynamics"). ESP targets are not supported here — they are
configured through their own WiFi web UI.

### What you can change

| | TX | RX |
|---|---|---|
| Information / export config | ✅ | ✅ |
| Binding phrase | ✅ saved to the device | ✅ saved to the device |
| Runtime options (domain, tlm interval, …) | ✅ saved to the device | ✅ saved to the device |
| Model match / force telemetry off | — | ✅ |
| Serial protocol | — | ✅ |
| Button actions | ✅ | — |
| Model import / export | ✅ | — |

Runtime options are saved to the device and survive power cycles, but every one of them is
applied at boot — the dashboard prompts to reboot after a save. *Reset to defaults* puts the
device back on the values it was flashed with, and re-flashing does the same automatically.

Two settings stay compile-time and are not offered here: the 2.4 GHz regulatory domain (there is
only one) and CE LBT, which is wired into the build. Changing the sub-GHz regulatory domain
breaks the link until both the transmitter and the receiver are moved to the same domain.

Firmware older than the dynamic-options release reports a capability bit of 0; the dashboard then
shows those settings read-only instead of hiding them.

### Browser support

WebSerial is required: Chrome, Edge, Opera or another Chromium-based desktop browser. Firefox and
Safari are not supported. The page must be served over HTTPS (GitHub Pages already is) or from
`localhost`.

### Troubleshooting

- **Device not listed in the chooser** — it is in DFU (bootloader) mode, not normal mode.
  Power-cycle it. Check the cable is a data cable, not charge-only.
- **"Failed to open serial port" / device busy** — another tab, a serial monitor, Mission Planner
  or a configurator still holds the port. Close it and try again.
- **Connection drops after saving** — expected when the change requires a reboot. The device
  re-enumerates over USB; use the Reconnect button.
- **On a TX carrying MAVLink over USB** — opening a config session pauses MAVLink forwarding and
  resumes it on disconnect (or after 3 s of silence). Disconnect cleanly when you are done.
- **TX with EdgeTX driving CRSF over USB** — if the transmitter has already committed the USB port
  to the handset, the config service is unavailable on that port.

### Developing the dashboard without hardware

```bash
npm run dev
# then open
#   http://localhost:5173/?dashboard&mock=tx
#   http://localhost:5173/?dashboard&mock=rx
```

The panels under `src/dashboard/` are copies of the firmware's own web UI. Read
[`src/dashboard/PORTING.md`](src/dashboard/PORTING.md) before editing them — it records the source
commit and the procedure for re-syncing.

## Developing and Testing Locally

### 1. Download Firmware

Download TitanLRS firmware from GitHub Releases:

```bash
./get_artifacts.sh
```

To download a specific version (used for both firmware and backpack), pass it as an argument:

```bash
./get_artifacts.sh <version>
```

Available firmware versions: https://github.com/Titan-Dynamics/TitanLRS/releases
Available backpack versions: https://github.com/Titan-Dynamics/TitanLRS-Backpack/releases

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Development Server

```bash
npm run dev
```

The development server will start (typically at http://localhost:5173).

### 4. Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Firmware Structure

The `get_artifacts.sh` script downloads firmware from TitanLRS GitHub Releases and creates the following structure:

```
public/assets/
├── firmware/
│   ├── index.json           # Version index
│   ├── {VERSION}/           # e.g., 4.0.0-TD
│   │   ├── FCC/            # FCC region firmware
│   │   ├── LBT/            # LBT region firmware
│   │   └── hardware/
│   └── hardware/
│       └── targets.json
└── backpack/
    └── index.json
```

## Repository Information

- **Web Flasher Fork**: https://github.com/Titan-Dynamics/web-flasher
- **Firmware Source**: https://github.com/Titan-Dynamics/TitanLRS/releases
- **Backpack Source**: https://github.com/Titan-Dynamics/TitanLRS-Backpack/releases
- **Upstream**: https://github.com/ExpressLRS/web-flasher

## License

Developed by the ExpressLRS community. Adapted for TitanLRS by Titan Dynamics.
