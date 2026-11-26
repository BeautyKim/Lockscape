# Development

```sh
npm ci
npm run build      # type-check, then bundle main.js (unminified, readable)
npm test           # unit tests: hashing, recovery key, i18n, games, activity log
npm run harness    # build the browser harness (see below)
```

Install a local build into a test vault:

```sh
P=<test vault>/.obsidian/plugins/lockscape
mkdir -p "$P" && cp main.js manifest.json styles.css "$P"/
```

Reload the plugin (off and on) after every change; CSS too.

## Source map

| File | Role |
|---|---|
| `src/main.ts` | Plugin class: settings model and validation, lock conditions, back-off, settings tab, password and recovery-key dialogs |
| `src/lockscreen.ts` | The overlay (one per window), lock/cover/preview states, clock, to-dos, backgrounds, animations |
| `src/crypto.ts` | PBKDF2 hashing, constant-time compare, recovery key |
| `src/themes.ts` | Theme list, game ids, high-score parsing |
| `src/games/*` | The three offline canvas games and their host |
| `src/windowSize.ts` | Desktop window shrink and restore, OS lock listener (the only file that touches Electron) |
| `src/activitylog.ts`, `src/devicesettings.ts`, `src/text.ts` | Activity log, per-device settings, code-point string helpers |
| `src/i18n/*` | Ten languages; `en.ts` is the reference shape and the compiler rejects missing keys |
| `tools/` | Unit tests, browser harness, CDP helper, QA runner |

## Tests

1. **Unit tests** (`npm test`) cover everything without a DOM, plus the game host against a fake DOM.
2. **Browser harness** (`tools/harness`): the real overlay code in a plain browser, with only Obsidian's `setIcon` stubbed. Good for layouts at any size:

   ```sh
   npm run harness
   (cd tools/harness && python3 -m http.server 8765)
   # open http://127.0.0.1:8765/index.html?lang=en&vl=terminal&state=locked
   ```

   Query parameters: `lang`, `vl` (theme id), `hs`, `anim`, `image`, `video`, `todos`, `reveal`, `recovery`, `state`.
3. **Real Obsidian**: start a second Obsidian instance with its own `--user-data-dir` and `--remote-debugging-port`, then drive it with `tools/cdp.mjs` (`eval`, `shot`, `key`, `press`, `move`). The harness lacks Obsidian's own CSS, so button and input styling must be checked here.

## Adding a language

Create `src/i18n/<code>.ts` typed as `Strings` and register it in `src/i18n/index.ts`.

## Layout notes

The overlay is `position: fixed` with a scrollable flex container and a `margin: auto` card (centred when it fits, scrolls instead of clipping when short). It uses Obsidian theme variables, 16px inputs and 44px minimum heights for the password field and button.

## Releasing

Update `version` in `manifest.json` and `package.json` (and add the minimum app version to `versions.json`), commit, then push a tag that equals the version, e.g. `git tag 0.1.1 && git push origin 0.1.1`. The workflow in `.github/workflows/release.yml` builds, tests, attests the build provenance of the three files and creates the GitHub release with `main.js`, `manifest.json` and `styles.css`.

Before releasing, run the community directory's lint rules (`eslint-plugin-obsidianmd`, recommended config) on `src/`. Two `prefer-active-doc` warnings are expected: those lines mean the main window's document.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`).
