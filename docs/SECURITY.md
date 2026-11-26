# Security notes

For auditors and the cautious. Lockscape is a **screen lock**; it does not encrypt your notes. Everything below was checked against the build in this repository.

## Audit facts

| | |
|---|---|
| Runtime dependencies | **0** (only the `obsidian` API, provided by the app) |
| Network access | **None** (no fetch/XHR/WebSocket; verify: `grep -nE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function|innerHTML" main.js`). Images/videos are only ever local files chosen with the OS picker; videos are checked via a local `blob:` URL; the CSS contains only inline `data:` SVGs |
| Node/Electron APIs | No `fs`/network/child-process use. The plugin is **desktop only** (`isDesktopOnly: true`) because it uses Electron's window and power-monitor objects (below). **One optional, desktop-only exception:** the *shrink window* feature calls the window geometry methods (`getBounds`, `getNormalBounds`, `setBounds`, `isMaximized`, `isFullScreen`, `maximize`, `unmaximize`) on Obsidian's own Electron window (`window.electronWindow`, falling back to `require("electron").remote`). **A second optional one:** *lock when the computer locks or sleeps* listens to `remote.powerMonitor` (`lock-screen`, `suspend`) and does nothing if the app does not expose it. Both are guarded by `Platform.isDesktopApp`; no-ops on mobile. See `src/windowSize.ts` |
| Source | `src/crypto.ts` (hashing), `src/lockscreen.ts` (overlay), `src/main.ts` (lifecycle, settings), `src/themes.ts` (theme list, high-score parsing), `src/games/*` (the three offline canvas games and their host), `src/i18n/*` (strings) |
| Build | `npm ci && npm run build` → `main.js` (unminified, readable). Dev deps are pinned by `package-lock.json` |
| Stored data | `.obsidian/plugins/lockscape/data.json`: PBKDF2-SHA256 hash (600k iterations, 16-byte random salt, NFKC-normalised password), settings, failed-attempt counter, **to-do items (plain text)**, a capped activity log (see below) |
| Background image | Chosen with the OS file picker, downscaled to ≤1920px, re-encoded as JPEG and saved as `lockscreen-bg.jpg` in the plugin folder. **No URL input** — nothing is fetched from the network |
| DOM safety | No `innerHTML`; user text (to-dos) is only ever set with `textContent` |

## Threat model (read this before relying on it)

**Protects against:** a colleague or passer-by using your unlocked, unattended Obsidian
(startup, idle timeout, app switch, minimise; content is covered immediately when you leave the app).

**Does NOT protect against:**
- Anyone who can read the vault folder: notes are plain `.md` files. Use **FileVault / BitLocker** for lost or stolen devices.
- Anyone who can disable the plugin or edit `data.json` / developer tools. A UI lock inside the app cannot stop this.
- Offline guessing of the password from a copy of `data.json` (it syncs with the vault). Use a long passphrase (≥ 12 chars recommended; 8 is the enforced minimum).
- Cloud sync providers see the plain notes.

- **The to-do list on the lock screen is visible and editable without the password** (that is the point of the feature). It is **off by default**; never put anything sensitive in it. It is stored unencrypted in `data.json`.
- The background photo is stored unencrypted in the plugin folder and syncs with the vault.

Behaviour worth knowing:
- **Activity log.** The last 50 locks (with the reason: startup, idle, left the app, manual, computer locked), unlocks and wrong passwords, shown at the bottom of the settings tab. Timestamps only: no password, no note content, no device name. It syncs in `data.json` and is **not tamper-proof** (anyone who can edit `data.json` can edit or clear it).
- **Separate settings on this device.** Auto-lock time, leave-the-app options, cover on focus loss, system lock and window shrinking can be kept per device. They are then stored in Obsidian's vault-scoped local storage (`app.saveLocalStorage`, hence `minAppVersion` 1.8.7), never synced; the shared values in `data.json` are left untouched. Turning it off returns to the shared values.
- Wrong-password back-off: 5 free tries, then 30 s doubling up to 15 min (persisted across restarts).
- If WebCrypto is unavailable the lock **fails closed** (stays locked, shows an error).
- **Recovery key.** When a password is first set (and after a reset) the app shows a random 24-character key once, to be written down and kept away from the computer. Only its PBKDF2 hash is stored (`recovery` in `data.json`); the key itself is never stored and the dialog that shows it is closed whenever the screen locks. On the lock screen, *Forgot your password?* accepts the key; it shares the password's failure counter and back-off, and after a correct key the app asks for a new password and issues a new key. The key has 120 random bits, so unlike a PIN it cannot be guessed offline from a copy of `data.json`. Anyone holding the key can unlock the screen: treat it like the password. Existing users create one in *Settings → Lockscape → Recovery key* (asks for the current password). Removing the password also removes the key. Copy-to-clipboard in that dialog is the plugin's only clipboard use (write only).
- **No other recovery.** No reset link, no PIN, no master password. If both the password and the key are lost (outside the app, needs access to the vault folder, which already means the notes are readable):
  1. Quit Obsidian (and any device that syncs this vault, or the old hash syncs back).
  2. Open `<vault>/.obsidian/plugins/lockscape/data.json` and delete the whole `"credential": {...}` entry and the `"recovery"` entry. Also set `failCount` and `retryAt` to 0 and `lockedAtExit` to `false`.
  3. Start Obsidian: the lock is off. Set a new password in *Settings → Lockscape*.
  4. In a company setting, write down who may do this and where the step is logged (the activity log does not record it; use the vault's file history).
- Popout windows are covered too. Modals and notices created while locked are made `inert`.
