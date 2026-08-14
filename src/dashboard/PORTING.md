# Dashboard panel port — provenance and sync procedure

Everything in `src/dashboard/` except `index.js`, `features.js` and this file is a **copy** of the
TitanLRS firmware's own web UI. The firmware tree is the single source of truth; the copies here
exist only because the flasher reaches the device over WebUSB instead of HTTP.

- **Source repo:** `TitanLRS/src/html/src`
- **Source branch/commit at time of copy:** `add-usb-config-support` @ `b95e4391`
  ("Web UI: warn before a regulatory-domain change, rebuild artifacts")

## What was copied

| Copied to                     | From                                  |
|-------------------------------|---------------------------------------|
| `pages/info-panel.js`         | `html/src/pages/info-panel.js`        |
| `pages/binding-panel.js`      | `html/src/pages/binding-panel.js`     |
| `pages/tx-options-panel.js`   | `html/src/pages/tx-options-panel.js`  |
| `pages/rx-options-panel.js`   | `html/src/pages/rx-options-panel.js`  |
| `pages/buttons-panel.js`      | `html/src/pages/buttons-panel.js`     |
| `pages/models-panel.js`       | `html/src/pages/models-panel.js`      |
| `pages/connections-panel.js`  | `html/src/pages/connections-panel.js` |
| `pages/serial-panel.js`       | `html/src/pages/serial-panel.js`      |
| `utils/{state,feedback,globals,md5,autocomplete,libs,transport}.js` | `html/src/utils/…` |
| `components/filedrag.js`      | `html/src/components/filedrag.js`     |
| `assets/{td.css,td-extensions.css,td.js}` | `html/src/assets/…`       |

## What was deliberately NOT copied, and why

| Panel                | Reason |
|----------------------|--------|
| `wifi-panel.js`      | There is no WiFi on the STM32 targets — the ST67 coprocessor was cancelled, and USB config is its replacement. |
| `update-panel.js`    | STM32 firmware flashing is DFU-based and is a separate plan/branch. |
| `hardware-layout.js` | STM32 pin maps are compile-time (`include/target/*.h`); there is no `hardware.json`. |
| `continuous-wave.js` | Deferred with firmware Phase 1.3 (`TCFG_CW`). |
| `lr1121-updater.js`  | Deferred with firmware Phase 1.3 (`TCFG_LR1121_UPDATE`). |

## Substitutions applied to the copies

1. **Transport injection.** `utils/transport.js` was replaced wholesale: the firmware copy
   defaults to HTTP (`fetch('/config')`, …); this copy has no default and is filled in by
   `initDashboard()` in `index.js` with a `UsbConfigSession` (or a `MockTransport`).
   **No file under `src/dashboard/` may call `fetch()` or `XMLHttpRequest` — enforce this with**
   `grep -rn --include='*.js' "fetch(\|new XMLHttpRequest" src/dashboard`.

2. **`utils/feedback.js`.** The URL/XHR-based helpers (`post`, `postJSON`, `saveJSONWithReboot`,
   `postWithFeedback`) were removed; only the promise-based `saveWithReboot`,
   `actionWithFeedback` and the alert helpers remain. The firmware keeps the URL variants for the
   ESP-only panels above.

3. **Compile-time feature blocks → runtime conditionals.** The firmware build strips
   `<!-- FEATURE:X -->` / `// FEATURE: X` regions per target. The dashboard is built once and must
   serve any device, so each block became a conditional on `features.js`:

   | Firmware block        | Dashboard replacement |
   |-----------------------|-----------------------|
   | `FEATURE:IS_TX`       | `FEATURES.IS_TX` (from HELLO `module-type`) |
   | `FEATURE:NOT IS_TX`   | `!FEATURES.IS_TX` |
   | `FEATURE:HAS_SUBGHZ`  | `FEATURES.HAS_SUBGHZ` (from `settings.has_low_band`) |

   Panels that already self-hide on the shape of the config document (`config.pwm`,
   `config['button-actions']`) were left alone — `index.js::tabsFor()` uses the same signals.

4. **Options may be read-only.** Firmware with dynamic options reports HELLO feature bit0
   (`FEATURE_OPTIONS_WRITE`) and everything is writable; older firmware in the field reports 0, so
   `FEATURES.OPTIONS_WRITABLE` is false and:
   - `tx-options-panel` / `rx-options-panel` replace their Save button with a read-only note;
   - the options-only rows (`rx-options-panel`'s regulatory domain and lock-on-first-connection)
     render **disabled rather than hidden**, so the values are still visible — this is the one
     place the dashboard deliberately renders differently from the firmware copy, which has no
     read-only case;
   - `rx-options-panel` still saves the *config* half (model match, force-tlm) via `saveConfig`;
   - `binding-panel` hides Save on TX (the UID lives in options) but keeps it on RX (the UID lives
     in `config.uid`). There is deliberately no "Reset to Unbound" on TX — the flashed binding
     phrase comes back via *Reset to defaults* on the options panel.
   `?mock=tx&ro` clears the feature bit so this rendering stays testable without old hardware.

5. **Reboot UX.** On-device the UI reloads the page after a reboot. Over WebUSB the device
   re-enumerates instead, so `utils/transport.js` fires a `td-device-rebooting` window event
   before `reboot()`/`reset()` and `DeviceDashboard.vue` shows "rebooting — reconnect" as a banner
   inside the shell. A lost connection uses the same banner: `DeviceDashboard.vue` has no
   disconnected view at all, because the session is opened by the landing page's *Connect to
   Device* button (the WebUSB chooser needs that click's user activation) and handed over in
   `store.usbSession`. Leaving the device — Disconnect, Home, or a failure to read the config —
   returns to the landing page, which reports `store.usbError`.

6. **`info-panel.js`.** The "Flash Firmware" button (a link to the on-device `#update` route) was
   removed — there is no such route here.

6b. **AirPort is never offered.** AirPort turns the device's serial port into a transparent
   passthrough, which takes the USB config link down with it: the dashboard would lose the device
   the moment it saved the change, and there is no way back in short of re-flashing. So the
   flasher copies drop both routes to it — the "AirPort Serial device" toggle and its UART-baud
   row in `tx-options-panel.js`, and the "AirPort" entry in `serial-panel.js`'s Serial 1 Protocol
   list. The on-device UI keeps both: those targets have WiFi as a recovery path.
   Two things to preserve when re-copying:
   - the protocol entry is **skipped in place, matched by label**, never filtered out — a
     protocol's stored value is its index in `SERIAL_OPTIONS1`/`SERIAL_OPTIONS2`, so removing an
     element would renumber every protocol after it (and the two lists put AirPort/DisplayPort at
     different indices);
   - neither panel posts `is-airport` any more. The device's stored value is preserved regardless,
     because `state.js` posts the whole merged options document.
   `info-panel.js` still *displays* an AirPort chip if a device reports it — read-only, no way to
   set it.

7. **Scoped CSS.** `assets/td.css` and `assets/td-extensions.css` had every selector prefixed with
   `.td-dashboard` (and `:root`/`html`/`body` rewritten to `.td-dashboard`) so the firmware design
   tokens and component classes cannot fight Vuetify's globals. The panels are rendered inside a
   `<div class="td-dashboard">` in `DeviceDashboard.vue`. Comments are stripped by the transform.
   To regenerate after re-copying, re-run the scoping transform described in the header of those
   files: strip `/* … */`, then prefix every non-at-rule selector at any nesting level with
   `.td-dashboard `, leaving `@keyframes` stops (`from`/`to`/`NN%`) untouched.

   **Consequence — anything appended to `document.body` is unstyled here.** `cuteAlert()` in
   `utils/feedback.js` therefore mounts into `document.querySelector('.td-dashboard')` instead of
   `document.body`; on-device it appends to the body, which is correct there. Without that change
   the alert loses `position: fixed` and lands as a static block below the fixed full-viewport
   shell — invisible, and every confirm dialog silently never resolves. Apply the same rule to any
   future code that injects markup outside the component tree.

## Sync procedure (when the firmware web UI changes)

1. Re-copy the files in the table above from `TitanLRS/src/html/src`.
2. Re-apply substitutions 1–7. `git diff` against the previous copy is the fastest way to see
   which of them you have lost.
3. Re-run the scoping transform on the two CSS files.
4. Update the **source commit** at the top of this file.
5. `npm run build`, then check
   `grep -rn --include='*.js' "fetch(\|new XMLHttpRequest" src/dashboard` is empty.
6. Smoke-test both module types without hardware: `npm run dev` then `?dashboard&mock=tx` and
   `?dashboard&mock=rx`.
