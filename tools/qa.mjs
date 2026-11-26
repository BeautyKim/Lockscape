// QA of lock-screen customisation combinations, run against a REAL Obsidian (second instance, see the dev guide).
//
//   node tools/qa.mjs <cdp-port> --assets <dir> --out <dir> [--seeds 2] [--flow-every 3] [--only theme=win95]
//
// What it does: builds a pairwise set of settings combinations (every pair of values of any two variables appears in at
// least one run; viewport size, Obsidian light/dark and reduced motion are variables too), applies each one IN MEMORY
// (saveData is stubbed, nothing is written to disk), locks, measures invariants in the page, optionally runs the wrong /
// right password flow, releases and checks that nothing is left behind. Failing runs get a screenshot.
//
// --assets: a folder with qa-bright.jpg qa-dark.jpg qa-busy.jpg qa-tall.jpg qa-tiny.jpg qa-aurora.mp4 qa-bright.mp4,
//           copied into the plugin folder for the run and removed at the end.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const port = args[0];
const opt = (name, def) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : def; };
const assetsDir = opt("assets");
const outDir = opt("out", "qa-out");
const seeds = +opt("seeds", 2);
const flowEvery = +opt("flow-every", 3);
const only = opt("only"); // e.g. theme=win95
const realMode = args.includes("--real"); // shrink the REAL window with the plugin's own "shrink while locked" feature (no viewport emulation)
const langsMode = args.includes("--langs"); // every language x theme x a few viewports, with the longest real messages
fs.mkdirSync(outDir, { recursive: true });

// ---- CDP ------------------------------------------------------------------------------------
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === "page" && t.url.startsWith("app://obsidian.md") && !t.title.includes("설정") && !t.title.includes("Settings"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++nextId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? "eval failed");
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(r.result.data, "base64")); };

// ---- the in-page side ---------------------------------------------------------------------------
const PAGE = String.raw`(() => {
  // A previous run left its code in the page: take it out first, or an edited check would never run (it happened).
  if (window.__qa && window.__qa.uninstall) window.__qa.uninstall();
  const errors = [];
  const onErr = (e) => errors.push("error: " + (e.message || e)); const onRej = (e) => errors.push("rejection: " + ((e.reason && e.reason.message) || e.reason));
  window.addEventListener("error", onErr); window.addEventListener("unhandledrejection", onRej);
  const ce = console.error; console.error = (...a) => { errors.push("console.error: " + a.map(String).join(" ").slice(0, 160)); ce.apply(console, a); };
  const raf = new Set(); const r0 = window.requestAnimationFrame.bind(window), c0 = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { let id; id = r0((t) => { raf.delete(id); cb(t); }); raf.add(id); return id; };
  window.cancelAnimationFrame = (id) => { raf.delete(id); c0(id); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const P = () => app.plugins.plugins["lockscape"];
  const orig = JSON.parse(JSON.stringify(P().settings));
  const origBody = [...document.body.classList].filter((c) => c === "theme-light" || c === "theme-dark");
  P().saveData = async () => {};            // nothing reaches the disk during QA
  const BASE = { theme: "default", backgroundKind: "none", dim: 35, blur: 0, animation: "none", showClock: true, showSeconds: false, showDate: true,
    clockFormat: "auto", showTodos: false, todos: [], hoverReveal: false, titleMode: "auto", customTitle: "", showIcon: true, position: "center",
    fieldShape: "auto", clockScale: 100, clockFont: "auto", clockWeight: 300, textColor: "", accentColor: "", shrinkOnLock: false };
  const qa = { errors, raf, baselineRaf: 0, imageFile: null, videoFile: null, orig, origBody };

  // ---- colour helpers
  const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ""); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const over = (f, b) => { const a = f[3]; return [f[0] * a + b[0] * (1 - a), f[1] * a + b[1] * (1 - a), f[2] * a + b[2] * (1 - a), 1]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const effBg = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { chain.push(c); if (c[3] >= 0.999) break; } }
    if (!chain.length || chain[chain.length - 1][3] < 0.999) return null; let base = chain[chain.length - 1]; for (let i = chain.length - 2; i >= 0; i--) base = over(chain[i], base); return base; };
  const effOpacity = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };

  qa.apply = async (cfg) => {
    const p = P(), S = p.settings;
    Object.assign(S, JSON.parse(JSON.stringify(BASE)), JSON.parse(JSON.stringify(cfg.settings || {})));
    S.hasBackground = false; S.hasVideo = false;
    qa.imageFile = null; qa.videoFile = null;
    if (cfg.media && cfg.media.kind === "image") { S.backgroundKind = "image"; S.hasBackground = true; qa.imageFile = cfg.media.file; }
    if (cfg.media && cfg.media.kind === "video") { S.backgroundKind = "video"; S.hasVideo = true; qa.videoFile = cfg.media.file; }
    const url = (f) => app.vault.adapter.getResourcePath(p.pluginDir + "/" + f);
    Object.defineProperty(p, "imageUrl", { configurable: true, get() { return qa.imageFile ? url(qa.imageFile) : null; } });
    Object.defineProperty(p, "videoUrl", { configurable: true, get() { return qa.videoFile ? url(qa.videoFile) : null; } });
    document.body.classList.remove("theme-light", "theme-dark"); document.body.classList.add("theme-" + (cfg.obsidian || "light"));
  };

  qa.measure = async (cfg) => {
    const issues = []; const info = {};
    const add = (code, detail) => issues.push({ code, detail: detail === undefined ? "" : String(detail) });
    const o = document.querySelector(".vault-lock-overlay");
    if (!o) { add("no-overlay"); return { issues, info }; }
    const W = innerWidth, H = innerHeight, S = P().settings;
    const q = (s) => o.querySelector(s);
    const R = (e) => e.getBoundingClientRect();
    const shown = (e) => { if (!e) return false; const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden") return false; const r = R(e); return r.width > 0 && r.height > 0; };
    const stage = q(".vault-lock-stage"), input = q(".vault-lock-input"), button = q(".vault-lock-button"), title = q(".vault-lock-title"), time = q(".vault-lock-time"),
      date = q(".vault-lock-date"), icon = q(".vault-lock-icon"), clock = q(".vault-lock-clock"), todos = q(".vault-lock-todos"), card = q(".vault-lock-card"),
      game = q(".vault-lock-game"), message = q(".vault-lock-message"), desktop = q(".vault-lock-desktop");
    const theme = o.dataset.theme, isGame = o.classList.contains("is-game");
    info.theme = theme; info.vp = W + "x" + H;

    // media must actually load (a photo within 2.5 s, a video within 3 s)
    if (cfg.media) {
      const want = cfg.media.kind === "image" ? "has-image" : "has-video"; const t0 = performance.now();
      while (!o.classList.contains(want) && performance.now() - t0 < 3000) await sleep(100);
      if (!o.classList.contains(want)) add("media-not-loaded", cfg.media.file);
      else if (cfg.media.kind === "video") {
        const v = o.querySelector("video.vault-lock-video"); await sleep(250);
        if (!v) add("video-element-missing");
        else if (cfg.reduced) { if (!v.paused) add("video-plays-under-reduced-motion"); }
        else if (v.paused) add("video-not-playing");
      }
      const dimVar = parseFloat(getComputedStyle(o).getPropertyValue("--vl-dim"));
      info.dim = dimVar; if (dimVar < S.dim / 100 - 0.001) add("dim-below-user-setting", dimVar + " < " + S.dim / 100);
    } else if (o.classList.contains("has-image") || o.classList.contains("has-video")) add("media-class-without-media");

    // ---- layout
    if (stage.scrollHeight > stage.clientHeight + 1 && getComputedStyle(stage).overflow !== "visible") add("stage-content-clipped", stage.scrollHeight + ">" + stage.clientHeight);
    if (o.scrollWidth > o.clientWidth + 1) add("horizontal-overflow", o.scrollWidth + ">" + o.clientWidth);
    const must = { input, button };
    for (const k in must) {
      const e = must[k]; if (!shown(e)) { add("control-hidden", k); continue; }
      const r = R(e);
      if (r.right < 0 || r.left > W) add("control-offscreen-x", k);
      else if (r.left < -1 || r.right > W + 1) add("control-cut-x", k + " " + Math.round(r.left) + ".." + Math.round(r.right));
      if (r.bottom > H + 1 || r.top < -1) add("controls-below-fold", k + " bottom=" + Math.round(r.bottom) + " H=" + H); // reachable by scrolling, but the field is not on the first screen
      const cx = Math.min(Math.max(r.left + r.width / 2, 1), W - 1), cy = Math.min(Math.max(r.top + r.height / 2, 1), H - 1);
      if (r.bottom <= H && r.top >= 0) { const hit = document.elementFromPoint(cx, cy); if (hit && !e.contains(hit) && !(hit === e)) add("control-obstructed", k + " by " + (hit.className || hit.tagName)); }
    }
    const texts = { time, date, title, button, message, hint: q(".vault-lock-hint") };
    for (const k in texts) { const e = texts[k]; if (!shown(e)) continue; const r = R(e); if (r.left < -1 || r.right > W + 1) add("text-offscreen-x", k + " " + Math.round(r.left) + ".." + Math.round(r.right));
      if (r.width > 2 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== "visible") add("text-clipped", k + " " + e.scrollWidth + ">" + e.clientWidth + " rect=" + Math.round(r.width) + "x" + Math.round(r.height) + " ov=" + getComputedStyle(e).overflow + " pos=" + getComputedStyle(e).position + " disp=" + getComputedStyle(e).display); }
    if (shown(stage)) { const sr = R(stage); for (const k of ["time", "title", "button", "date"]) { const e = texts[k]; if (!shown(e)) continue; const r = R(e); if (r.right > sr.right + 1 || r.left < sr.left - 1) add("text-outside-window", k); } }
    const inter = (a, b) => { const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return x > 2 && y > 2 ? Math.round(x * y) : 0; };
    const pairs = [["clock", clock, "card", card], ["game", game, "card", card], ["todos", todos, "card", card], ["todos", todos, "clock", clock], ["game", game, "clock", clock], ["desktop", desktop, "stage", stage]];
    for (const [an, a, bn, b] of pairs) if (shown(a) && shown(b)) { const n = inter(R(a), R(b)); if (n) add("overlap", an + "/" + bn + " " + n + "px2"); }
    if (shown(todos)) { const r = R(todos); if (r.left < -1 || r.right > W + 1) add("todos-offscreen-x"); }

    // ---- native traffic lights: macOS draws three buttons over the top-left of a frameless window (Obsidian reserves 80 x 30 px).
    // Nothing the plugin shows may sit under them. Pseudo-elements (the Windows 95 title icon) are measured from their own box.
    if (document.body.classList.contains("mod-macos") && document.body.classList.contains("is-frameless")) {
      const tb = parseFloat(getComputedStyle(document.body).getPropertyValue("--titlebar-height")) || 30; const zone = { l: 0, t: 0, r: 80, b: tb }; // Obsidian reserves 80px on the left for them (--frame-left-space on .mod-macos)
      const hits = (r) => r.left < zone.r && r.right > zone.l && r.top < zone.b && r.bottom > zone.t;
      const painted = [...stage.querySelectorAll("*")].filter((e) => { if (!shown(e)) return false; const cs = getComputedStyle(e); if (parseFloat(cs.opacity) < 0.05) return false; const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); return own || e.tagName === "svg" || e.tagName === "canvas" || e.tagName === "INPUT" || e.tagName === "BUTTON"; });
      const boxes = (e) => { if (e.tagName === "svg" || e.tagName === "canvas" || e.tagName === "INPUT" || e.tagName === "BUTTON") return [R(e)]; const rg = document.createRange(); rg.selectNodeContents(e); return [...rg.getClientRects()]; }; // the text itself, not the element's padded box
      for (const e of painted) if (boxes(e).some(hits)) add("traffic-light-overlap", (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className) || e.tagName);
      const ct = q(".vl-chrome-title"); if (ct && shown(ct)) { const ps = getComputedStyle(ct, "::before"); if (ps.content !== "none" && ps.content !== "normal") { const cr = R(ct); const box = { left: cr.left + parseFloat(ps.left), right: cr.left + parseFloat(ps.left) + parseFloat(ps.width), top: cr.top + (parseFloat(ps.top) || 0), bottom: cr.top + (parseFloat(ps.top) || 0) + parseFloat(ps.height) }; if (hits(box)) add("traffic-light-overlap", "title icon (::before)"); } }
      info.frameless = tb;
    }

    // ---- touch targets and iOS zoom
    if (shown(input)) { const cs = getComputedStyle(input), h = R(input).height; if (parseFloat(cs.fontSize) < 16) add("input-font-under-16", cs.fontSize); if (h < 44 && theme !== "terminal") add("input-height-under-44", Math.round(h)); }
    if (shown(button) && R(button).height < 44) add("button-height-under-44", Math.round(R(button).height));

    // ---- contrast (only where the colour behind the text is a plain colour)
    const textEls = { time: shown(time) ? time : null, date: shown(date) ? date : null, title: shown(title) ? title : null, button: shown(button) ? button : null, input: shown(input) ? input : null, message: shown(message) && message.textContent ? message : null };
    for (const k in textEls) { const e = textEls[k]; if (!e) continue; const op = effOpacity(e); if (op < 0.05) continue; const fgc = parse(getComputedStyle(e).color); const bg = effBg(e); if (!fgc || !bg) { info["contrast-unknown:" + k] = 1; continue; }
      const fg = over([fgc[0], fgc[1], fgc[2], fgc[3] * (k === "input" ? 1 : op)], bg); const r = ratio(fg, bg); const fs = parseFloat(getComputedStyle(e).fontSize), bold = parseInt(getComputedStyle(e).fontWeight) >= 700; const need = fs >= 24 || (fs >= 18.66 && bold) ? 3 : 4.5;
      if (r < need) add(S.textColor && k !== "button" && k !== "input" ? "contrast-with-user-text-color" : "contrast", k + " " + r.toFixed(2) + ":1 (<" + need + ") " + Math.round(fs) + "px"); }
    if (shown(input)) { const pc = parse(getComputedStyle(input, "::placeholder").color), bg = effBg(input); if (pc && bg && input.placeholder.trim() && effOpacity(input) > 0.5) { const r = ratio(over(pc, bg), bg); if (pc[3] > 0.05 && r < 4.5) add("contrast", "placeholder " + r.toFixed(2) + ":1"); } }

    // ---- focus and hidden field
    const ae = document.activeElement;
    const wantRoot = isGame || S.hoverReveal; const okFocus = wantRoot ? ae === o : ae === input;
    if (!okFocus) add("focus", "active=" + (ae && (ae.className || ae.tagName)) + " expected=" + (wantRoot ? "overlay" : "input"));
    if (S.hoverReveal && !isGame) { const op = getComputedStyle(input).opacity; if (parseFloat(op) > 0.01 && ae !== input) add("hover-reveal-field-visible", op); input.focus(); await sleep(350); if (parseFloat(getComputedStyle(input).opacity) < 0.99) add("hover-reveal-not-revealed-on-focus"); }
    if (isGame && parseFloat(getComputedStyle(input).opacity) < 0.99) add("game-theme-field-hidden");

    // ---- clock
    if (!S.showClock) { if (shown(clock)) add("clock-visible-when-off"); }
    else if (shown(time)) {
      const label0 = time.getAttribute("aria-label"); const txt = (theme === "win95" && label0 ? label0 : time.textContent).trim(); info.time = txt; const letters = /[A-Za-zᄀ-ᇿ㄰-㆏가-힯぀-ヿ一-鿿]/.test(txt);
      if (S.clockFormat === "24" && letters) add("clock-24h-has-day-period", txt); if (S.clockFormat === "12" && !letters && !/[ap]\.?m/i.test(txt)) add("clock-12h-missing-day-period", txt);
      const groups = (txt.match(/\d+/g) || []).length; if (S.showSeconds && groups < 3) add("clock-seconds-missing", txt); if (!S.showSeconds && groups > 2) add("clock-seconds-unexpected", txt);
      if (theme === "win95" && (!label0 || !/\d/.test(label0) || time.getAttribute("role") !== "img" || time.querySelectorAll("svg").length === 0)) add("win95-clock-aria-label", "label=" + label0 + " role=" + time.getAttribute("role") + " svgs=" + time.querySelectorAll("svg").length + " cls=" + time.className);
      if (theme !== "win95" && time.hasAttribute("aria-label")) add("stale-aria-label");
    } else if (S.showClock && clock && !shown(clock)) { if (theme !== "gameboy-snake" && theme !== "obsidian-runner") add("clock-hidden-but-on", theme); }
    if (S.showClock && S.showDate === false && shown(date)) add("date-visible-when-off");

    // ---- title, icon, text safety
    if (S.customTitle) { if (title.textContent !== S.customTitle) add("custom-title-text", JSON.stringify(title.textContent).slice(0, 60)); if (title.children.length) add("custom-title-parsed-as-html"); }
    if (S.titleMode === "hide" && !S.customTitle && shown(title) && o.classList.contains("title-hide") === false) add("title-hide-class-missing");
    if (!S.showIcon && shown(icon)) add("icon-visible-when-off");
    if (S.showTodos && S.todos.length && !shown(todos)) add("todos-hidden-when-on");
    if (!S.showTodos && shown(todos)) add("todos-visible-when-off");

    // ---- position
    if (shown(stage)) { const sr = R(stage); const mid = (sr.top + sr.bottom) / 2; if (sr.height < H * 0.7) { if (S.position === "top" && mid > H * 0.45) add("position-top-not-top", Math.round(mid) + "/" + H); if (S.position === "bottom" && mid < H * 0.55) add("position-bottom-not-bottom", Math.round(mid) + "/" + H); } }

    // ---- theme specifics
    if (theme === "win95" && desktop) { const want = W >= 700 && H >= 480; if (want !== shown(desktop)) add("desktop-icons-visibility", "W=" + W + " H=" + H + " shown=" + shown(desktop)); }
    if (isGame) { const cv = q("canvas.vault-lock-game-canvas"); if (!cv) { if (H > 480) add("game-canvas-missing"); } else if (shown(cv)) { const r = R(cv), cs = parseFloat(cv.style.getPropertyValue("--vl-game-r")); if (Math.abs(r.width / r.height - cs) > 0.02) add("game-canvas-distorted", (r.width / r.height).toFixed(3) + " vs " + cs.toFixed(3)); if (shown(stage)) { const sr = R(stage); if (r.right > sr.right + 1 || r.left < sr.left - 1) add("game-canvas-outside-window"); } }
      else if (H > 480) add("game-hidden-though-tall", "H=" + H); }

    // ---- animation layer
    const an = q(".vault-lock-anim"); const kind = S.animation; const kids = an ? an.children.length : -1; info.anim = kind + ":" + kids;
    if (kind === "none") { if (kids !== 0) add("animation-children-when-none", kids); }
    else if (["aurora", "fireflies", "snow"].includes(kind)) { if (kids === 0) add("animation-empty", kind); if (cfg.reduced) { if (kind !== "aurora") { if (getComputedStyle(an).display !== "none") add("reduced-motion-animation-visible", kind); } else { const b = an.querySelector("b"); if (b && getComputedStyle(b).animationName !== "none") add("reduced-motion-aurora-moving"); } } }
    else { const cv = an.querySelector("canvas"); if (cfg.reduced) { if (cv) add("reduced-motion-pointer-effect-present", kind); } else if (!cv) add("pointer-effect-canvas-missing", kind); else if (Math.abs(cv.clientWidth - W) > 2 || Math.abs(cv.clientHeight - H) > 2) add("pointer-effect-canvas-size", cv.clientWidth + "x" + cv.clientHeight + " vs " + W + "x" + H); }

    // ---- options that should win over the theme (reported, not failed: some themes keep a fixed palette on purpose)
    if (S.textColor) { const want = parse(getComputedStyle(document.createElement("div")).color); void want; const probe = document.createElement("div"); probe.style.color = S.textColor; document.body.append(probe); const wc = getComputedStyle(probe).color; probe.remove();
      for (const k of ["time", "date", "title"]) { const e = textEls[k]; if (e && getComputedStyle(e).color !== wc && !(k === "time" && theme === "win95")) info["textcolor-ignored:" + k] = getComputedStyle(e).color; } }
    if (S.fieldShape !== "auto" && shown(input)) { const br = parseFloat(getComputedStyle(input).borderTopLeftRadius); const ok = S.fieldShape === "square" ? br === 0 : S.fieldShape === "pill" ? br >= 20 : br > 0 && br <= 12; if (!ok) info["shape-ignored"] = S.fieldShape + " -> " + br + "px"; }
    if (S.clockFont !== "auto" && shown(time)) { const ff = getComputedStyle(time).fontFamily; const k = { serif: /Georgia|New York|serif/, mono: /monospace|Menlo|Mono/, rounded: /rounded|Nunito|Quicksand/, sans: /./ }[S.clockFont]; if (!k.test(ff)) info["font-ignored"] = S.clockFont + " -> " + ff.slice(0, 40); }
    if (S.accentColor && shown(button)) { const probe = document.createElement("div"); probe.style.color = S.accentColor; document.body.append(probe); const ac = getComputedStyle(probe).color; probe.remove(); const bs = getComputedStyle(button); if (![bs.backgroundColor, bs.borderTopColor, bs.color].includes(ac)) info["accent-not-on-button"] = 1; }
    return { issues, info };
  };

  qa.flow = async () => {
    const out = []; const P0 = P(), ls = P0.lockScreen, o = document.querySelector(".vault-lock-overlay"); if (!o) return ["flow:no-overlay"];
    const input = o.querySelector(".vault-lock-input"), form = o.querySelector(".vault-lock-form"); const orig = ls.hooks.submit;
    try {
      ls.hooks.submit = async () => ({ ok: false, message: "qa wrong" }); input.disabled = false; input.value = "abc"; form.requestSubmit(); await sleep(140);
      if (input.value !== "") out.push("flow:wrong-input-not-cleared"); if (!o.classList.contains("is-error")) out.push("flow:wrong-no-shake"); if (!o.querySelector(".vault-lock-message").textContent) out.push("flow:wrong-no-message");
      await sleep(450); if (o.classList.contains("is-error")) out.push("flow:shake-stuck"); if (input.disabled) out.push("flow:input-disabled-after-wrong");
      ls.hooks.submit = async () => ({ ok: true }); input.value = "x"; form.requestSubmit(); let seen = false; for (let k = 0; k < 20 && !seen; k++) { await sleep(50); if (!document.querySelector(".vault-lock-overlay") || o.classList.contains("is-unlocking")) seen = true; }
      if (!seen) out.push("flow:no-unlocking-state");
      for (let k = 0; k < 20 && document.querySelector(".vault-lock-overlay"); k++) await sleep(50); if (document.querySelector(".vault-lock-overlay")) out.push("flow:overlay-still-present");
    } finally { ls.hooks.submit = orig; }
    return out;
  };

  qa.leaks = async () => {
    const out = []; await sleep(250);
    if (document.querySelector(".vault-lock-overlay")) out.push("leak:overlay-present");
    if (document.querySelectorAll("canvas.vault-lock-game-canvas").length) out.push("leak:game-canvas");
    if (document.querySelectorAll("video.vault-lock-video").length) out.push("leak:video-element");
    if (document.querySelectorAll(".vault-lock-anim, .vault-lock-fx").length) out.push("leak:animation-layer");
    if ([...document.body.children].some((c) => c.inert)) out.push("leak:inert-left-on-body");
    if (raf.size > qa.baselineRaf) out.push("leak:animation-frames " + raf.size + ">" + qa.baselineRaf);
    return out;
  };

  qa.repatch = () => { P().saveData = async () => {}; };
  // the longest translated messages the lock screen can show, put on screen as the real ones would be
  qa.stressMessage = () => { const t = P().t; const msgs = [t.wrong, t.cryptoError, t.wait.replace("{n}", "59"), t.previewClose, t.tooShort ? t.tooShort.replace("{n}", "8") : ""].filter(Boolean); const longest = msgs.sort((a, b) => b.length - a.length)[0];
    const o = document.querySelector(".vault-lock-overlay"); const v = P().lockScreen.views.get(document); v.setMessage(longest); return { longest: longest.length, button: t.unlock, title: t.lockedTitle, placeholder: t.placeholder }; };
  qa.restore = () => { const p = P(); Object.assign(p.settings, qa.orig); delete p.imageUrl; delete p.videoUrl; document.body.classList.remove("theme-light", "theme-dark"); qa.origBody.forEach((c) => document.body.classList.add(c)); };
  qa.uninstall = () => { window.requestAnimationFrame = r0; window.cancelAnimationFrame = c0; console.error = ce; window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); delete window.__qa; };
  window.__qa = qa; return "installed";
})()`;

// ---- combinations ---------------------------------------------------------------------------------
const V = (label, patch) => ({ label, patch });
const S = (o) => ({ settings: o });
const longTitle = "Vault is locked right now - please enter the password to continue working";
const todo = (n, long) => Array.from({ length: n }, (_, i) => ({ id: "q" + i, text: long ? "A very long to-do item number " + (i + 1) + " that keeps going and going to test wrapping inside the panel" : "Item " + (i + 1), done: i % 3 === 1 }));
const dims = [
  { name: "theme", values: ["default", "win95", "terminal", "gameboy-snake", "neon-breakout", "obsidian-runner"].map((t) => V(t, S({ theme: t }))) },
  { name: "bg", values: [V("none", {}), V("photoBright", { media: { kind: "image", file: "qa-bright.jpg" } }), V("photoDark", { media: { kind: "image", file: "qa-dark.jpg" } }), V("photoBusy", { media: { kind: "image", file: "qa-busy.jpg" } }),
      V("photoTall", { media: { kind: "image", file: "qa-tall.jpg" } }), V("photoTiny", { media: { kind: "image", file: "qa-tiny.jpg" } }), V("videoAurora", { media: { kind: "video", file: "qa-aurora.mp4" } }), V("videoBright", { media: { kind: "video", file: "qa-bright.mp4" } })] },
  { name: "dimblur", values: [V("d35b0", S({ dim: 35, blur: 0 })), V("d0b0", S({ dim: 0, blur: 0 })), V("d80b20", S({ dim: 80, blur: 20 })), V("d0b20", S({ dim: 0, blur: 20 }))] },
  { name: "anim", values: ["none", "aurora", "fireflies", "snow", "glow", "trail", "orbs"].map((a) => V(a, S({ animation: a }))) },
  { name: "clock", values: [V("default", {}), V("off", S({ showClock: false })), V("24h-sec-nodate-60", S({ clockFormat: "24", showSeconds: true, showDate: false, clockScale: 60 })), V("12h-sec-160", S({ clockFormat: "12", showSeconds: true, clockScale: 160 })),
      V("serif-100", S({ clockFont: "serif", clockWeight: 100 })), V("mono-700-130", S({ clockFont: "mono", clockWeight: 700, clockScale: 130 })), V("rounded", S({ clockFont: "rounded", clockWeight: 400 }))] },
  { name: "todos", values: [V("none", {}), V("3", S({ showTodos: true, todos: todo(3) })), V("10long", S({ showTodos: true, todos: todo(10, true) }))] },
  { name: "reveal", values: [V("off", {}), V("on", S({ hoverReveal: true }))] },
  { name: "title", values: [V("auto", {}), V("show", S({ titleMode: "show" })), V("hide", S({ titleMode: "hide" })), V("custom", S({ customTitle: "Vault is locked" })), V("customLong", S({ customTitle: longTitle })), V("customEmoji", S({ customTitle: "\u{1F600}".repeat(20) })), V("customHtml", S({ customTitle: "<img src=x onerror=window.__xss=1><b>bold</b>" }))] },
  { name: "icon", values: [V("on", {}), V("off", S({ showIcon: false }))] },
  { name: "position", values: ["center", "top", "bottom"].map((p) => V(p, S({ position: p }))) },
  { name: "shape", values: ["auto", "rounded", "pill", "square"].map((p) => V(p, S({ fieldShape: p }))) },
  { name: "text", values: [V("auto", {}), V("red", S({ textColor: "#ff0000" })), V("white", S({ textColor: "#ffffff" })), V("black", S({ textColor: "#000000" }))] },
  { name: "accent", values: [V("auto", {}), V("green", S({ accentColor: "#00ff66" }))] },
  { name: "obsidian", values: [V("light", { obsidian: "light" }), V("dark", { obsidian: "dark" })] },
  { name: "motion", values: [V("normal", {}), V("reduced", { reduced: true })] },
  { name: "viewport", values: [[0, 0], [1920, 1080], [700, 480], [560, 720], [460, 620], [380, 520], [390, 760], [360, 640], [320, 568], [844, 390], [568, 320]].map(([w, h]) => V(w ? w + "x" + h : "window", { viewport: w ? { w, h } : null })) },
];

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function pairwise(dimsIn, seed) {
  const rnd = mulberry32(seed); const n = dimsIn.length; const key = (i, a, j, b) => i + ":" + a + "|" + j + ":" + b; const uncovered = new Set();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let a = 0; a < dimsIn[i].values.length; a++) for (let b = 0; b < dimsIn[j].values.length; b++) uncovered.add(key(i, a, j, b));
  const rows = [];
  while (uncovered.size) {
    const arr = [...uncovered]; const seedKey = arr[Math.floor(rnd() * arr.length)]; const m = /(\d+):(\d+)\|(\d+):(\d+)/.exec(seedKey); const row = new Array(n).fill(-1); row[+m[1]] = +m[2]; row[+m[3]] = +m[4];
    const order = [...Array(n).keys()].filter((i) => row[i] < 0).sort(() => rnd() - 0.5);
    for (const i of order) { let best = -1, bestScore = -1; const cand = [...Array(dimsIn[i].values.length).keys()].sort(() => rnd() - 0.5);
      for (const a of cand) { let sc = 0; for (let j = 0; j < n; j++) if (row[j] >= 0) sc += uncovered.has(j < i ? key(j, row[j], i, a) : key(i, a, j, row[j])) ? 1 : 0; if (sc > bestScore) { bestScore = sc; best = a; } } row[i] = best; }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) uncovered.delete(key(i, row[i], j, row[j]));
    rows.push(row);
  }
  return rows;
}
const build = (row, dimsIn) => { const cfg = { settings: {}, media: null, obsidian: "light", reduced: false, viewport: null, labels: {} }; row.forEach((v, i) => { const val = dimsIn[i].values[v]; cfg.labels[dimsIn[i].name] = val.label; const p = val.patch; if (p.settings) Object.assign(cfg.settings, p.settings); if ("media" in p) cfg.media = p.media; if (p.obsidian) cfg.obsidian = p.obsidian; if ("reduced" in p) cfg.reduced = p.reduced; if ("viewport" in p) cfg.viewport = p.viewport; }); return cfg; };

let configs = [];
for (let s = 0; s < seeds; s++) pairwise(dims, 1000 + s).forEach((row) => configs.push(build(row, dims)));
// single-factor sweeps: every theme at every viewport with plain settings, in both Obsidian modes
const themeDim = dims[0], vpDim = dims[dims.length - 1];
themeDim.values.forEach((t, ti) => vpDim.values.forEach((v, vi) => ["light", "dark"].forEach((mode) => { const cfg = build(dims.map((d, i) => (i === 0 ? ti : i === dims.length - 1 ? vi : d.name === "obsidian" ? (mode === "dark" ? 1 : 0) : 0)), dims); cfg.sweep = true; configs.push(cfg); })));
if (only) { const [k, v] = only.split("="); configs = configs.filter((c) => c.labels[k] === v); }
const REAL_SIZES = { small: [380, 520], medium: [460, 620], large: [560, 720] };
if (realMode) {
  configs = [];
  for (const t of themeDim.values) for (const size of Object.keys(REAL_SIZES)) for (const bg of [0, 3]) {
    const bgv = dims[1].values[bg];
    configs.push({ settings: { ...t.patch.settings, shrinkOnLock: true, lockWindowSize: size }, media: bgv.patch.media ?? null, obsidian: "light", reduced: false, viewport: null, real: size, labels: { theme: t.label, bg: bgv.label, viewport: "real " + REAL_SIZES[size].join("x") } });
  }
}
if (langsMode) {
  configs = [];
  for (const lang of ["en", "ko", "ja", "zh-CN", "zh-TW", "es", "fr", "de", "pt-BR", "ru"]) for (const t of themeDim.values) for (const vp of [[0, 0], [380, 520], [320, 568]])
    configs.push({ settings: { ...t.patch.settings, showTodos: true, todos: todo(3), hoverReveal: false }, media: null, obsidian: "light", reduced: false, viewport: vp[0] ? { w: vp[0], h: vp[1] } : null, lang, labels: { theme: t.label, bg: "none", viewport: vp[0] ? vp[0] + "x" + vp[1] : "window", lang } });
}

// ---- run -------------------------------------------------------------------------------------------
const pluginDir = await ev(`app.plugins.plugins["lockscape"].pluginDir`);
const vaultBase = await ev(`app.vault.adapter.getBasePath()`);
const copied = [];
if (assetsDir) for (const f of fs.readdirSync(assetsDir)) { fs.copyFileSync(path.join(assetsDir, f), path.join(vaultBase, pluginDir, f)); copied.push(path.join(vaultBase, pluginDir, f)); }
await ev(PAGE);
await ev(`window.__qa.baselineRaf = window.__qa.raf.size`);
console.log(`runs: ${configs.length} (pairwise x${seeds} + sweeps)  plugin dir: ${pluginDir}`);

const results = []; const t0 = Date.now(); let lastVp = ""; let curLang = null;
const origLang = langsMode ? await ev(`window.localStorage.getItem("language")`) : null;
for (let i = 0; i < configs.length; i++) {
  const cfg = configs[i];
  const vpKey = cfg.viewport ? cfg.viewport.w + "x" + cfg.viewport.h : "window";
  if (vpKey !== lastVp) { if (cfg.viewport) await send("Emulation.setDeviceMetricsOverride", { width: cfg.viewport.w, height: cfg.viewport.h, deviceScaleFactor: 1, mobile: false }); else await send("Emulation.clearDeviceMetricsOverride"); lastVp = vpKey; await sleep(120); }
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: cfg.reduced ? "reduce" : "no-preference" }] });
  const rec = { id: i, labels: cfg.labels, sweep: !!cfg.sweep, issues: [], info: {} };
  try {
    if (cfg.lang && cfg.lang !== curLang) {
      await ev(`(async()=>{ window.localStorage.setItem("language", ${JSON.stringify(cfg.lang)}); const P=app.plugins.plugins["lockscape"]; P.lockScreen.release(); await app.plugins.disablePlugin("lockscape"); await app.plugins.enablePlugin("lockscape"); await new Promise(r=>setTimeout(r,400)); app.plugins.plugins["lockscape"].lockScreen.release(); window.__qa.repatch(); return 1; })()`);
      curLang = cfg.lang; await sleep(300);
    }
    const errBefore = await ev(`window.__qa.errors.length`);
    if (cfg.real) rec.info.before = await ev(`[innerWidth, innerHeight, screenX, screenY]`);
    await ev(`window.__qa.apply(${JSON.stringify({ settings: cfg.settings, media: cfg.media, obsidian: cfg.obsidian })}).then(()=>{ const P=app.plugins.plugins["lockscape"]; P.lockScreen.release(); return new Promise(r=>setTimeout(r,60)).then(()=>{ P.lockScreen.lock(); return 1; }); })`);
    await sleep(750); // the title rises in over 0.56 s: measure after it, or its opacity lowers the contrast
    if (cfg.real) {
      const [ww, hh] = REAL_SIZES[cfg.real]; let got = null; for (let k = 0; k < 30; k++) { got = await ev(`[innerWidth, innerHeight]`); if (got[0] === ww && got[1] === hh) break; await sleep(150); }
      rec.info.realSize = got.join("x"); if (got[0] !== ww || got[1] !== hh) rec.issues.push({ code: "real-window-not-shrunk", detail: "wanted " + ww + "x" + hh + " got " + got.join("x") });
    }
    if (cfg.lang) { rec.info.strings = await ev(`window.__qa.stressMessage()`); await sleep(120); }
    const m = await ev(`window.__qa.measure(${JSON.stringify({ media: cfg.media, reduced: cfg.reduced })})`);
    rec.issues.push(...m.issues); Object.assign(rec.info, m.info);
    if (m.issues.some((x) => !["contrast", "controls-below-fold"].includes(x.code))) { rec.shot = `run-${i}.png`; await shot(path.join(outDir, rec.shot)); }
    else if (i % 9 === 0) { rec.shot = `sample-${i}.png`; await shot(path.join(outDir, rec.shot)); }
    if (i % flowEvery === 0) for (const f of await ev(`window.__qa.flow()`)) rec.issues.push({ code: f, detail: "" });
    await ev(`app.plugins.plugins["lockscape"].lockScreen.release()`);
    if (cfg.real) { let back = null; for (let k = 0; k < 30; k++) { back = await ev(`[innerWidth, innerHeight, screenX, screenY]`); if (back.join() === rec.info.before.join()) break; await sleep(150); }
      if (back.join() !== rec.info.before.join()) rec.issues.push({ code: "window-not-restored", detail: "before " + rec.info.before.join(",") + " after " + back.join(",") });
      if (await ev(`app.plugins.plugins["lockscape"].settings.savedWindow !== null`)) rec.issues.push({ code: "saved-window-not-cleared", detail: "" }); }
    for (const l of await ev(`window.__qa.leaks()`)) rec.issues.push({ code: l, detail: "" });
    const errs = await ev(`window.__qa.errors.slice(${errBefore})`); for (const e of errs) rec.issues.push({ code: "js-error", detail: e });
    if (await ev(`window.__xss === 1`)) rec.issues.push({ code: "XSS-executed", detail: "" });
  } catch (e) { rec.issues.push({ code: "qa-runner-exception", detail: String(e).slice(0, 200) }); }
  results.push(rec);
  if (i % 25 === 24) console.log(`  ${i + 1}/${configs.length}  ${Math.round((Date.now() - t0) / 1000)}s`);
}

// ---- cleanup -----------------------------------------------------------------------------------------
await send("Emulation.clearDeviceMetricsOverride"); await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
if (langsMode) await ev(`(async()=>{ const P=app.plugins.plugins["lockscape"]; P.lockScreen.release(); ${origLang === null ? 'window.localStorage.removeItem("language")' : `window.localStorage.setItem("language", ${JSON.stringify(origLang)})`}; await app.plugins.disablePlugin("lockscape"); await app.plugins.enablePlugin("lockscape"); await new Promise(r=>setTimeout(r,400)); app.plugins.plugins["lockscape"].lockScreen.release(); return 1; })()`);
await ev(`(()=>{ app.plugins.plugins["lockscape"].lockScreen.release(); window.__qa.restore(); return 1; })()`);
for (const f of copied) fs.rmSync(f, { force: true });
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 1));

// ---- report --------------------------------------------------------------------------------------------
const by = new Map();
for (const r of results) for (const is of r.issues) { const k = is.code; if (!by.has(k)) by.set(k, { n: 0, runs: new Set(), ex: [] }); const g = by.get(k); g.n++; g.runs.add(r.id); if (g.ex.length < 4) g.ex.push({ id: r.id, theme: r.labels.theme, vp: r.labels.viewport, bg: r.labels.lang || r.labels.bg, detail: is.detail }); }
const rows = [...by.entries()].sort((a, b) => b[1].runs.size - a[1].runs.size);
console.log(`\nfinished ${results.length} runs in ${Math.round((Date.now() - t0) / 1000)}s; runs with issues: ${results.filter((r) => r.issues.length).length}`);
for (const [code, g] of rows) console.log(`${String(g.runs.size).padStart(4)} runs  ${code}\n        e.g. ` + g.ex.map((e) => `#${e.id} ${e.theme}/${e.vp}/${e.bg} ${e.detail}`.trim()).slice(0, 2).join("  |  "));
const infoCount = new Map(); for (const r of results) for (const k of Object.keys(r.info)) if (/^(textcolor|shape|font|accent|contrast-unknown)/.test(k)) { const kk = k + " @" + r.labels.theme; infoCount.set(kk, (infoCount.get(kk) || 0) + 1); }
if (infoCount.size) { console.log("\noptions the theme did not follow (info):"); for (const [k, n] of [...infoCount].sort()) console.log("  " + k + "  x" + n); }
ws.close(); process.exit(0);
