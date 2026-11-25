# Vault Lock (Obsidian)

Password lock screen for Obsidian on **macOS, Windows, iOS and Android**.
Locks on startup, when idle, and when you leave the app. **It does not encrypt files.**
The lock screen can show a clock, your own background photo, a light animation and a small to-do list.

## Audit facts

| | |
|---|---|
| Runtime dependencies | **0** (only the `obsidian` API, provided by the app) |
| Network access | **None** (no fetch/XHR/WebSocket; verify: `grep -nE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon|eval\(|new Function|innerHTML" main.js`). Images/videos are only ever local files chosen with the OS picker; videos are checked via a local `blob:` URL; the CSS contains only inline `data:` SVGs |
| Node/Electron APIs | No `fs`/network/child-process use → same code on desktop and mobile (`isDesktopOnly: false`). **One optional, desktop-only exception:** the *shrink window* feature calls the window geometry methods (`getBounds`, `setBounds`, `isMaximized`, `isFullScreen`, `maximize`, `unmaximize`) on Obsidian's own Electron window (`window.electronWindow`, falling back to `require("electron").remote`). Guarded by `Platform.isDesktopApp`; a no-op on mobile. See `src/windowSize.ts` |
| Source | `src/crypto.ts` (hashing), `src/lockscreen.ts` (overlay), `src/main.ts` (lifecycle, settings), `src/i18n/*` (strings) |
| Build | `npm ci && npm run build` → `main.js` (unminified, readable). Dev deps are pinned by `package-lock.json` |
| Stored data | `.obsidian/plugins/vault-lock/data.json`: PBKDF2-SHA256 hash (600k iterations, 16-byte random salt, NFKC-normalised password), settings, failed-attempt counter, **to-do items (plain text)** |
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
- Wrong-password back-off: 5 free tries, then 30 s doubling up to 15 min (persisted across restarts).
- If WebCrypto is unavailable the lock **fails closed** (stays locked, shows an error).
- **No recovery.** Forgotten password → disable the plugin / delete the `credential` entry in `data.json`.
- Popout windows are covered too. Modals and notices created while locked are made `inert`.

## Lock screen customisation

Settings → Vault Lock → *Lock screen appearance* (with a **Preview** button that shows the screen without locking; click or Esc closes it).

| Option | Notes |
|---|---|
| Background image | Pick a photo; *Dim* and *Blur* sliders. For very bright photos the dim is raised automatically (legibility floor) so the white text stays readable |
| Animation | None / **Aurora** / **Fireflies** / **Snow** (CSS-only, transform/opacity, tinted with your accent colour) and three **mouse-following** effects drawn on one canvas in the active theme's style: **Cursor spotlight**, **Cursor trail**, **Chasing orbs** (default = soft glows, retro = dithered pixels, cartoon = halftone dots / outlined stars / glossy balls). The loop only runs while something moves (orbs drift continuously), pauses when the window is hidden, and everything is off under the OS "reduce motion" setting |
| Background | None / photo / **video**. Video: MP4 or WebM up to 30 MB and 120 s, played muted and looping only while locked (paused when the window is hidden; first frame only under "reduce motion"), copied unchanged into the plugin folder. Short seamless loops work best |
| Clock | Time, optional seconds, optional date; 12h/24h/auto; formatted in the Obsidian UI language |
| To-do list | Up to 10 items × 80 characters; add / check / delete while locked. Off by default (see threat model) |
| Theme | **Default**, **Retro game** (neon seven-segment clock, pixel padlock, notched panels, scanlines, synthwave grid floor) and **Cartoon** (classic American comics: sunburst + Ben-Day dots, outlined title banner, speech-bubble card, caption-box to-dos). A theme restyles the clock, lock card, field, button, to-dos, icon and animations as a set. Text colour, accent, clock font and field shape set explicitly still win over the theme. No web fonts are downloaded: the themes use system font stacks |
| Hide password field until hover | Off by default. The field is only made transparent (still in the tab order and the accessibility tree): it appears on hover over the lock area, on focus, when it contains text, while a message/“checking” state shows, on any printable key (focus moves in and that key is typed) and on touch-tap. Works in *Preview* too |
| “Locked” text | *Auto* (default: hidden over a photo, shown on the plain screen) / *Always show* / *Hide*. Hidden text stays available to screen readers |
| Shrink window while locked | **Desktop only**, off by default. The Obsidian window shrinks (380×520 / 460×620 / 560×720, around its current centre) while the lock screen shows and returns to its exact previous position and size on unlock. Also applies to *Preview* |

Shrink-window details: the original bounds (and whether the window was maximized) are saved to `data.json` while shrunk, so if Obsidian is quit or crashes while locked, the next start restores the window (after unlock, or immediately when *Lock on startup* is off). Full-screen windows are left alone. Restored bounds are clamped to the display, so an unplugged monitor cannot leave the window off-screen. The shrink is cosmetic: the vault is still fully covered by the overlay either way.

While the grace period is running after you leave the app (mobile app switcher), only the background and clock are shown — the form and to-dos are hidden.

## Lock / unlock flow

- **Locking**: the screen fades in (0.2 s), the padlock snaps shut, then the text rises. The first frames are covered by the overlay, nothing of the note shows.
- **Wrong password**: the card shakes once and the message appears.
- **Correct password**: the padlock opens, the text changes to "Unlocked" (the button shows ✓), then the screen fades out. About 0.5 s in total; with the OS "reduce motion" setting the screen goes away immediately.
- **Hidden field** (retro and cartoon themes with "hide password field until hover"): the padlock, text and the "press any key or tap" prompt sit together in the middle of the card; when the field is revealed they glide up and the field fades in. The card never changes size.
- Duration constants: `UNLOCK_MS` in `src/lockscreen.ts`, keyframes in `styles.css` (section "LOCK / UNLOCK FLOW").

## Customize with CSS snippets (stable hooks)

Anything the settings do not cover can be changed from an Obsidian CSS snippet (Settings → Appearance → CSS snippets) without touching the plugin. These class names and variables are the public surface:

| Hook | Meaning |
|---|---|
| `.vault-lock-overlay` | root; modifier classes: `vl-theme-retro`, `vl-theme-cartoon`, `has-image`, `has-video`, `hover-reveal`, `is-preview`, `is-cover`, `pos-top`, `pos-bottom`, `shape-round/pill/square`, `no-icon`, `custom-title` |
| `.vault-lock-stage` · `.vault-lock-clock` · `.vault-lock-time` · `.vault-lock-date` | the centred column and the clock |
| `.vault-lock-card` · `.vault-lock-icon` · `.vault-lock-title` · `.vault-lock-form` · `.vault-lock-input` · `.vault-lock-button` · `.vault-lock-message` | the lock card |
| `.vault-lock-todos` · `.vault-lock-todo` · `.vault-lock-todo-input` | the to-do panel |
| `.vault-lock-bg` · `.vault-lock-video` · `.vault-lock-anim` · `.vault-lock-fx` | background, video, CSS animation layer, pointer-effect canvas |
| `--vl-text` `--vl-accent` | text / accent colour (set by the options when chosen) |
| `--vl-clock-scale` `--vl-clock-font` `--vl-clock-weight` | clock size multiplier, font stack, weight |
| `--vl-dim` `--vl-blur` `--vl-radius` | media dimming (0–0.8), blur, field/button corner radius |

```css
/* example: a glass card with a bigger clock */
.vault-lock-overlay .vault-lock-card { background: rgba(255,255,255,.12); backdrop-filter: blur(14px); border-radius: 20px; padding: 18px; }
.vault-lock-overlay { --vl-clock-scale: 1.4; }
```
Note: a snippet runs with the app's privileges only in the sense of CSS; avoid `url(http…)` in snippets if you want to keep the "no network" property for this plugin.

## AI-generated background clips (e.g. Dreamina)

The plugin does not call any AI service. Generate a clip anywhere, then import it under *Background → Video*.

1. **Generate**: dark, low-contrast, slow motion, no text/people/flashing, 16:9 (or 9:16 for phones), 4–8 s, 720p is plenty. Example prompt used for `assets/aurora-loop.mp4` (Dreamina Seedance 2.0 Fast, text-to-video, 720p, 5 s, 40 credits):
   *"Slow, calm abstract aurora of soft violet and teal light drifting across a dark night sky, a few faint stars and fine glowing dust, extremely gentle motion, cinematic, dark low-contrast background suitable for overlaying text, no text, no people, no logos, no flashing"*
2. **Make it loop**: `tools/make-loop.sh in.mp4 out.mp4 1` cross-fades the last second into the start, strips audio and re-encodes to a small H.264 file (needs `ffmpeg`). On a non-looping test clip the first/last-frame difference went from 5 dB to 65 dB PSNR (higher = smoother seam); on the Dreamina clip the seam measured 39.8 dB.
3. **Import** the result with *Choose video*. Check the generator's terms before commercial use or redistribution.

## Languages

English, 한국어, 日本語, 简体中文, 繁體中文, Español, Français, Deutsch, Português (BR), Русский.
Follows Obsidian's language setting; unknown languages fall back to English.
Add one: create `src/i18n/<code>.ts` typed as `Strings` (the compiler rejects missing keys) and register it in `src/i18n/index.ts`.
Machine-assisted translations: please have a native speaker review before company-wide rollout.

## Install (manual)

```
npm ci && npm run build
mkdir -p "<vault>/.obsidian/plugins/vault-lock"
cp main.js manifest.json styles.css "<vault>/.obsidian/plugins/vault-lock/"
```
Then enable **Vault Lock** under Settings → Community plugins, and set a password in its settings.
On mobile, copy the same three files into the vault's `.obsidian/plugins/vault-lock/` (e.g. via sync).

## Layout notes

Overlay is `position: fixed` with a scrollable flex container and `margin: auto` card (centres when it fits, scrolls instead of
clipping when short). Uses Obsidian theme variables, `env(safe-area-inset-*)`, 16px inputs (no iOS zoom), 44px tap targets, and
tracks `visualViewport` so the card stays above the mobile keyboard.
