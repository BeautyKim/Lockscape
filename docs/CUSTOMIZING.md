# Customising and background clips

## CSS snippets (stable hooks)

Anything the settings do not cover can be changed from an Obsidian CSS snippet (Settings → Appearance → CSS snippets) without touching the plugin. These class names and variables are the public surface (the class names keep the `vault-lock-` prefix from the plugin's earlier name):

| Hook | Meaning |
|---|---|
| `.vault-lock-overlay` | root; attribute `data-theme="default"` · `win95` · `terminal` · `gameboy-snake` · `neon-breakout` · `obsidian-runner`; modifier classes: `is-game`, `has-image`, `has-video`, `hover-reveal`, `is-preview`, `is-cover`, `is-error`, `pos-top`, `pos-bottom`, `shape-round/pill/square`, `no-icon`, `custom-title` |
| `.vault-lock-game` · `.vault-lock-game-canvas` | the game theme's canvas and its frame (hidden in the other themes); `--vl-game-reserve` is the height the rest of the screen needs, the canvas shrinks to fit a short window |
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

## Background clips from an AI video tool

The plugin does not call any AI service. Generate a clip anywhere, then import it under *Background → Video*.

1. **Generate**: dark, low-contrast, slow motion, no text/people/flashing, 16:9 (or 9:16 for phones), 4–8 s, 720p is plenty. Example prompt used for `assets/aurora-loop.mp4` (Dreamina Seedance 2.0 Fast, text-to-video, 720p, 5 s, 40 credits):
   *"Slow, calm abstract aurora of soft violet and teal light drifting across a dark night sky, a few faint stars and fine glowing dust, extremely gentle motion, cinematic, dark low-contrast background suitable for overlaying text, no text, no people, no logos, no flashing"*
2. **Make it loop**: `tools/make-loop.sh in.mp4 out.mp4 1` cross-fades the last second into the start, strips audio and re-encodes to a small H.264 file (needs `ffmpeg`). On a non-looping test clip the first/last-frame difference went from 5 dB to 65 dB PSNR (higher = smoother seam); on the Dreamina clip the seam measured 39.8 dB.
3. **Import** the result with *Choose video*. Check the generator's terms before commercial use or redistribution.
