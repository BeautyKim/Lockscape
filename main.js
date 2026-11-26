"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VaultLockPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/background.ts
var MAX_EDGE = 1920;
var MAX_INPUT_BYTES = 40 * 1024 * 1024;
var JPEG_QUALITY = 0.85;
var BACKGROUND_FILE = "lockscreen-bg.jpg";
var VIDEO_EXTS = ["mp4", "webm"];
var MAX_VIDEO_BYTES = 30 * 1024 * 1024;
var MAX_VIDEO_SECONDS = 120;
function backgroundPath(pluginDir) {
  return `${pluginDir}/${BACKGROUND_FILE}`;
}
function videoPath(pluginDir, ext) {
  return `${pluginDir}/lockscreen-bg.${ext}`;
}
function pickFile(doc, accept) {
  return new Promise((resolve) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    const done = (file) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => done(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => done(null));
    doc.body.append(input);
    input.click();
  });
}
async function toJpeg(file, win) {
  if (file.size > MAX_INPUT_BYTES) throw new Error("image too large");
  const bitmap = await win.createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = win.document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("encode failed");
    return await blob.arrayBuffer();
  } finally {
    bitmap.close();
  }
}
async function chooseBackground(app, pluginDir, doc) {
  const file = await pickFile(doc, "image/*");
  if (!file) return false;
  const data = await toJpeg(file, doc.defaultView ?? window);
  await app.vault.adapter.writeBinary(backgroundPath(pluginDir), data);
  return true;
}
async function removeBackground(app, pluginDir) {
  const path = backgroundPath(pluginDir);
  if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
}
async function verifyPlayable(file, doc) {
  const url = URL.createObjectURL(file);
  try {
    const video = doc.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("timeout")), 1e4);
      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        if (!video.videoWidth || !video.videoHeight) return reject(new Error("no video track"));
        if (!Number.isFinite(video.duration) || video.duration > MAX_VIDEO_SECONDS) return reject(new Error("too long"));
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("cannot decode"));
      };
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
function extOf(file) {
  if (file.type === "video/mp4") return "mp4";
  if (file.type === "video/webm") return "webm";
  const m = /\.(mp4|webm)$/i.exec(file.name);
  return m ? m[1].toLowerCase() : null;
}
async function chooseVideo(app, pluginDir, doc) {
  const file = await pickFile(doc, "video/mp4,video/webm,.mp4,.webm");
  if (!file) return null;
  const ext = extOf(file);
  if (!ext || file.size > MAX_VIDEO_BYTES) throw new Error("unsupported video");
  await verifyPlayable(file, doc);
  await app.vault.adapter.writeBinary(videoPath(pluginDir, ext), await file.arrayBuffer());
  for (const other of VIDEO_EXTS) {
    if (other === ext) continue;
    const path = videoPath(pluginDir, other);
    if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
  }
  return ext;
}
async function removeVideo(app, pluginDir) {
  for (const ext of VIDEO_EXTS) {
    const path = videoPath(pluginDir, ext);
    if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
  }
}

// src/activitylog.ts
var LOG_LIMIT = 50;
var LOCK_REASONS = ["startup", "idle", "left", "manual", "system"];
var KINDS = ["lock", "unlock", "fail", "recover"];
function parseLog(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const x of raw) {
    if (typeof x !== "object" || x === null) continue;
    const e = x;
    if (typeof e.t !== "number" || !Number.isFinite(e.t) || e.t < 0) continue;
    if (typeof e.k !== "string" || !KINDS.includes(e.k)) continue;
    const entry = { t: Math.floor(e.t), k: e.k };
    if (entry.k === "lock" && typeof e.r === "string" && LOCK_REASONS.includes(e.r)) entry.r = e.r;
    out.push(entry);
  }
  return out.slice(-LOG_LIMIT);
}
function mergeLogs(a, b) {
  const seen = /* @__PURE__ */ new Set();
  const all = [];
  for (const e of [...a, ...b]) {
    const key = `${e.t}|${e.k}|${e.r ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(e);
  }
  all.sort((x, y) => x.t - y.t);
  return all.slice(-LOG_LIMIT);
}
function appendLog(log, entry) {
  return [...log, entry].slice(-LOG_LIMIT);
}

// src/color.ts
var DEFAULT_ACCENT = "#7c5cd6";
function cleanHex(v) {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : "";
}
function resolveColor(doc, css) {
  try {
    const canvas = doc.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = "#010203";
    ctx.fillStyle = css;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    if (css.trim() !== "" && d[0] === 1 && d[1] === 2 && d[2] === 3 && !/#010203/i.test(css)) return null;
    return [d[0], d[1], d[2]];
  } catch {
    return null;
  }
}
function themeAccent(doc) {
  const raw = doc.defaultView?.getComputedStyle(doc.body).getPropertyValue("--interactive-accent").trim() ?? "";
  return raw && resolveColor(doc, raw) || resolveColor(doc, DEFAULT_ACCENT) || [124, 92, 214];
}
var linear = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
function contrastRatio(a, b) {
  const lum = ([r, g, bl]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(bl);
  const x = lum(a);
  const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function inkFor(bg) {
  if (contrastRatio([255, 255, 255], bg) >= 4.5) return "#ffffff";
  return contrastRatio([17, 17, 17], bg) >= 4.5 ? "#111111" : "#ffffff";
}
function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl(h, s, l) {
  const hue = (h % 360 + 360) % 360;
  return `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}
function palette(base) {
  const [h, s] = rgbToHsl(base);
  const sat = Math.min(0.85, Math.max(0.55, s));
  return [hsl(h, sat, 0.6), hsl(h + 38, sat, 0.58), hsl(h - 42, sat, 0.62)];
}

// src/devicesettings.ts
var DEVICE_KEYS = [
  "idleMinutes",
  "lockOnHide",
  "graceSeconds",
  "coverOnBlur",
  "lockOnSystemLock",
  "shrinkOnLock",
  "lockWindowSize"
];
function pickDevice(settings) {
  const out = {};
  for (const k of DEVICE_KEYS) out[k] = settings[k];
  return out;
}
function applyDevice(shared, local) {
  if (typeof local !== "object" || local === null) return shared;
  const out = { ...shared };
  for (const k of DEVICE_KEYS) if (k in local) out[k] = local[k];
  return out;
}

// src/crypto.ts
var ITERATIONS = 6e5;
var MIN_ITER = 1e5;
var MAX_ITER = 1e7;
function cryptoAvailable() {
  return typeof crypto !== "undefined" && !!crypto.subtle && !!crypto.getRandomValues;
}
function isCredential(x) {
  if (typeof x !== "object" || x === null) return false;
  const c = x;
  return c.v === 1 && typeof c.salt === "string" && typeof c.hash === "string" && typeof c.iter === "number" && Number.isInteger(c.iter) && c.iter >= MIN_ITER && c.iter <= MAX_ITER;
}
function toB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function derive(password, salt, iter) {
  const raw = new TextEncoder().encode(password.normalize("NFKC"));
  const key = await crypto.subtle.importKey("raw", raw, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
    key,
    256
  );
  return new Uint8Array(bits);
}
function equalConstantTime(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function createCredential(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash2 = await derive(password, salt, ITERATIONS);
  return { v: 1, salt: toB64(salt), iter: ITERATIONS, hash: toB64(hash2) };
}
async function verifyPassword(password, cred) {
  const hash2 = await derive(password, fromB64(cred.salt), cred.iter);
  return equalConstantTime(hash2, fromB64(cred.hash));
}
var RK_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var RECOVERY_KEY_LENGTH = 24;
function generateRecoveryKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_LENGTH * 5 / 8));
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const b of bytes) {
    acc = acc << 8 | b;
    bits += 8;
    while (bits >= 5) {
      out += RK_ALPHABET[acc >> bits - 5 & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return out.match(/.{4}/g).join("-");
}
function normalizeRecoveryKey(input) {
  return input.normalize("NFKC").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}
function looksLikeRecoveryKey(input) {
  const n = normalizeRecoveryKey(input);
  return n.length === RECOVERY_KEY_LENGTH && [...n].every((c) => RK_ALPHABET.includes(c));
}
async function createRecoveryCredential(key) {
  return createCredential(normalizeRecoveryKey(key));
}
async function verifyRecoveryKey(input, cred) {
  if (!looksLikeRecoveryKey(input)) return false;
  return verifyPassword(normalizeRecoveryKey(input), cred);
}

// src/i18n/en.ts
var en = {
  lockedTitle: "Locked",
  placeholder: "Password",
  unlock: "Unlock",
  checking: "Checking\u2026",
  wrong: "Incorrect password.",
  wait: "Try again in {n}s.",
  cryptoError: "WebCrypto is unavailable here, so the password cannot be verified.",
  lockNow: "Lock now",
  noPassword: "Set a password in settings first.",
  settingsInfo: "This plugin is a screen lock. It does not encrypt files, so also use disk encryption (FileVault/BitLocker) in case the device is lost.",
  password: "Password",
  passwordNotSet: "Not set",
  passwordSet: "Set",
  setPassword: "Set",
  changePassword: "Change",
  removePassword: "Remove",
  lockOnStartup: "Lock on startup",
  idle: "Auto-lock when idle",
  idleOff: "Off",
  minutes: "{n} min",
  lockOnHide: "Lock when leaving the app",
  lockOnHideDesc: "When switching apps or minimizing the window. The note is covered immediately so it is not visible in the app switcher.",
  grace: "Grace period",
  graceDesc: "No password prompt if you come back within this time.",
  immediately: "Immediately",
  seconds: "{n}s",
  modalSet: "Set password",
  modalChange: "Change password",
  modalRemove: "Remove password",
  current: "Current password",
  newPw: "New password",
  confirmPw: "Confirm new password",
  save: "Save",
  cancel: "Cancel",
  tooShort: "Password must be at least {n} characters.",
  mismatch: "The new passwords do not match.",
  saved: "Password saved.",
  removed: "Password removed.",
  appearance: "Lock screen appearance",
  preview: "Preview",
  previewDesc: "See the lock screen without locking. Click anywhere or press Esc to close.",
  previewClose: "Click anywhere or press Esc to close",
  bgImage: "Background image",
  bgImageDesc: "Pick a photo from this device. It is resized and stored inside the plugin folder; nothing is uploaded.",
  chooseImage: "Choose image",
  removeImage: "Remove",
  imageFailed: "Could not use that image.",
  dim: "Dim background",
  blur: "Blur background",
  animation: "Background animation",
  animNone: "None",
  showClock: "Show clock",
  showSeconds: "Show seconds",
  showDate: "Show date",
  clockFormat: "Time format",
  fmtAuto: "Auto",
  fmt24: "24-hour",
  fmt12: "12-hour",
  showTodos: "Show to-do list",
  showTodosDesc: "Anyone can see and edit this list without the password. Do not write anything sensitive.",
  todoPlaceholder: "Add a to-do",
  todoAdd: "Add",
  todoDelete: "Delete",
  shrinkWindow: "Shrink window while locked",
  shrinkWindowDesc: "While the lock screen is showing, the Obsidian window shrinks; when you unlock it returns to its previous size and position. Desktop only. Not applied in full-screen mode.",
  lockWindowSize: "Locked window size",
  hoverReveal: "Hide the password field until hovered",
  hoverRevealDesc: "Keeps the lock screen clean: the password field appears when you hover over the lock icon area, press any key, or tap.",
  showTitle: 'Show "Locked" text',
  titleAuto: "Auto (hidden over a photo)",
  titleShow: "Always show",
  titleHide: "Hide",
  secBackground: "Background",
  secText: "Text & colors",
  secLayout: "Layout & shape",
  secWidgets: "Widgets",
  bgKind: "Background type",
  bgKindNone: "None",
  bgKindImage: "Photo",
  bgKindVideo: "Video",
  bgVideo: "Background video",
  bgVideoDesc: "Pick an MP4 or WebM clip from this device (up to 30 MB). It plays muted and looping only while locked, and is stored in the plugin folder; nothing is uploaded. Short looping clips work best.",
  chooseVideo: "Choose video",
  videoFailed: "Could not use that video (playable MP4/WebM, up to 30 MB).",
  animAurora: "Aurora",
  animFireflies: "Fireflies",
  animSnow: "Snow",
  textColor: "Text color",
  accentColor: "Accent color",
  colorAuto: "Automatic (follows theme and background)",
  resetColor: "Reset color",
  clockSize: "Clock size",
  clockFont: "Clock font",
  fontSans: "Sans-serif",
  fontSerif: "Serif",
  fontMono: "Monospace",
  fontRounded: "Rounded",
  clockWeight: "Clock weight",
  customTitle: "Custom text",
  customTitleDesc: "Replaces the \u201CLocked\u201D text. Leave empty for the default.",
  position: "Vertical position",
  posTop: "Top",
  posCenter: "Center",
  posBottom: "Bottom",
  fieldShape: "Field and button shape",
  shapeRounded: "Rounded",
  shapePill: "Pill",
  shapeSquare: "Square",
  showIcon: "Show lock icon",
  resetAppearance: "Reset appearance",
  resetAppearanceDesc: "Resets background type, colors, fonts, layout and animation to defaults. Your password, to-dos and saved image/video files are kept.",
  resetAppearanceBtn: "Reset",
  theme: "Theme",
  themeDefault: "Default",
  themeWin95: "Windows 95",
  themeTerminal: "Developer terminal",
  themeSnake: "Handheld snake (game)",
  themeBreakout: "Arcade breakout (game)",
  themeRunner: "Obsidian runner (game)",
  themeAuto: "Theme default",
  animGlow: "Cursor spotlight",
  animTrail: "Cursor trail",
  animOrbs: "Chasing orbs",
  unlocked: "Unlocked",
  forgot: "Forgot your password?",
  recoverPlaceholder: "Recovery key",
  recoverUnlock: "Unlock with recovery key",
  backToPassword: "Use password instead",
  modalReset: "Set a new password",
  modalRecovery: "Create a recovery key",
  resetIntro: "You unlocked with your recovery key. Choose a new password now. You will get a new recovery key too.",
  recoveryKeyTitle: "Your recovery key",
  recoveryKeyIntro: "Write this key down and keep it somewhere safe, away from this computer. It is shown only once and cannot be looked up later. If you forget your password, it unlocks the screen. Anyone who has it can unlock the screen.",
  copyKey: "Copy",
  copied: "Copied.",
  keySaved: "I saved it",
  recoveryRow: "Recovery key",
  recoveryOn: "Set. Use \u201CForgot your password?\u201D on the lock screen.",
  recoveryOff: "Not set. Without one, a forgotten password can only be fixed by editing data.json.",
  makeRecovery: "Create",
  renewRecovery: "Create new",
  logRecovered: "Unlocked with recovery key",
  hideScreen: "Hide screen (no password)",
  hideHint: "Click or press Esc to show the screen again.",
  coverOnBlur: "Cover when the window loses focus",
  coverOnBlurDesc: "Covers the notes as soon as another app is in front, not only when the window is minimised. Coming back within the grace period needs no password. The Settings window does not count as leaving.",
  lockOnSystemLock: "Lock when the computer locks or sleeps",
  lockOnSystemLockDesc: "Desktop only. Locks when the operating system locks the screen or goes to sleep. Does nothing if this build of Obsidian does not expose it.",
  deviceOnly: "Separate settings on this device",
  deviceOnlyDesc: "Auto-lock time, leave-the-app options, cover on focus loss, system lock and window shrinking are kept on this device only and are not synced.",
  logTitle: "Recent activity",
  logDesc: "The last 50 locks, unlocks and wrong passwords on devices that sync this vault. Not tamper-proof: anyone who can edit data.json can edit it.",
  logEmpty: "Nothing recorded yet.",
  logClear: "Clear",
  logLocked: "Locked",
  logUnlocked: "Unlocked",
  logFailed: "Wrong password",
  reasonStartup: "startup",
  reasonIdle: "idle",
  reasonLeft: "left the app",
  reasonManual: "manual",
  reasonSystem: "computer locked"
};
var en_default = en;

// src/i18n/ko.ts
var ko = {
  lockedTitle: "\uC7A0\uACA8 \uC788\uC2B5\uB2C8\uB2E4",
  placeholder: "\uBE44\uBC00\uBC88\uD638",
  unlock: "\uC7A0\uAE08 \uD574\uC81C",
  checking: "\uD655\uC778 \uC911\u2026",
  wrong: "\uBE44\uBC00\uBC88\uD638\uAC00 \uB9DE\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  wait: "{n}\uCD08 \uD6C4\uC5D0 \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC138\uC694.",
  cryptoError: "\uC774 \uD658\uACBD\uC5D0\uC11C\uB294 \uC554\uD638 \uAE30\uB2A5(WebCrypto)\uC744 \uC4F8 \uC218 \uC5C6\uC5B4 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
  lockNow: "\uC9C0\uAE08 \uC7A0\uADF8\uAE30",
  noPassword: "\uBA3C\uC800 \uC124\uC815\uC5D0\uC11C \uBE44\uBC00\uBC88\uD638\uB97C \uC9C0\uC815\uD558\uC138\uC694.",
  settingsInfo: "\uC774 \uD50C\uB7EC\uADF8\uC778\uC740 \uD654\uBA74 \uC7A0\uAE08\uC785\uB2C8\uB2E4. \uD30C\uC77C\uC744 \uC554\uD638\uD654\uD558\uC9C0 \uC54A\uC73C\uBBC0\uB85C, \uAE30\uAE30 \uBD84\uC2E4\uC5D0 \uB300\uBE44\uD574 FileVault/BitLocker \uAC19\uC740 \uB514\uC2A4\uD06C \uC554\uD638\uD654\uB97C \uD568\uAED8 \uC0AC\uC6A9\uD558\uC138\uC694.",
  password: "\uBE44\uBC00\uBC88\uD638",
  passwordNotSet: "\uC124\uC815\uB418\uC9C0 \uC54A\uC74C",
  passwordSet: "\uC124\uC815\uB428",
  setPassword: "\uC124\uC815",
  changePassword: "\uBCC0\uACBD",
  removePassword: "\uD574\uC81C",
  lockOnStartup: "\uC2DC\uC791\uD560 \uB54C \uC7A0\uAE08",
  idle: "\uC790\uB3D9 \uC7A0\uAE08(\uBBF8\uC0AC\uC6A9 \uC2DC\uAC04)",
  idleOff: "\uC0AC\uC6A9 \uC548 \uD568",
  minutes: "{n}\uBD84",
  lockOnHide: "\uC571\uC744 \uBC97\uC5B4\uB098\uBA74 \uC7A0\uAE08",
  lockOnHideDesc: "\uBAA8\uBC14\uC77C\uC5D0\uC11C \uB2E4\uB978 \uC571\uC73C\uB85C \uC804\uD658\uD558\uAC70\uB098 \uCC3D\uC744 \uCD5C\uC18C\uD654\uD560 \uB54C. \uC804\uD658 \uD654\uBA74\uC5D0 \uB178\uD2B8\uAC00 \uBCF4\uC774\uC9C0 \uC54A\uB3C4\uB85D \uC989\uC2DC \uAC00\uB9BD\uB2C8\uB2E4.",
  grace: "\uC720\uC608 \uC2DC\uAC04",
  graceDesc: "\uC774 \uC2DC\uAC04 \uC548\uC5D0 \uB3CC\uC544\uC624\uBA74 \uB2E4\uC2DC \uBB3B\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  immediately: "\uC989\uC2DC",
  seconds: "{n}\uCD08",
  modalSet: "\uBE44\uBC00\uBC88\uD638 \uC124\uC815",
  modalChange: "\uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD",
  modalRemove: "\uBE44\uBC00\uBC88\uD638 \uD574\uC81C",
  current: "\uD604\uC7AC \uBE44\uBC00\uBC88\uD638",
  newPw: "\uC0C8 \uBE44\uBC00\uBC88\uD638",
  confirmPw: "\uC0C8 \uBE44\uBC00\uBC88\uD638 \uD655\uC778",
  save: "\uC800\uC7A5",
  cancel: "\uCDE8\uC18C",
  tooShort: "\uBE44\uBC00\uBC88\uD638\uB294 {n}\uC790 \uC774\uC0C1\uC774\uC5B4\uC57C \uD569\uB2C8\uB2E4.",
  mismatch: "\uC0C8 \uBE44\uBC00\uBC88\uD638\uAC00 \uC11C\uB85C \uB2E4\uB985\uB2C8\uB2E4.",
  saved: "\uBE44\uBC00\uBC88\uD638\uB97C \uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4.",
  removed: "\uBE44\uBC00\uBC88\uD638\uB97C \uD574\uC81C\uD588\uC2B5\uB2C8\uB2E4.",
  appearance: "\uC7A0\uAE08 \uD654\uBA74 \uAFB8\uBBF8\uAE30",
  preview: "\uBBF8\uB9AC\uBCF4\uAE30",
  previewDesc: "\uC7A0\uADF8\uC9C0 \uC54A\uACE0 \uC7A0\uAE08 \uD654\uBA74\uC744 \uD655\uC778\uD569\uB2C8\uB2E4. \uC544\uBB34 \uACF3\uC774\uB098 \uB204\uB974\uAC70\uB098 Esc\uB97C \uB204\uB974\uBA74 \uB2EB\uD799\uB2C8\uB2E4.",
  previewClose: "\uC544\uBB34 \uACF3\uC774\uB098 \uB204\uB974\uAC70\uB098 Esc\uB97C \uB204\uB974\uBA74 \uB2EB\uD799\uB2C8\uB2E4",
  bgImage: "\uBC30\uACBD \uC774\uBBF8\uC9C0",
  bgImageDesc: "\uC774 \uAE30\uAE30\uC5D0\uC11C \uC0AC\uC9C4\uC744 \uACE0\uB985\uB2C8\uB2E4. \uD06C\uAE30\uB97C \uC904\uC5EC \uD50C\uB7EC\uADF8\uC778 \uD3F4\uB354\uC5D0 \uC800\uC7A5\uD558\uBA70, \uC5B4\uB514\uC5D0\uB3C4 \uC5C5\uB85C\uB4DC\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  chooseImage: "\uC774\uBBF8\uC9C0 \uC120\uD0DD",
  removeImage: "\uC81C\uAC70",
  imageFailed: "\uC774 \uC774\uBBF8\uC9C0\uB97C \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.",
  dim: "\uBC30\uACBD \uC5B4\uB461\uAC8C",
  blur: "\uBC30\uACBD \uD750\uB9AC\uAC8C",
  animation: "\uBC30\uACBD \uC560\uB2C8\uBA54\uC774\uC158",
  animNone: "\uC5C6\uC74C",
  showClock: "\uC2DC\uACC4 \uD45C\uC2DC",
  showSeconds: "\uCD08 \uD45C\uC2DC",
  showDate: "\uB0A0\uC9DC \uD45C\uC2DC",
  clockFormat: "\uC2DC\uAC04 \uD615\uC2DD",
  fmtAuto: "\uC790\uB3D9",
  fmt24: "24\uC2DC\uAC04",
  fmt12: "12\uC2DC\uAC04",
  showTodos: "\uD560 \uC77C \uBAA9\uB85D \uD45C\uC2DC",
  showTodosDesc: "\uBE44\uBC00\uBC88\uD638 \uC5C6\uC774 \uB204\uAD6C\uB098 \uC774 \uBAA9\uB85D\uC744 \uBCF4\uACE0 \uC218\uC815\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uBBFC\uAC10\uD55C \uB0B4\uC6A9\uC740 \uC801\uC9C0 \uB9C8\uC138\uC694.",
  todoPlaceholder: "\uD560 \uC77C \uCD94\uAC00",
  todoAdd: "\uCD94\uAC00",
  todoDelete: "\uC0AD\uC81C",
  shrinkWindow: "\uC7A0\uAE08 \uC911\uC5D0\uB294 \uCC3D \uC791\uAC8C \uB9CC\uB4E4\uAE30",
  shrinkWindowDesc: "\uC7A0\uAE08 \uD654\uBA74\uC774 \uBCF4\uC774\uB294 \uB3D9\uC548 Obsidian \uCC3D\uC744 \uC791\uAC8C \uC904\uC774\uACE0, \uC7A0\uAE08\uC744 \uD480\uBA74 \uC6D0\uB798 \uD06C\uAE30\uC640 \uC704\uCE58\uB85C \uB418\uB3CC\uB9BD\uB2C8\uB2E4. \uB370\uC2A4\uD06C\uD1B1 \uC804\uC6A9\uC785\uB2C8\uB2E4. \uC804\uCCB4 \uD654\uBA74\uC77C \uB54C\uB294 \uC801\uC6A9\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  lockWindowSize: "\uC7A0\uAE08 \uCC3D \uD06C\uAE30",
  hoverReveal: "\uB9C8\uC6B0\uC2A4\uB97C \uC62C\uB9AC\uBA74 \uBE44\uBC00\uBC88\uD638 \uC785\uB825\uCC3D \uD45C\uC2DC",
  hoverRevealDesc: "\uC7A0\uAE08 \uD654\uBA74\uC744 \uAE54\uB054\uD558\uAC8C \uBCF4\uC774\uB3C4\uB85D \uC785\uB825\uCC3D\uC744 \uC228\uAE41\uB2C8\uB2E4. \uC790\uBB3C\uC1E0 \uC601\uC5ED\uC5D0 \uB9C8\uC6B0\uC2A4\uB97C \uC62C\uB9AC\uAC70\uB098, \uC544\uBB34 \uD0A4\uB098 \uB204\uB974\uAC70\uB098, \uD0ED\uD558\uBA74 \uB098\uD0C0\uB0A9\uB2C8\uB2E4.",
  showTitle: "'\uC7A0\uACA8 \uC788\uC2B5\uB2C8\uB2E4' \uBB38\uAD6C \uD45C\uC2DC",
  titleAuto: "\uC790\uB3D9 (\uC0AC\uC9C4 \uBC30\uACBD\uC774\uBA74 \uC228\uAE40)",
  titleShow: "\uD56D\uC0C1 \uD45C\uC2DC",
  titleHide: "\uC228\uAE40",
  secBackground: "\uBC30\uACBD",
  secText: "\uAE00\uC790\uC640 \uC0C9",
  secLayout: "\uBC30\uCE58\uC640 \uBAA8\uC591",
  secWidgets: "\uC704\uC82F",
  bgKind: "\uBC30\uACBD \uC885\uB958",
  bgKindNone: "\uC5C6\uC74C",
  bgKindImage: "\uC0AC\uC9C4",
  bgKindVideo: "\uC601\uC0C1",
  bgVideo: "\uBC30\uACBD \uC601\uC0C1",
  bgVideoDesc: "\uC774 \uAE30\uAE30\uC5D0\uC11C MP4 \uB610\uB294 WebM \uC601\uC0C1\uC744 \uACE0\uB985\uB2C8\uB2E4(\uCD5C\uB300 30MB). \uC7A0\uACA8 \uC788\uB294 \uB3D9\uC548\uC5D0\uB9CC \uC18C\uB9AC \uC5C6\uC774 \uBC18\uBCF5 \uC7AC\uC0DD\uD558\uBA70 \uD50C\uB7EC\uADF8\uC778 \uD3F4\uB354\uC5D0 \uC800\uC7A5\uB429\uB2C8\uB2E4. \uC5B4\uB514\uC5D0\uB3C4 \uC5C5\uB85C\uB4DC\uB418\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC9E7\uAC8C \uBC18\uBCF5\uB418\uB294 \uC601\uC0C1\uC774 \uC798 \uC5B4\uC6B8\uB9BD\uB2C8\uB2E4.",
  chooseVideo: "\uC601\uC0C1 \uC120\uD0DD",
  videoFailed: "\uC774 \uC601\uC0C1\uC744 \uC0AC\uC6A9\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. (\uC7AC\uC0DD \uAC00\uB2A5\uD55C MP4/WebM, \uCD5C\uB300 30MB)",
  animAurora: "\uC624\uB85C\uB77C",
  animFireflies: "\uBC18\uB527\uBD88",
  animSnow: "\uB208",
  textColor: "\uAE00\uC790 \uC0C9",
  accentColor: "\uAC15\uC870 \uC0C9",
  colorAuto: "\uC790\uB3D9 (\uD14C\uB9C8\uC640 \uBC30\uACBD\uC5D0 \uB9DE\uCDA4)",
  resetColor: "\uC0C9 \uCD08\uAE30\uD654",
  clockSize: "\uC2DC\uACC4 \uD06C\uAE30",
  clockFont: "\uC2DC\uACC4 \uAE00\uAF34",
  fontSans: "\uACE0\uB515(\uC0B0\uC138\uB9AC\uD504)",
  fontSerif: "\uBA85\uC870(\uC138\uB9AC\uD504)",
  fontMono: "\uACE0\uC815\uD3ED",
  fontRounded: "\uB465\uADFC \uAE00\uAF34",
  clockWeight: "\uC2DC\uACC4 \uAD75\uAE30",
  customTitle: "\uBB38\uAD6C \uC9C1\uC811 \uC785\uB825",
  customTitleDesc: "'\uC7A0\uACA8 \uC788\uC2B5\uB2C8\uB2E4' \uB300\uC2E0 \uD45C\uC2DC\uD560 \uBB38\uAD6C\uC785\uB2C8\uB2E4. \uBE44\uC6CC \uB450\uBA74 \uAE30\uBCF8 \uBB38\uAD6C\uB97C \uC501\uB2C8\uB2E4.",
  position: "\uC138\uB85C \uC704\uCE58",
  posTop: "\uC704",
  posCenter: "\uAC00\uC6B4\uB370",
  posBottom: "\uC544\uB798",
  fieldShape: "\uC785\uB825\uCC3D\xB7\uBC84\uD2BC \uBAA8\uC591",
  shapeRounded: "\uB465\uADFC \uBAA8\uC11C\uB9AC",
  shapePill: "\uC54C\uC57D\uD615",
  shapeSquare: "\uAC01\uC9C4 \uBAA8\uC11C\uB9AC",
  showIcon: "\uC790\uBB3C\uC1E0 \uC544\uC774\uCF58 \uD45C\uC2DC",
  resetAppearance: "\uAFB8\uBBF8\uAE30 \uCD08\uAE30\uD654",
  resetAppearanceDesc: "\uBC30\uACBD \uC885\uB958, \uC0C9, \uAE00\uAF34, \uBC30\uCE58, \uC560\uB2C8\uBA54\uC774\uC158\uC744 \uAE30\uBCF8\uAC12\uC73C\uB85C \uB418\uB3CC\uB9BD\uB2C8\uB2E4. \uBE44\uBC00\uBC88\uD638\uC640 \uD560 \uC77C \uBAA9\uB85D, \uC800\uC7A5\uB41C \uC774\uBBF8\uC9C0\xB7\uC601\uC0C1 \uD30C\uC77C\uC740 \uADF8\uB300\uB85C \uB461\uB2C8\uB2E4.",
  resetAppearanceBtn: "\uCD08\uAE30\uD654",
  theme: "\uD14C\uB9C8",
  themeDefault: "\uAE30\uBCF8",
  themeWin95: "Windows 95",
  themeTerminal: "\uAC1C\uBC1C\uC790 \uD130\uBBF8\uB110",
  themeSnake: "\uAC8C\uC784\uBCF4\uC774 \uC2A4\uB124\uC774\uD06C (\uAC8C\uC784)",
  themeBreakout: "\uC544\uCF00\uC774\uB4DC \uBCBD\uB3CC\uAE68\uAE30 (\uAC8C\uC784)",
  themeRunner: "\uC635\uC2DC\uB514\uC5B8 \uB7EC\uB108 (\uAC8C\uC784)",
  themeAuto: "\uD14C\uB9C8 \uAE30\uBCF8",
  animGlow: "\uB9C8\uC6B0\uC2A4 \uC870\uBA85",
  animTrail: "\uB9C8\uC6B0\uC2A4 \uADA4\uC801",
  animOrbs: "\uB530\uB77C\uC624\uB294 \uAD6C\uC2AC",
  unlocked: "\uC7A0\uAE08 \uD574\uC81C\uB428",
  forgot: "\uBE44\uBC00\uBC88\uD638\uB97C \uC78A\uC73C\uC168\uB098\uC694?",
  recoverPlaceholder: "\uBCF5\uAD6C \uD0A4",
  recoverUnlock: "\uBCF5\uAD6C \uD0A4\uB85C \uD574\uC81C",
  backToPassword: "\uBE44\uBC00\uBC88\uD638\uB85C \uD574\uC81C",
  modalReset: "\uC0C8 \uBE44\uBC00\uBC88\uD638 \uC124\uC815",
  modalRecovery: "\uBCF5\uAD6C \uD0A4 \uB9CC\uB4E4\uAE30",
  resetIntro: "\uBCF5\uAD6C \uD0A4\uB85C \uC7A0\uAE08\uC744 \uD480\uC5C8\uC2B5\uB2C8\uB2E4. \uC9C0\uAE08 \uC0C8 \uBE44\uBC00\uBC88\uD638\uB97C \uC815\uD558\uC138\uC694. \uC0C8 \uBCF5\uAD6C \uD0A4\uB3C4 \uD568\uAED8 \uBC1C\uAE09\uB429\uB2C8\uB2E4.",
  recoveryKeyTitle: "\uBCF5\uAD6C \uD0A4",
  recoveryKeyIntro: "\uC774 \uD0A4\uB97C \uC801\uC5B4\uC11C \uC774 \uCEF4\uD4E8\uD130\uC640 \uB5A8\uC5B4\uC9C4 \uC548\uC804\uD55C \uACF3\uC5D0 \uBCF4\uAD00\uD558\uC138\uC694. \uD55C \uBC88\uB9CC \uBCF4\uC5EC \uC8FC\uBA70 \uB098\uC911\uC5D0 \uB2E4\uC2DC \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4. \uBE44\uBC00\uBC88\uD638\uB97C \uC78A\uC73C\uBA74 \uC774 \uD0A4\uB85C \uD654\uBA74\uC744 \uD480 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uC774 \uD0A4\uB97C \uAC00\uC9C4 \uC0AC\uB78C\uC740 \uB204\uAD6C\uB098 \uD654\uBA74\uC744 \uD480 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  copyKey: "\uBCF5\uC0AC",
  copied: "\uBCF5\uC0AC\uD588\uC2B5\uB2C8\uB2E4.",
  keySaved: "\uC800\uC7A5\uD588\uC2B5\uB2C8\uB2E4",
  recoveryRow: "\uBCF5\uAD6C \uD0A4",
  recoveryOn: '\uC124\uC815\uB428. \uC7A0\uAE08 \uD654\uBA74\uC758 "\uBE44\uBC00\uBC88\uD638\uB97C \uC78A\uC73C\uC168\uB098\uC694?"\uC5D0\uC11C \uC501\uB2C8\uB2E4.',
  recoveryOff: "\uC124\uC815 \uC548 \uB428. \uC5C6\uC73C\uBA74 \uBE44\uBC00\uBC88\uD638\uB97C \uC78A\uC5C8\uC744 \uB54C data.json\uC744 \uC9C1\uC811 \uACE0\uCCD0\uC57C \uD569\uB2C8\uB2E4.",
  makeRecovery: "\uB9CC\uB4E4\uAE30",
  renewRecovery: "\uC0C8\uB85C \uB9CC\uB4E4\uAE30",
  logRecovered: "\uBCF5\uAD6C \uD0A4\uB85C \uD574\uC81C\uB428",
  hideScreen: "\uD654\uBA74 \uAC00\uB9AC\uAE30 (\uBE44\uBC00\uBC88\uD638 \uC5C6\uC74C)",
  hideHint: "\uD074\uB9AD\uD558\uAC70\uB098 Esc\uB97C \uB204\uB974\uBA74 \uD654\uBA74\uC774 \uB2E4\uC2DC \uBCF4\uC785\uB2C8\uB2E4.",
  coverOnBlur: "\uCC3D\uC774 \uD3EC\uCEE4\uC2A4\uB97C \uC783\uC73C\uBA74 \uAC00\uB9AC\uAE30",
  coverOnBlurDesc: "\uCC3D\uC744 \uCD5C\uC18C\uD654\uD560 \uB54C\uB9CC\uC774 \uC544\uB2C8\uB77C \uB2E4\uB978 \uC571\uC774 \uC55E\uC73C\uB85C \uC624\uB294 \uC21C\uAC04 \uB178\uD2B8\uB97C \uAC00\uB9BD\uB2C8\uB2E4. \uC720\uC608 \uC2DC\uAC04 \uC548\uC5D0 \uB3CC\uC544\uC624\uBA74 \uBE44\uBC00\uBC88\uD638\uB97C \uBB3B\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4. \uC124\uC815 \uCC3D\uC740 \uBC97\uC5B4\uB09C \uAC83\uC73C\uB85C \uBCF4\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  lockOnSystemLock: "\uCEF4\uD4E8\uD130\uAC00 \uC7A0\uAE30\uAC70\uB098 \uC808\uC804\uB418\uBA74 \uC7A0\uAE08",
  lockOnSystemLockDesc: "\uB370\uC2A4\uD06C\uD1B1 \uC804\uC6A9. \uC6B4\uC601\uCCB4\uC81C\uAC00 \uD654\uBA74\uC744 \uC7A0\uADF8\uAC70\uB098 \uC808\uC804\uC5D0 \uB4E4\uC5B4\uAC00\uBA74 \uC7A0\uAE09\uB2C8\uB2E4. \uC774 Obsidian \uBE4C\uB4DC\uAC00 \uD574\uB2F9 \uAE30\uB2A5\uC744 \uC81C\uACF5\uD558\uC9C0 \uC54A\uC73C\uBA74 \uB3D9\uC791\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  deviceOnly: "\uC774 \uAE30\uAE30 \uC804\uC6A9 \uC124\uC815",
  deviceOnlyDesc: "\uC790\uB3D9 \uC7A0\uAE08 \uC2DC\uAC04, \uC571\uC744 \uBC97\uC5B4\uB0A0 \uB54C \uC635\uC158, \uD3EC\uCEE4\uC2A4\uB97C \uC783\uC73C\uBA74 \uAC00\uB9AC\uAE30, \uC2DC\uC2A4\uD15C \uC7A0\uAE08, \uCC3D \uC904\uC774\uAE30\uB97C \uC774 \uAE30\uAE30\uC5D0\uB9CC \uC800\uC7A5\uD558\uACE0 \uB3D9\uAE30\uD654\uD558\uC9C0 \uC54A\uC2B5\uB2C8\uB2E4.",
  logTitle: "\uCD5C\uADFC \uAE30\uB85D",
  logDesc: "\uC774 \uBCFC\uD2B8\uB97C \uB3D9\uAE30\uD654\uD558\uB294 \uAE30\uAE30\uB4E4\uC758 \uCD5C\uADFC \uC7A0\uAE08\xB7\uD574\uC81C\xB7\uBE44\uBC00\uBC88\uD638 \uC624\uB958 50\uAC74\uC785\uB2C8\uB2E4. \uBCC0\uC870\uB97C \uB9C9\uC9C0\uB294 \uBABB\uD569\uB2C8\uB2E4. data.json\uC744 \uACE0\uCE60 \uC218 \uC788\uB294 \uC0AC\uB78C\uC740 \uC774 \uAE30\uB85D\uB3C4 \uACE0\uCE60 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  logEmpty: "\uC544\uC9C1 \uAE30\uB85D\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.",
  logClear: "\uC9C0\uC6B0\uAE30",
  logLocked: "\uC7A0\uAE40",
  logUnlocked: "\uD574\uC81C\uB428",
  logFailed: "\uBE44\uBC00\uBC88\uD638 \uC624\uB958",
  reasonStartup: "\uC2DC\uC791",
  reasonIdle: "\uBBF8\uC0AC\uC6A9",
  reasonLeft: "\uC571\uC744 \uBC97\uC5B4\uB0A8",
  reasonManual: "\uC218\uB3D9",
  reasonSystem: "\uCEF4\uD4E8\uD130 \uC7A0\uAE08"
};
var ko_default = ko;

// src/i18n/ja.ts
var ja = {
  lockedTitle: "\u30ED\u30C3\u30AF\u3055\u308C\u3066\u3044\u307E\u3059",
  placeholder: "\u30D1\u30B9\u30EF\u30FC\u30C9",
  unlock: "\u30ED\u30C3\u30AF\u89E3\u9664",
  checking: "\u78BA\u8A8D\u4E2D\u2026",
  wrong: "\u30D1\u30B9\u30EF\u30FC\u30C9\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093\u3002",
  wait: "{n}\u79D2\u5F8C\u306B\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002",
  cryptoError: "\u3053\u306E\u74B0\u5883\u3067\u306F\u6697\u53F7\u6A5F\u80FD(WebCrypto)\u3092\u4F7F\u7528\u3067\u304D\u306A\u3044\u305F\u3081\u3001\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3002",
  lockNow: "\u4ECA\u3059\u3050\u30ED\u30C3\u30AF",
  noPassword: "\u5148\u306B\u8A2D\u5B9A\u3067\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  settingsInfo: "\u3053\u306E\u30D7\u30E9\u30B0\u30A4\u30F3\u306F\u753B\u9762\u30ED\u30C3\u30AF\u3067\u3059\u3002\u30D5\u30A1\u30A4\u30EB\u306F\u6697\u53F7\u5316\u3055\u308C\u306A\u3044\u305F\u3081\u3001\u7AEF\u672B\u306E\u7D1B\u5931\u306B\u5099\u3048\u3066 FileVault/BitLocker \u306A\u3069\u306E\u30C7\u30A3\u30B9\u30AF\u6697\u53F7\u5316\u3082\u4F75\u7528\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  password: "\u30D1\u30B9\u30EF\u30FC\u30C9",
  passwordNotSet: "\u672A\u8A2D\u5B9A",
  passwordSet: "\u8A2D\u5B9A\u6E08\u307F",
  setPassword: "\u8A2D\u5B9A",
  changePassword: "\u5909\u66F4",
  removePassword: "\u89E3\u9664",
  lockOnStartup: "\u8D77\u52D5\u6642\u306B\u30ED\u30C3\u30AF",
  idle: "\u64CD\u4F5C\u304C\u306A\u3044\u3068\u304D\u306B\u81EA\u52D5\u30ED\u30C3\u30AF",
  idleOff: "\u30AA\u30D5",
  minutes: "{n}\u5206",
  lockOnHide: "\u30A2\u30D7\u30EA\u3092\u96E2\u308C\u305F\u3089\u30ED\u30C3\u30AF",
  lockOnHideDesc: "\u4ED6\u306E\u30A2\u30D7\u30EA\u306B\u5207\u308A\u66FF\u3048\u305F\u308A\u30A6\u30A3\u30F3\u30C9\u30A6\u3092\u6700\u5C0F\u5316\u3057\u305F\u3068\u304D\u306B\u30ED\u30C3\u30AF\u3057\u307E\u3059\u3002\u30A2\u30D7\u30EA\u5207\u308A\u66FF\u3048\u753B\u9762\u306B\u30CE\u30FC\u30C8\u304C\u6620\u3089\u306A\u3044\u3088\u3046\u3001\u3059\u3050\u306B\u8986\u3044\u96A0\u3057\u307E\u3059\u3002",
  grace: "\u7336\u4E88\u6642\u9593",
  graceDesc: "\u3053\u306E\u6642\u9593\u5185\u306B\u623B\u3063\u305F\u5834\u5408\u306F\u3001\u518D\u5165\u529B\u3092\u6C42\u3081\u307E\u305B\u3093\u3002",
  immediately: "\u3059\u3050\u306B",
  seconds: "{n}\u79D2",
  modalSet: "\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u8A2D\u5B9A",
  modalChange: "\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u5909\u66F4",
  modalRemove: "\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u89E3\u9664",
  current: "\u73FE\u5728\u306E\u30D1\u30B9\u30EF\u30FC\u30C9",
  newPw: "\u65B0\u3057\u3044\u30D1\u30B9\u30EF\u30FC\u30C9",
  confirmPw: "\u65B0\u3057\u3044\u30D1\u30B9\u30EF\u30FC\u30C9(\u78BA\u8A8D)",
  save: "\u4FDD\u5B58",
  cancel: "\u30AD\u30E3\u30F3\u30BB\u30EB",
  tooShort: "\u30D1\u30B9\u30EF\u30FC\u30C9\u306F{n}\u6587\u5B57\u4EE5\u4E0A\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
  mismatch: "\u65B0\u3057\u3044\u30D1\u30B9\u30EF\u30FC\u30C9\u304C\u4E00\u81F4\u3057\u307E\u305B\u3093\u3002",
  saved: "\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F\u3002",
  removed: "\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u89E3\u9664\u3057\u307E\u3057\u305F\u3002",
  appearance: "\u30ED\u30C3\u30AF\u753B\u9762\u306E\u30AB\u30B9\u30BF\u30DE\u30A4\u30BA",
  preview: "\u30D7\u30EC\u30D3\u30E5\u30FC",
  previewDesc: "\u30ED\u30C3\u30AF\u305B\u305A\u306B\u30ED\u30C3\u30AF\u753B\u9762\u3092\u78BA\u8A8D\u3057\u307E\u3059\u3002\u3069\u3053\u304B\u3092\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u304B Esc \u30AD\u30FC\u3067\u9589\u3058\u307E\u3059\u3002",
  previewClose: "\u3069\u3053\u304B\u3092\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u304B Esc \u30AD\u30FC\u3067\u9589\u3058\u307E\u3059",
  bgImage: "\u80CC\u666F\u753B\u50CF",
  bgImageDesc: "\u3053\u306E\u7AEF\u672B\u304B\u3089\u5199\u771F\u3092\u9078\u3073\u307E\u3059\u3002\u30B5\u30A4\u30BA\u3092\u7E2E\u5C0F\u3057\u3066\u30D7\u30E9\u30B0\u30A4\u30F3\u30D5\u30A9\u30EB\u30C0\u306B\u4FDD\u5B58\u3057\u3001\u3069\u3053\u306B\u3082\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3055\u308C\u307E\u305B\u3093\u3002",
  chooseImage: "\u753B\u50CF\u3092\u9078\u629E",
  removeImage: "\u524A\u9664",
  imageFailed: "\u3053\u306E\u753B\u50CF\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093\u3002",
  dim: "\u80CC\u666F\u3092\u6697\u304F\u3059\u308B",
  blur: "\u80CC\u666F\u3092\u307C\u304B\u3059",
  animation: "\u80CC\u666F\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3",
  animNone: "\u306A\u3057",
  showClock: "\u6642\u8A08\u3092\u8868\u793A",
  showSeconds: "\u79D2\u3092\u8868\u793A",
  showDate: "\u65E5\u4ED8\u3092\u8868\u793A",
  clockFormat: "\u6642\u523B\u306E\u5F62\u5F0F",
  fmtAuto: "\u81EA\u52D5",
  fmt24: "24\u6642\u9593",
  fmt12: "12\u6642\u9593",
  showTodos: "ToDo\u30EA\u30B9\u30C8\u3092\u8868\u793A",
  showTodosDesc: "\u30D1\u30B9\u30EF\u30FC\u30C9\u306A\u3057\u3067\u8AB0\u3067\u3082\u3053\u306E\u30EA\u30B9\u30C8\u3092\u898B\u305F\u308A\u7DE8\u96C6\u3057\u305F\u308A\u3067\u304D\u307E\u3059\u3002\u6A5F\u5BC6\u60C5\u5831\u306F\u66F8\u304B\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002",
  todoPlaceholder: "ToDo\u3092\u8FFD\u52A0",
  todoAdd: "\u8FFD\u52A0",
  todoDelete: "\u524A\u9664",
  shrinkWindow: "\u30ED\u30C3\u30AF\u4E2D\u306F\u30A6\u30A3\u30F3\u30C9\u30A6\u3092\u5C0F\u3055\u304F\u3059\u308B",
  shrinkWindowDesc: "\u30ED\u30C3\u30AF\u753B\u9762\u306E\u8868\u793A\u4E2D\u306F Obsidian \u306E\u30A6\u30A3\u30F3\u30C9\u30A6\u3092\u5C0F\u3055\u304F\u3057\u3001\u89E3\u9664\u3059\u308B\u3068\u5143\u306E\u30B5\u30A4\u30BA\u3068\u4F4D\u7F6E\u306B\u623B\u3057\u307E\u3059\u3002\u30C7\u30B9\u30AF\u30C8\u30C3\u30D7\u5C02\u7528\u3067\u3059\u3002\u5168\u753B\u9762\u8868\u793A\u306E\u3068\u304D\u306F\u9069\u7528\u3055\u308C\u307E\u305B\u3093\u3002",
  lockWindowSize: "\u30ED\u30C3\u30AF\u6642\u306E\u30A6\u30A3\u30F3\u30C9\u30A6\u30B5\u30A4\u30BA",
  hoverReveal: "\u30DB\u30D0\u30FC\u3059\u308B\u307E\u3067\u30D1\u30B9\u30EF\u30FC\u30C9\u6B04\u3092\u96A0\u3059",
  hoverRevealDesc: "\u30ED\u30C3\u30AF\u753B\u9762\u3092\u3059\u3063\u304D\u308A\u898B\u305B\u308B\u305F\u3081\u3001\u5165\u529B\u6B04\u3092\u96A0\u3057\u307E\u3059\u3002\u30ED\u30C3\u30AF\u30A2\u30A4\u30B3\u30F3\u306E\u5468\u8FBA\u306B\u30DE\u30A6\u30B9\u3092\u91CD\u306D\u308B\u304B\u3001\u4EFB\u610F\u306E\u30AD\u30FC\u3092\u62BC\u3059\u304B\u3001\u30BF\u30C3\u30D7\u3059\u308B\u3068\u8868\u793A\u3055\u308C\u307E\u3059\u3002",
  showTitle: "\u300C\u30ED\u30C3\u30AF\u3055\u308C\u3066\u3044\u307E\u3059\u300D\u306E\u8868\u793A",
  titleAuto: "\u81EA\u52D5(\u5199\u771F\u306E\u80CC\u666F\u3067\u306F\u975E\u8868\u793A)",
  titleShow: "\u5E38\u306B\u8868\u793A",
  titleHide: "\u975E\u8868\u793A",
  secBackground: "\u80CC\u666F",
  secText: "\u6587\u5B57\u3068\u8272",
  secLayout: "\u30EC\u30A4\u30A2\u30A6\u30C8\u3068\u5F62",
  secWidgets: "\u30A6\u30A3\u30B8\u30A7\u30C3\u30C8",
  bgKind: "\u80CC\u666F\u306E\u7A2E\u985E",
  bgKindNone: "\u306A\u3057",
  bgKindImage: "\u5199\u771F",
  bgKindVideo: "\u52D5\u753B",
  bgVideo: "\u80CC\u666F\u52D5\u753B",
  bgVideoDesc: "\u3053\u306E\u7AEF\u672B\u304B\u3089 MP4 \u307E\u305F\u306F WebM \u306E\u52D5\u753B\u3092\u9078\u3073\u307E\u3059(\u6700\u5927 30 MB)\u3002\u30ED\u30C3\u30AF\u4E2D\u3060\u3051\u97F3\u306A\u3057\u3067\u30EB\u30FC\u30D7\u518D\u751F\u3055\u308C\u3001\u30D7\u30E9\u30B0\u30A4\u30F3\u30D5\u30A9\u30EB\u30C0\u306B\u4FDD\u5B58\u3055\u308C\u307E\u3059\u3002\u3069\u3053\u306B\u3082\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3055\u308C\u307E\u305B\u3093\u3002\u77ED\u3044\u30EB\u30FC\u30D7\u52D5\u753B\u304C\u3088\u304F\u5408\u3044\u307E\u3059\u3002",
  chooseVideo: "\u52D5\u753B\u3092\u9078\u629E",
  videoFailed: "\u3053\u306E\u52D5\u753B\u306F\u4F7F\u7528\u3067\u304D\u307E\u305B\u3093\u3002(\u518D\u751F\u53EF\u80FD\u306A MP4/WebM\u3001\u6700\u5927 30 MB)",
  animAurora: "\u30AA\u30FC\u30ED\u30E9",
  animFireflies: "\u86CD",
  animSnow: "\u96EA",
  textColor: "\u6587\u5B57\u8272",
  accentColor: "\u30A2\u30AF\u30BB\u30F3\u30C8\u8272",
  colorAuto: "\u81EA\u52D5(\u30C6\u30FC\u30DE\u3068\u80CC\u666F\u306B\u5408\u308F\u305B\u308B)",
  resetColor: "\u8272\u3092\u30EA\u30BB\u30C3\u30C8",
  clockSize: "\u6642\u8A08\u306E\u30B5\u30A4\u30BA",
  clockFont: "\u6642\u8A08\u306E\u30D5\u30A9\u30F3\u30C8",
  fontSans: "\u30B4\u30B7\u30C3\u30AF\u4F53",
  fontSerif: "\u660E\u671D\u4F53",
  fontMono: "\u7B49\u5E45",
  fontRounded: "\u4E38\u30B4\u30B7\u30C3\u30AF",
  clockWeight: "\u6642\u8A08\u306E\u592A\u3055",
  customTitle: "\u8868\u793A\u30C6\u30AD\u30B9\u30C8\u3092\u5165\u529B",
  customTitleDesc: "\u300C\u30ED\u30C3\u30AF\u3055\u308C\u3066\u3044\u307E\u3059\u300D\u306E\u4EE3\u308F\u308A\u306B\u8868\u793A\u3059\u308B\u30C6\u30AD\u30B9\u30C8\u3067\u3059\u3002\u7A7A\u6B04\u306E\u5834\u5408\u306F\u65E2\u5B9A\u306E\u30C6\u30AD\u30B9\u30C8\u3092\u4F7F\u3044\u307E\u3059\u3002",
  position: "\u7E26\u4F4D\u7F6E",
  posTop: "\u4E0A",
  posCenter: "\u4E2D\u592E",
  posBottom: "\u4E0B",
  fieldShape: "\u5165\u529B\u6B04\u3068\u30DC\u30BF\u30F3\u306E\u5F62",
  shapeRounded: "\u89D2\u4E38",
  shapePill: "\u30AB\u30D7\u30BB\u30EB\u578B",
  shapeSquare: "\u89D2\u3070\u3063\u305F\u5F62",
  showIcon: "\u30ED\u30C3\u30AF\u30A2\u30A4\u30B3\u30F3\u3092\u8868\u793A",
  resetAppearance: "\u30AB\u30B9\u30BF\u30DE\u30A4\u30BA\u3092\u30EA\u30BB\u30C3\u30C8",
  resetAppearanceDesc: "\u80CC\u666F\u306E\u7A2E\u985E\u3001\u8272\u3001\u30D5\u30A9\u30F3\u30C8\u3001\u30EC\u30A4\u30A2\u30A6\u30C8\u3001\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3\u3092\u521D\u671F\u5024\u306B\u623B\u3057\u307E\u3059\u3002\u30D1\u30B9\u30EF\u30FC\u30C9\u3001ToDo\u3001\u4FDD\u5B58\u6E08\u307F\u306E\u753B\u50CF\u30FB\u52D5\u753B\u30D5\u30A1\u30A4\u30EB\u306F\u305D\u306E\u307E\u307E\u6B8B\u308A\u307E\u3059\u3002",
  resetAppearanceBtn: "\u30EA\u30BB\u30C3\u30C8",
  theme: "\u30C6\u30FC\u30DE",
  themeDefault: "\u6A19\u6E96",
  themeWin95: "Windows 95",
  themeTerminal: "\u958B\u767A\u8005\u30BF\u30FC\u30DF\u30CA\u30EB",
  themeSnake: "\u643A\u5E2F\u30B2\u30FC\u30E0\u6A5F\u30B9\u30CD\u30FC\u30AF (\u30B2\u30FC\u30E0)",
  themeBreakout: "\u30A2\u30FC\u30B1\u30FC\u30C9\u30D6\u30ED\u30C3\u30AF\u5D29\u3057 (\u30B2\u30FC\u30E0)",
  themeRunner: "\u30AA\u30D6\u30B7\u30C7\u30A3\u30A2\u30F3\u30FB\u30E9\u30F3\u30CA\u30FC (\u30B2\u30FC\u30E0)",
  themeAuto: "\u30C6\u30FC\u30DE\u306E\u65E2\u5B9A",
  animGlow: "\u30AB\u30FC\u30BD\u30EB\u306E\u30B9\u30DD\u30C3\u30C8\u30E9\u30A4\u30C8",
  animTrail: "\u30AB\u30FC\u30BD\u30EB\u306E\u8ECC\u8DE1",
  animOrbs: "\u8FFD\u3044\u304B\u3051\u308B\u7403",
  unlocked: "\u30ED\u30C3\u30AF\u89E3\u9664\u3057\u307E\u3057\u305F",
  forgot: "\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u5FD8\u308C\u307E\u3057\u305F\u304B?",
  recoverPlaceholder: "\u5FA9\u65E7\u30AD\u30FC",
  recoverUnlock: "\u5FA9\u65E7\u30AD\u30FC\u3067\u89E3\u9664",
  backToPassword: "\u30D1\u30B9\u30EF\u30FC\u30C9\u3067\u89E3\u9664",
  modalReset: "\u65B0\u3057\u3044\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u8A2D\u5B9A",
  modalRecovery: "\u5FA9\u65E7\u30AD\u30FC\u3092\u4F5C\u6210",
  resetIntro: "\u5FA9\u65E7\u30AD\u30FC\u3067\u30ED\u30C3\u30AF\u3092\u89E3\u9664\u3057\u307E\u3057\u305F\u3002\u4ECA\u3059\u3050\u65B0\u3057\u3044\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u6C7A\u3081\u3066\u304F\u3060\u3055\u3044\u3002\u65B0\u3057\u3044\u5FA9\u65E7\u30AD\u30FC\u3082\u767A\u884C\u3055\u308C\u307E\u3059\u3002",
  recoveryKeyTitle: "\u5FA9\u65E7\u30AD\u30FC",
  recoveryKeyIntro: "\u3053\u306E\u30AD\u30FC\u3092\u66F8\u304D\u7559\u3081\u3066\u3001\u3053\u306E\u30B3\u30F3\u30D4\u30E5\u30FC\u30BF\u30FC\u304B\u3089\u96E2\u308C\u305F\u5B89\u5168\u306A\u5834\u6240\u306B\u4FDD\u7BA1\u3057\u3066\u304F\u3060\u3055\u3044\u3002\u8868\u793A\u306F\u4E00\u5EA6\u304D\u308A\u3067\u3001\u5F8C\u304B\u3089\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3002\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u5FD8\u308C\u305F\u3068\u304D\u306B\u3053\u306E\u30AD\u30FC\u3067\u753B\u9762\u3092\u89E3\u9664\u3067\u304D\u307E\u3059\u3002\u3053\u306E\u30AD\u30FC\u3092\u6301\u3064\u4EBA\u306F\u8AB0\u3067\u3082\u753B\u9762\u3092\u89E3\u9664\u3067\u304D\u307E\u3059\u3002",
  copyKey: "\u30B3\u30D4\u30FC",
  copied: "\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\u3002",
  keySaved: "\u4FDD\u5B58\u3057\u307E\u3057\u305F",
  recoveryRow: "\u5FA9\u65E7\u30AD\u30FC",
  recoveryOn: "\u8A2D\u5B9A\u6E08\u307F\u3002\u30ED\u30C3\u30AF\u753B\u9762\u306E\u300C\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u5FD8\u308C\u307E\u3057\u305F\u304B?\u300D\u304B\u3089\u4F7F\u3044\u307E\u3059\u3002",
  recoveryOff: "\u672A\u8A2D\u5B9A\u3002\u306A\u3044\u3068\u3001\u30D1\u30B9\u30EF\u30FC\u30C9\u3092\u5FD8\u308C\u305F\u3068\u304D\u306F data.json \u3092\u76F4\u63A5\u7DE8\u96C6\u3059\u308B\u3057\u304B\u3042\u308A\u307E\u305B\u3093\u3002",
  makeRecovery: "\u4F5C\u6210",
  renewRecovery: "\u65B0\u3057\u304F\u4F5C\u6210",
  logRecovered: "\u5FA9\u65E7\u30AD\u30FC\u3067\u89E3\u9664",
  hideScreen: "\u753B\u9762\u3092\u96A0\u3059(\u30D1\u30B9\u30EF\u30FC\u30C9\u306A\u3057)",
  hideHint: "\u30AF\u30EA\u30C3\u30AF\u3059\u308B\u304B Esc \u3092\u62BC\u3059\u3068\u753B\u9762\u304C\u5143\u306B\u623B\u308A\u307E\u3059\u3002",
  coverOnBlur: "\u30A6\u30A3\u30F3\u30C9\u30A6\u304C\u30D5\u30A9\u30FC\u30AB\u30B9\u3092\u5931\u3063\u305F\u3089\u96A0\u3059",
  coverOnBlurDesc: "\u30A6\u30A3\u30F3\u30C9\u30A6\u3092\u6700\u5C0F\u5316\u3057\u305F\u3068\u304D\u3060\u3051\u3067\u306A\u304F\u3001\u5225\u306E\u30A2\u30D7\u30EA\u304C\u524D\u9762\u306B\u6765\u305F\u6642\u70B9\u3067\u30CE\u30FC\u30C8\u3092\u96A0\u3057\u307E\u3059\u3002\u7336\u4E88\u6642\u9593\u5185\u306B\u623B\u308C\u3070\u30D1\u30B9\u30EF\u30FC\u30C9\u306F\u4E0D\u8981\u3067\u3059\u3002\u8A2D\u5B9A\u30A6\u30A3\u30F3\u30C9\u30A6\u306F\u96E2\u308C\u305F\u3068\u307F\u306A\u3057\u307E\u305B\u3093\u3002",
  lockOnSystemLock: "\u30B3\u30F3\u30D4\u30E5\u30FC\u30BF\u30FC\u306E\u30ED\u30C3\u30AF\u30FB\u30B9\u30EA\u30FC\u30D7\u6642\u306B\u30ED\u30C3\u30AF",
  lockOnSystemLockDesc: "\u30C7\u30B9\u30AF\u30C8\u30C3\u30D7\u5C02\u7528\u3002OS \u304C\u753B\u9762\u3092\u30ED\u30C3\u30AF\u3059\u308B\u304B\u30B9\u30EA\u30FC\u30D7\u306B\u5165\u308B\u3068\u30ED\u30C3\u30AF\u3057\u307E\u3059\u3002\u3053\u306E Obsidian \u306E\u30D3\u30EB\u30C9\u304C\u5BFE\u5FDC\u3057\u3066\u3044\u306A\u3044\u5834\u5408\u306F\u4F55\u3082\u8D77\u304D\u307E\u305B\u3093\u3002",
  deviceOnly: "\u3053\u306E\u7AEF\u672B\u3060\u3051\u306E\u8A2D\u5B9A",
  deviceOnlyDesc: "\u81EA\u52D5\u30ED\u30C3\u30AF\u6642\u9593\u3001\u30A2\u30D7\u30EA\u3092\u96E2\u308C\u305F\u3068\u304D\u306E\u8A2D\u5B9A\u3001\u30D5\u30A9\u30FC\u30AB\u30B9\u55AA\u5931\u6642\u306E\u975E\u8868\u793A\u3001\u30B7\u30B9\u30C6\u30E0\u30ED\u30C3\u30AF\u3001\u30A6\u30A3\u30F3\u30C9\u30A6\u7E2E\u5C0F\u3092\u3053\u306E\u7AEF\u672B\u306B\u3060\u3051\u4FDD\u5B58\u3057\u3001\u540C\u671F\u3057\u307E\u305B\u3093\u3002",
  logTitle: "\u6700\u8FD1\u306E\u8A18\u9332",
  logDesc: "\u3053\u306E\u30DC\u30FC\u30EB\u30C8\u3092\u540C\u671F\u3057\u3066\u3044\u308B\u7AEF\u672B\u3067\u306E\u76F4\u8FD150\u4EF6\u306E\u30ED\u30C3\u30AF\u3001\u89E3\u9664\u3001\u30D1\u30B9\u30EF\u30FC\u30C9\u8AA4\u308A\u3067\u3059\u3002\u6539\u3056\u3093\u9632\u6B62\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002data.json \u3092\u7DE8\u96C6\u3067\u304D\u308B\u4EBA\u306F\u3053\u306E\u8A18\u9332\u3082\u7DE8\u96C6\u3067\u304D\u307E\u3059\u3002",
  logEmpty: "\u307E\u3060\u8A18\u9332\u304C\u3042\u308A\u307E\u305B\u3093\u3002",
  logClear: "\u6D88\u53BB",
  logLocked: "\u30ED\u30C3\u30AF",
  logUnlocked: "\u89E3\u9664",
  logFailed: "\u30D1\u30B9\u30EF\u30FC\u30C9\u8AA4\u308A",
  reasonStartup: "\u8D77\u52D5\u6642",
  reasonIdle: "\u7121\u64CD\u4F5C",
  reasonLeft: "\u30A2\u30D7\u30EA\u3092\u96E2\u308C\u305F",
  reasonManual: "\u624B\u52D5",
  reasonSystem: "\u30B3\u30F3\u30D4\u30E5\u30FC\u30BF\u30FC\u306E\u30ED\u30C3\u30AF"
};
var ja_default = ja;

// src/i18n/zh.ts
var zh = {
  lockedTitle: "\u5DF2\u9501\u5B9A",
  placeholder: "\u5BC6\u7801",
  unlock: "\u89E3\u9501",
  checking: "\u9A8C\u8BC1\u4E2D\u2026",
  wrong: "\u5BC6\u7801\u4E0D\u6B63\u786E\u3002",
  wait: "\u8BF7\u5728 {n} \u79D2\u540E\u91CD\u8BD5\u3002",
  cryptoError: "\u5F53\u524D\u73AF\u5883\u65E0\u6CD5\u4F7F\u7528\u52A0\u5BC6\u529F\u80FD(WebCrypto),\u56E0\u6B64\u65E0\u6CD5\u9A8C\u8BC1\u5BC6\u7801\u3002",
  lockNow: "\u7ACB\u5373\u9501\u5B9A",
  noPassword: "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u8BBE\u7F6E\u5BC6\u7801\u3002",
  settingsInfo: "\u672C\u63D2\u4EF6\u662F\u5C4F\u5E55\u9501,\u4E0D\u4F1A\u52A0\u5BC6\u6587\u4EF6\u3002\u4E3A\u9632\u8BBE\u5907\u4E22\u5931,\u8BF7\u540C\u65F6\u542F\u7528 FileVault/BitLocker \u7B49\u78C1\u76D8\u52A0\u5BC6\u3002",
  password: "\u5BC6\u7801",
  passwordNotSet: "\u672A\u8BBE\u7F6E",
  passwordSet: "\u5DF2\u8BBE\u7F6E",
  setPassword: "\u8BBE\u7F6E",
  changePassword: "\u4FEE\u6539",
  removePassword: "\u79FB\u9664",
  lockOnStartup: "\u542F\u52A8\u65F6\u9501\u5B9A",
  idle: "\u95F2\u7F6E\u81EA\u52A8\u9501\u5B9A",
  idleOff: "\u5173\u95ED",
  minutes: "{n} \u5206\u949F",
  lockOnHide: "\u79BB\u5F00\u5E94\u7528\u65F6\u9501\u5B9A",
  lockOnHideDesc: "\u5207\u6362\u5230\u5176\u4ED6\u5E94\u7528\u6216\u6700\u5C0F\u5316\u7A97\u53E3\u65F6\u3002\u4F1A\u7ACB\u5373\u906E\u4F4F\u5185\u5BB9,\u907F\u514D\u7B14\u8BB0\u663E\u793A\u5728\u5E94\u7528\u5207\u6362\u754C\u9762\u4E2D\u3002",
  grace: "\u5BBD\u9650\u65F6\u95F4",
  graceDesc: "\u5728\u6B64\u65F6\u95F4\u5185\u8FD4\u56DE\u5219\u4E0D\u518D\u8981\u6C42\u8F93\u5165\u5BC6\u7801\u3002",
  immediately: "\u7ACB\u5373",
  seconds: "{n} \u79D2",
  modalSet: "\u8BBE\u7F6E\u5BC6\u7801",
  modalChange: "\u4FEE\u6539\u5BC6\u7801",
  modalRemove: "\u79FB\u9664\u5BC6\u7801",
  current: "\u5F53\u524D\u5BC6\u7801",
  newPw: "\u65B0\u5BC6\u7801",
  confirmPw: "\u786E\u8BA4\u65B0\u5BC6\u7801",
  save: "\u4FDD\u5B58",
  cancel: "\u53D6\u6D88",
  tooShort: "\u5BC6\u7801\u81F3\u5C11\u9700\u8981 {n} \u4E2A\u5B57\u7B26\u3002",
  mismatch: "\u4E24\u6B21\u8F93\u5165\u7684\u65B0\u5BC6\u7801\u4E0D\u4E00\u81F4\u3002",
  saved: "\u5BC6\u7801\u5DF2\u4FDD\u5B58\u3002",
  removed: "\u5BC6\u7801\u5DF2\u79FB\u9664\u3002",
  appearance: "\u81EA\u5B9A\u4E49\u9501\u5C4F",
  preview: "\u9884\u89C8",
  previewDesc: "\u65E0\u9700\u9501\u5B9A\u5373\u53EF\u67E5\u770B\u9501\u5C4F\u6548\u679C\u3002\u70B9\u51FB\u4EFB\u610F\u4F4D\u7F6E\u6216\u6309 Esc \u5173\u95ED\u3002",
  previewClose: "\u70B9\u51FB\u4EFB\u610F\u4F4D\u7F6E\u6216\u6309 Esc \u5173\u95ED",
  bgImage: "\u80CC\u666F\u56FE\u7247",
  bgImageDesc: "\u4ECE\u6B64\u8BBE\u5907\u9009\u62E9\u7167\u7247\u3002\u4F1A\u7F29\u5C0F\u540E\u4FDD\u5B58\u5728\u63D2\u4EF6\u6587\u4EF6\u5939\u4E2D,\u4E0D\u4F1A\u4E0A\u4F20\u5230\u4EFB\u4F55\u5730\u65B9\u3002",
  chooseImage: "\u9009\u62E9\u56FE\u7247",
  removeImage: "\u79FB\u9664",
  imageFailed: "\u65E0\u6CD5\u4F7F\u7528\u8BE5\u56FE\u7247\u3002",
  dim: "\u80CC\u666F\u53D8\u6697",
  blur: "\u80CC\u666F\u6A21\u7CCA",
  animation: "\u80CC\u666F\u52A8\u753B",
  animNone: "\u65E0",
  showClock: "\u663E\u793A\u65F6\u949F",
  showSeconds: "\u663E\u793A\u79D2",
  showDate: "\u663E\u793A\u65E5\u671F",
  clockFormat: "\u65F6\u95F4\u683C\u5F0F",
  fmtAuto: "\u81EA\u52A8",
  fmt24: "24 \u5C0F\u65F6\u5236",
  fmt12: "12 \u5C0F\u65F6\u5236",
  showTodos: "\u663E\u793A\u5F85\u529E\u6E05\u5355",
  showTodosDesc: "\u4EFB\u4F55\u4EBA\u65E0\u9700\u5BC6\u7801\u5373\u53EF\u67E5\u770B\u548C\u4FEE\u6539\u6B64\u6E05\u5355\u3002\u8BF7\u52FF\u5199\u5165\u654F\u611F\u5185\u5BB9\u3002",
  todoPlaceholder: "\u6DFB\u52A0\u5F85\u529E",
  todoAdd: "\u6DFB\u52A0",
  todoDelete: "\u5220\u9664",
  shrinkWindow: "\u9501\u5B9A\u65F6\u7F29\u5C0F\u7A97\u53E3",
  shrinkWindowDesc: "\u663E\u793A\u9501\u5C4F\u671F\u95F4\u4F1A\u7F29\u5C0F Obsidian \u7A97\u53E3,\u89E3\u9501\u540E\u6062\u590D\u539F\u6765\u7684\u5927\u5C0F\u548C\u4F4D\u7F6E\u3002\u4EC5\u9650\u684C\u9762\u7AEF\u3002\u5168\u5C4F\u6A21\u5F0F\u4E0B\u4E0D\u751F\u6548\u3002",
  lockWindowSize: "\u9501\u5B9A\u7A97\u53E3\u5927\u5C0F",
  hoverReveal: "\u60AC\u505C\u65F6\u624D\u663E\u793A\u5BC6\u7801\u8F93\u5165\u6846",
  hoverRevealDesc: "\u4E3A\u8BA9\u9501\u5C4F\u66F4\u7B80\u6D01\u800C\u9690\u85CF\u8F93\u5165\u6846\u3002\u5C06\u9F20\u6807\u79FB\u5230\u9501\u56FE\u6807\u533A\u57DF\u3001\u6309\u4EFB\u610F\u952E\u6216\u70B9\u6309\u65F6\u624D\u4F1A\u51FA\u73B0\u3002",
  showTitle: "\u663E\u793A\u201C\u5DF2\u9501\u5B9A\u201D\u6587\u5B57",
  titleAuto: "\u81EA\u52A8(\u7167\u7247\u80CC\u666F\u65F6\u9690\u85CF)",
  titleShow: "\u59CB\u7EC8\u663E\u793A",
  titleHide: "\u9690\u85CF",
  secBackground: "\u80CC\u666F",
  secText: "\u6587\u5B57\u4E0E\u989C\u8272",
  secLayout: "\u5E03\u5C40\u4E0E\u5F62\u72B6",
  secWidgets: "\u5C0F\u7EC4\u4EF6",
  bgKind: "\u80CC\u666F\u7C7B\u578B",
  bgKindNone: "\u65E0",
  bgKindImage: "\u7167\u7247",
  bgKindVideo: "\u89C6\u9891",
  bgVideo: "\u80CC\u666F\u89C6\u9891",
  bgVideoDesc: "\u4ECE\u6B64\u8BBE\u5907\u9009\u62E9 MP4 \u6216 WebM \u89C6\u9891(\u6700\u5927 30 MB)\u3002\u4EC5\u5728\u9501\u5B9A\u671F\u95F4\u9759\u97F3\u5FAA\u73AF\u64AD\u653E,\u5E76\u4FDD\u5B58\u5728\u63D2\u4EF6\u6587\u4EF6\u5939\u4E2D,\u4E0D\u4F1A\u4E0A\u4F20\u5230\u4EFB\u4F55\u5730\u65B9\u3002\u77ED\u5C0F\u7684\u5FAA\u73AF\u89C6\u9891\u6548\u679C\u6700\u4F73\u3002",
  chooseVideo: "\u9009\u62E9\u89C6\u9891",
  videoFailed: "\u65E0\u6CD5\u4F7F\u7528\u8BE5\u89C6\u9891\u3002(\u53EF\u64AD\u653E\u7684 MP4/WebM,\u6700\u5927 30 MB)",
  animAurora: "\u6781\u5149",
  animFireflies: "\u8424\u706B\u866B",
  animSnow: "\u98D8\u96EA",
  textColor: "\u6587\u5B57\u989C\u8272",
  accentColor: "\u5F3A\u8C03\u8272",
  colorAuto: "\u81EA\u52A8(\u8DDF\u968F\u4E3B\u9898\u548C\u80CC\u666F)",
  resetColor: "\u91CD\u7F6E\u989C\u8272",
  clockSize: "\u65F6\u949F\u5927\u5C0F",
  clockFont: "\u65F6\u949F\u5B57\u4F53",
  fontSans: "\u65E0\u886C\u7EBF\u4F53",
  fontSerif: "\u886C\u7EBF\u4F53",
  fontMono: "\u7B49\u5BBD\u5B57\u4F53",
  fontRounded: "\u5706\u4F53",
  clockWeight: "\u65F6\u949F\u5B57\u91CD",
  customTitle: "\u81EA\u5B9A\u4E49\u6587\u5B57",
  customTitleDesc: "\u7528\u6765\u66FF\u4EE3\u201C\u5DF2\u9501\u5B9A\u201D\u7684\u6587\u5B57\u3002\u7559\u7A7A\u5219\u4F7F\u7528\u9ED8\u8BA4\u6587\u5B57\u3002",
  position: "\u5782\u76F4\u4F4D\u7F6E",
  posTop: "\u9876\u90E8",
  posCenter: "\u5C45\u4E2D",
  posBottom: "\u5E95\u90E8",
  fieldShape: "\u8F93\u5165\u6846\u548C\u6309\u94AE\u5F62\u72B6",
  shapeRounded: "\u5706\u89D2",
  shapePill: "\u80F6\u56CA\u5F62",
  shapeSquare: "\u76F4\u89D2",
  showIcon: "\u663E\u793A\u9501\u56FE\u6807",
  resetAppearance: "\u91CD\u7F6E\u5916\u89C2",
  resetAppearanceDesc: "\u5C06\u80CC\u666F\u7C7B\u578B\u3001\u989C\u8272\u3001\u5B57\u4F53\u3001\u5E03\u5C40\u548C\u52A8\u753B\u6062\u590D\u4E3A\u9ED8\u8BA4\u503C\u3002\u5BC6\u7801\u3001\u5F85\u529E\u6E05\u5355\u4EE5\u53CA\u5DF2\u4FDD\u5B58\u7684\u56FE\u7247\u548C\u89C6\u9891\u6587\u4EF6\u4F1A\u4FDD\u7559\u3002",
  resetAppearanceBtn: "\u91CD\u7F6E",
  theme: "\u4E3B\u9898",
  themeDefault: "\u9ED8\u8BA4",
  themeWin95: "Windows 95",
  themeTerminal: "\u5F00\u53D1\u8005\u7EC8\u7AEF",
  themeSnake: "\u638C\u673A\u8D2A\u5403\u86C7 (\u6E38\u620F)",
  themeBreakout: "\u8857\u673A\u6253\u7816\u5757 (\u6E38\u620F)",
  themeRunner: "\u9ED1\u66DC\u77F3\u8DD1\u9177 (\u6E38\u620F)",
  themeAuto: "\u4E3B\u9898\u9ED8\u8BA4",
  animGlow: "\u9F20\u6807\u805A\u5149\u706F",
  animTrail: "\u9F20\u6807\u8F68\u8FF9",
  animOrbs: "\u8FFD\u968F\u5149\u7403",
  unlocked: "\u5DF2\u89E3\u9501",
  forgot: "\u5FD8\u8BB0\u5BC6\u7801?",
  recoverPlaceholder: "\u6062\u590D\u5BC6\u94A5",
  recoverUnlock: "\u7528\u6062\u590D\u5BC6\u94A5\u89E3\u9501",
  backToPassword: "\u6539\u7528\u5BC6\u7801\u89E3\u9501",
  modalReset: "\u8BBE\u7F6E\u65B0\u5BC6\u7801",
  modalRecovery: "\u521B\u5EFA\u6062\u590D\u5BC6\u94A5",
  resetIntro: "\u4F60\u5DF2\u7528\u6062\u590D\u5BC6\u94A5\u89E3\u9501\u3002\u8BF7\u73B0\u5728\u8BBE\u7F6E\u65B0\u5BC6\u7801,\u540C\u65F6\u4F1A\u751F\u6210\u65B0\u7684\u6062\u590D\u5BC6\u94A5\u3002",
  recoveryKeyTitle: "\u4F60\u7684\u6062\u590D\u5BC6\u94A5",
  recoveryKeyIntro: "\u8BF7\u6284\u4E0B\u8FD9\u4E2A\u5BC6\u94A5,\u4FDD\u5B58\u5728\u8FDC\u79BB\u8FD9\u53F0\u7535\u8111\u7684\u5B89\u5168\u5730\u65B9\u3002\u5B83\u53EA\u663E\u793A\u4E00\u6B21,\u4E4B\u540E\u65E0\u6CD5\u518D\u67E5\u770B\u3002\u5FD8\u8BB0\u5BC6\u7801\u65F6\u53EF\u7528\u5B83\u89E3\u9501\u5C4F\u5E55\u3002\u4EFB\u4F55\u62FF\u5230\u5B83\u7684\u4EBA\u90FD\u80FD\u89E3\u9501\u5C4F\u5E55\u3002",
  copyKey: "\u590D\u5236",
  copied: "\u5DF2\u590D\u5236\u3002",
  keySaved: "\u6211\u5DF2\u4FDD\u5B58",
  recoveryRow: "\u6062\u590D\u5BC6\u94A5",
  recoveryOn: "\u5DF2\u8BBE\u7F6E\u3002\u5728\u9501\u5C4F\u754C\u9762\u70B9\u51FB\u201C\u5FD8\u8BB0\u5BC6\u7801?\u201D\u4F7F\u7528\u3002",
  recoveryOff: "\u672A\u8BBE\u7F6E\u3002\u6CA1\u6709\u6062\u590D\u5BC6\u94A5\u65F6,\u5FD8\u8BB0\u5BC6\u7801\u53EA\u80FD\u76F4\u63A5\u7F16\u8F91 data.json\u3002",
  makeRecovery: "\u521B\u5EFA",
  renewRecovery: "\u91CD\u65B0\u521B\u5EFA",
  logRecovered: "\u5DF2\u7528\u6062\u590D\u5BC6\u94A5\u89E3\u9501",
  hideScreen: "\u9690\u85CF\u5C4F\u5E55(\u65E0\u9700\u5BC6\u7801)",
  hideHint: "\u70B9\u51FB\u6216\u6309 Esc \u5373\u53EF\u91CD\u65B0\u663E\u793A\u5C4F\u5E55\u3002",
  coverOnBlur: "\u7A97\u53E3\u5931\u53BB\u7126\u70B9\u65F6\u9690\u85CF",
  coverOnBlurDesc: "\u4E0D\u53EA\u662F\u6700\u5C0F\u5316\u7A97\u53E3\u65F6,\u53EA\u8981\u5176\u4ED6\u5E94\u7528\u4F4D\u4E8E\u524D\u53F0\u5C31\u4F1A\u906E\u4F4F\u7B14\u8BB0\u3002\u5728\u5BBD\u9650\u65F6\u95F4\u5185\u8FD4\u56DE\u65E0\u9700\u5BC6\u7801\u3002\u8BBE\u7F6E\u7A97\u53E3\u4E0D\u7B97\u79BB\u5F00\u3002",
  lockOnSystemLock: "\u7535\u8111\u9501\u5C4F\u6216\u7761\u7720\u65F6\u9501\u5B9A",
  lockOnSystemLockDesc: "\u4EC5\u9650\u684C\u9762\u7AEF\u3002\u64CD\u4F5C\u7CFB\u7EDF\u9501\u5C4F\u6216\u8FDB\u5165\u7761\u7720\u65F6\u9501\u5B9A\u3002\u5982\u679C\u6B64\u7248\u672C\u7684 Obsidian \u4E0D\u63D0\u4F9B\u8BE5\u529F\u80FD,\u5219\u4E0D\u8D77\u4F5C\u7528\u3002",
  deviceOnly: "\u6B64\u8BBE\u5907\u4F7F\u7528\u72EC\u7ACB\u8BBE\u7F6E",
  deviceOnlyDesc: "\u81EA\u52A8\u9501\u5B9A\u65F6\u95F4\u3001\u79BB\u5F00\u5E94\u7528\u7684\u9009\u9879\u3001\u5931\u53BB\u7126\u70B9\u65F6\u9690\u85CF\u3001\u7CFB\u7EDF\u9501\u5B9A\u548C\u7F29\u5C0F\u7A97\u53E3\u4EC5\u4FDD\u5B58\u5728\u6B64\u8BBE\u5907\u4E0A,\u4E0D\u4F1A\u540C\u6B65\u3002",
  logTitle: "\u6700\u8FD1\u8BB0\u5F55",
  logDesc: "\u540C\u6B65\u6B64\u5E93\u7684\u8BBE\u5907\u4E0A\u6700\u8FD1 50 \u6B21\u9501\u5B9A\u3001\u89E3\u9501\u548C\u5BC6\u7801\u9519\u8BEF\u3002\u65E0\u6CD5\u9632\u7BE1\u6539:\u80FD\u7F16\u8F91 data.json \u7684\u4EBA\u4E5F\u80FD\u7F16\u8F91\u8FD9\u4EFD\u8BB0\u5F55\u3002",
  logEmpty: "\u6682\u65E0\u8BB0\u5F55\u3002",
  logClear: "\u6E05\u9664",
  logLocked: "\u5DF2\u9501\u5B9A",
  logUnlocked: "\u5DF2\u89E3\u9501",
  logFailed: "\u5BC6\u7801\u9519\u8BEF",
  reasonStartup: "\u542F\u52A8",
  reasonIdle: "\u7A7A\u95F2",
  reasonLeft: "\u79BB\u5F00\u5E94\u7528",
  reasonManual: "\u624B\u52A8",
  reasonSystem: "\u7535\u8111\u9501\u5B9A"
};
var zh_default = zh;

// src/i18n/zh-tw.ts
var zhTW = {
  lockedTitle: "\u5DF2\u9396\u5B9A",
  placeholder: "\u5BC6\u78BC",
  unlock: "\u89E3\u9664\u9396\u5B9A",
  checking: "\u9A57\u8B49\u4E2D\u2026",
  wrong: "\u5BC6\u78BC\u4E0D\u6B63\u78BA\u3002",
  wait: "\u8ACB\u65BC {n} \u79D2\u5F8C\u518D\u8A66\u3002",
  cryptoError: "\u76EE\u524D\u74B0\u5883\u7121\u6CD5\u4F7F\u7528\u52A0\u5BC6\u529F\u80FD(WebCrypto),\u56E0\u6B64\u7121\u6CD5\u9A57\u8B49\u5BC6\u78BC\u3002",
  lockNow: "\u7ACB\u5373\u9396\u5B9A",
  noPassword: "\u8ACB\u5148\u5728\u8A2D\u5B9A\u4E2D\u8A2D\u5B9A\u5BC6\u78BC\u3002",
  settingsInfo: "\u6B64\u5916\u639B\u662F\u87A2\u5E55\u9396,\u4E0D\u6703\u52A0\u5BC6\u6A94\u6848\u3002\u70BA\u9632\u88DD\u7F6E\u907A\u5931,\u8ACB\u540C\u6642\u555F\u7528 FileVault/BitLocker \u7B49\u78C1\u789F\u52A0\u5BC6\u3002",
  password: "\u5BC6\u78BC",
  passwordNotSet: "\u672A\u8A2D\u5B9A",
  passwordSet: "\u5DF2\u8A2D\u5B9A",
  setPassword: "\u8A2D\u5B9A",
  changePassword: "\u8B8A\u66F4",
  removePassword: "\u79FB\u9664",
  lockOnStartup: "\u555F\u52D5\u6642\u9396\u5B9A",
  idle: "\u9592\u7F6E\u81EA\u52D5\u9396\u5B9A",
  idleOff: "\u95DC\u9589",
  minutes: "{n} \u5206\u9418",
  lockOnHide: "\u96E2\u958B\u61C9\u7528\u7A0B\u5F0F\u6642\u9396\u5B9A",
  lockOnHideDesc: "\u5207\u63DB\u5230\u5176\u4ED6\u61C9\u7528\u7A0B\u5F0F\u6216\u6700\u5C0F\u5316\u8996\u7A97\u6642\u3002\u6703\u7ACB\u5373\u906E\u4F4F\u5167\u5BB9,\u907F\u514D\u7B46\u8A18\u986F\u793A\u5728\u61C9\u7528\u7A0B\u5F0F\u5207\u63DB\u756B\u9762\u4E2D\u3002",
  grace: "\u5BEC\u9650\u6642\u9593",
  graceDesc: "\u5728\u6B64\u6642\u9593\u5167\u8FD4\u56DE\u5247\u4E0D\u518D\u8981\u6C42\u8F38\u5165\u5BC6\u78BC\u3002",
  immediately: "\u7ACB\u5373",
  seconds: "{n} \u79D2",
  modalSet: "\u8A2D\u5B9A\u5BC6\u78BC",
  modalChange: "\u8B8A\u66F4\u5BC6\u78BC",
  modalRemove: "\u79FB\u9664\u5BC6\u78BC",
  current: "\u76EE\u524D\u5BC6\u78BC",
  newPw: "\u65B0\u5BC6\u78BC",
  confirmPw: "\u78BA\u8A8D\u65B0\u5BC6\u78BC",
  save: "\u5132\u5B58",
  cancel: "\u53D6\u6D88",
  tooShort: "\u5BC6\u78BC\u81F3\u5C11\u9700\u8981 {n} \u500B\u5B57\u5143\u3002",
  mismatch: "\u5169\u6B21\u8F38\u5165\u7684\u65B0\u5BC6\u78BC\u4E0D\u4E00\u81F4\u3002",
  saved: "\u5BC6\u78BC\u5DF2\u5132\u5B58\u3002",
  removed: "\u5BC6\u78BC\u5DF2\u79FB\u9664\u3002",
  appearance: "\u81EA\u8A02\u9396\u5B9A\u756B\u9762",
  preview: "\u9810\u89BD",
  previewDesc: "\u4E0D\u9700\u9396\u5B9A\u5373\u53EF\u67E5\u770B\u9396\u5B9A\u756B\u9762\u3002\u9EDE\u64CA\u4EFB\u610F\u4F4D\u7F6E\u6216\u6309 Esc \u95DC\u9589\u3002",
  previewClose: "\u9EDE\u64CA\u4EFB\u610F\u4F4D\u7F6E\u6216\u6309 Esc \u95DC\u9589",
  bgImage: "\u80CC\u666F\u5716\u7247",
  bgImageDesc: "\u5F9E\u6B64\u88DD\u7F6E\u9078\u64C7\u7167\u7247\u3002\u6703\u7E2E\u5C0F\u5F8C\u5132\u5B58\u5728\u5916\u639B\u8CC7\u6599\u593E\u4E2D,\u4E0D\u6703\u4E0A\u50B3\u5230\u4EFB\u4F55\u5730\u65B9\u3002",
  chooseImage: "\u9078\u64C7\u5716\u7247",
  removeImage: "\u79FB\u9664",
  imageFailed: "\u7121\u6CD5\u4F7F\u7528\u8A72\u5716\u7247\u3002",
  dim: "\u80CC\u666F\u8B8A\u6697",
  blur: "\u80CC\u666F\u6A21\u7CCA",
  animation: "\u80CC\u666F\u52D5\u756B",
  animNone: "\u7121",
  showClock: "\u986F\u793A\u6642\u9418",
  showSeconds: "\u986F\u793A\u79D2\u6578",
  showDate: "\u986F\u793A\u65E5\u671F",
  clockFormat: "\u6642\u9593\u683C\u5F0F",
  fmtAuto: "\u81EA\u52D5",
  fmt24: "24 \u5C0F\u6642\u5236",
  fmt12: "12 \u5C0F\u6642\u5236",
  showTodos: "\u986F\u793A\u5F85\u8FA6\u6E05\u55AE",
  showTodosDesc: "\u4EFB\u4F55\u4EBA\u7121\u9700\u5BC6\u78BC\u5373\u53EF\u6AA2\u8996\u548C\u4FEE\u6539\u6B64\u6E05\u55AE\u3002\u8ACB\u52FF\u5BEB\u5165\u654F\u611F\u5167\u5BB9\u3002",
  todoPlaceholder: "\u65B0\u589E\u5F85\u8FA6",
  todoAdd: "\u65B0\u589E",
  todoDelete: "\u522A\u9664",
  shrinkWindow: "\u9396\u5B9A\u6642\u7E2E\u5C0F\u8996\u7A97",
  shrinkWindowDesc: "\u986F\u793A\u9396\u5B9A\u756B\u9762\u671F\u9593\u6703\u7E2E\u5C0F Obsidian \u8996\u7A97,\u89E3\u9396\u5F8C\u6062\u5FA9\u539F\u672C\u7684\u5927\u5C0F\u548C\u4F4D\u7F6E\u3002\u50C5\u9650\u684C\u9762\u7248\u3002\u5168\u87A2\u5E55\u6A21\u5F0F\u4E0B\u4E0D\u751F\u6548\u3002",
  lockWindowSize: "\u9396\u5B9A\u8996\u7A97\u5927\u5C0F",
  hoverReveal: "\u61F8\u505C\u6642\u624D\u986F\u793A\u5BC6\u78BC\u8F38\u5165\u6846",
  hoverRevealDesc: "\u70BA\u8B93\u9396\u5B9A\u756B\u9762\u66F4\u7C21\u6F54\u800C\u96B1\u85CF\u8F38\u5165\u6846\u3002\u5C07\u6ED1\u9F20\u79FB\u5230\u9396\u982D\u5716\u793A\u5340\u57DF\u3001\u6309\u4EFB\u610F\u9375\u6216\u9EDE\u4E00\u4E0B\u6642\u624D\u6703\u51FA\u73FE\u3002",
  showTitle: "\u986F\u793A\u300C\u5DF2\u9396\u5B9A\u300D\u6587\u5B57",
  titleAuto: "\u81EA\u52D5(\u7167\u7247\u80CC\u666F\u6642\u96B1\u85CF)",
  titleShow: "\u4E00\u5F8B\u986F\u793A",
  titleHide: "\u96B1\u85CF",
  secBackground: "\u80CC\u666F",
  secText: "\u6587\u5B57\u8207\u984F\u8272",
  secLayout: "\u7248\u9762\u8207\u5F62\u72C0",
  secWidgets: "\u5C0F\u5DE5\u5177",
  bgKind: "\u80CC\u666F\u985E\u578B",
  bgKindNone: "\u7121",
  bgKindImage: "\u7167\u7247",
  bgKindVideo: "\u5F71\u7247",
  bgVideo: "\u80CC\u666F\u5F71\u7247",
  bgVideoDesc: "\u5F9E\u6B64\u88DD\u7F6E\u9078\u64C7 MP4 \u6216 WebM \u5F71\u7247(\u6700\u5927 30 MB)\u3002\u50C5\u5728\u9396\u5B9A\u671F\u9593\u975C\u97F3\u5FAA\u74B0\u64AD\u653E,\u4E26\u5132\u5B58\u5728\u5916\u639B\u8CC7\u6599\u593E\u4E2D,\u4E0D\u6703\u4E0A\u50B3\u5230\u4EFB\u4F55\u5730\u65B9\u3002\u7C21\u77ED\u7684\u5FAA\u74B0\u5F71\u7247\u6548\u679C\u6700\u4F73\u3002",
  chooseVideo: "\u9078\u64C7\u5F71\u7247",
  videoFailed: "\u7121\u6CD5\u4F7F\u7528\u8A72\u5F71\u7247\u3002(\u53EF\u64AD\u653E\u7684 MP4/WebM,\u6700\u5927 30 MB)",
  animAurora: "\u6975\u5149",
  animFireflies: "\u87A2\u706B\u87F2",
  animSnow: "\u98C4\u96EA",
  textColor: "\u6587\u5B57\u984F\u8272",
  accentColor: "\u5F37\u8ABF\u8272",
  colorAuto: "\u81EA\u52D5(\u8DDF\u96A8\u4E3B\u984C\u548C\u80CC\u666F)",
  resetColor: "\u91CD\u8A2D\u984F\u8272",
  clockSize: "\u6642\u9418\u5927\u5C0F",
  clockFont: "\u6642\u9418\u5B57\u578B",
  fontSans: "\u7121\u896F\u7DDA\u9AD4",
  fontSerif: "\u896F\u7DDA\u9AD4",
  fontMono: "\u7B49\u5BEC\u5B57\u578B",
  fontRounded: "\u5713\u9AD4",
  clockWeight: "\u6642\u9418\u5B57\u91CD",
  customTitle: "\u81EA\u8A02\u6587\u5B57",
  customTitleDesc: "\u7528\u4F86\u53D6\u4EE3\u300C\u5DF2\u9396\u5B9A\u300D\u7684\u6587\u5B57\u3002\u7559\u7A7A\u5247\u4F7F\u7528\u9810\u8A2D\u6587\u5B57\u3002",
  position: "\u5782\u76F4\u4F4D\u7F6E",
  posTop: "\u9802\u90E8",
  posCenter: "\u7F6E\u4E2D",
  posBottom: "\u5E95\u90E8",
  fieldShape: "\u8F38\u5165\u6846\u8207\u6309\u9215\u5F62\u72C0",
  shapeRounded: "\u5713\u89D2",
  shapePill: "\u81A0\u56CA\u5F62",
  shapeSquare: "\u76F4\u89D2",
  showIcon: "\u986F\u793A\u9396\u982D\u5716\u793A",
  resetAppearance: "\u91CD\u8A2D\u5916\u89C0",
  resetAppearanceDesc: "\u5C07\u80CC\u666F\u985E\u578B\u3001\u984F\u8272\u3001\u5B57\u578B\u3001\u7248\u9762\u548C\u52D5\u756B\u6062\u5FA9\u70BA\u9810\u8A2D\u503C\u3002\u5BC6\u78BC\u3001\u5F85\u8FA6\u6E05\u55AE\u4EE5\u53CA\u5DF2\u5132\u5B58\u7684\u5716\u7247\u548C\u5F71\u7247\u6A94\u6848\u6703\u4FDD\u7559\u3002",
  resetAppearanceBtn: "\u91CD\u8A2D",
  theme: "\u4E3B\u984C",
  themeDefault: "\u9810\u8A2D",
  themeWin95: "Windows 95",
  themeTerminal: "\u958B\u767C\u8005\u7D42\u7AEF\u6A5F",
  themeSnake: "\u638C\u6A5F\u8CAA\u98DF\u86C7 (\u904A\u6232)",
  themeBreakout: "\u8857\u6A5F\u6253\u78DA\u584A (\u904A\u6232)",
  themeRunner: "\u9ED1\u66DC\u77F3\u8DD1\u9177 (\u904A\u6232)",
  themeAuto: "\u4E3B\u984C\u9810\u8A2D",
  animGlow: "\u6ED1\u9F20\u805A\u5149\u71C8",
  animTrail: "\u6ED1\u9F20\u8ECC\u8DE1",
  animOrbs: "\u8FFD\u96A8\u5149\u7403",
  unlocked: "\u5DF2\u89E3\u9396",
  forgot: "\u5FD8\u8A18\u5BC6\u78BC?",
  recoverPlaceholder: "\u5FA9\u539F\u91D1\u9470",
  recoverUnlock: "\u7528\u5FA9\u539F\u91D1\u9470\u89E3\u9396",
  backToPassword: "\u6539\u7528\u5BC6\u78BC\u89E3\u9396",
  modalReset: "\u8A2D\u5B9A\u65B0\u5BC6\u78BC",
  modalRecovery: "\u5EFA\u7ACB\u5FA9\u539F\u91D1\u9470",
  resetIntro: "\u4F60\u5DF2\u7528\u5FA9\u539F\u91D1\u9470\u89E3\u9396\u3002\u8ACB\u73FE\u5728\u8A2D\u5B9A\u65B0\u5BC6\u78BC,\u540C\u6642\u6703\u7522\u751F\u65B0\u7684\u5FA9\u539F\u91D1\u9470\u3002",
  recoveryKeyTitle: "\u4F60\u7684\u5FA9\u539F\u91D1\u9470",
  recoveryKeyIntro: "\u8ACB\u6284\u4E0B\u9019\u500B\u91D1\u9470,\u4FDD\u5B58\u5728\u9060\u96E2\u9019\u53F0\u96FB\u8166\u7684\u5B89\u5168\u5730\u65B9\u3002\u5B83\u53EA\u986F\u793A\u4E00\u6B21,\u4E4B\u5F8C\u7121\u6CD5\u518D\u67E5\u770B\u3002\u5FD8\u8A18\u5BC6\u78BC\u6642\u53EF\u7528\u5B83\u89E3\u9396\u87A2\u5E55\u3002\u4EFB\u4F55\u62FF\u5230\u5B83\u7684\u4EBA\u90FD\u80FD\u89E3\u9396\u87A2\u5E55\u3002",
  copyKey: "\u8907\u88FD",
  copied: "\u5DF2\u8907\u88FD\u3002",
  keySaved: "\u6211\u5DF2\u5132\u5B58",
  recoveryRow: "\u5FA9\u539F\u91D1\u9470",
  recoveryOn: "\u5DF2\u8A2D\u5B9A\u3002\u5728\u9396\u5B9A\u756B\u9762\u9EDE\u9078\u300C\u5FD8\u8A18\u5BC6\u78BC?\u300D\u4F7F\u7528\u3002",
  recoveryOff: "\u672A\u8A2D\u5B9A\u3002\u6C92\u6709\u5FA9\u539F\u91D1\u9470\u6642,\u5FD8\u8A18\u5BC6\u78BC\u53EA\u80FD\u76F4\u63A5\u7DE8\u8F2F data.json\u3002",
  makeRecovery: "\u5EFA\u7ACB",
  renewRecovery: "\u91CD\u65B0\u5EFA\u7ACB",
  logRecovered: "\u5DF2\u7528\u5FA9\u539F\u91D1\u9470\u89E3\u9396",
  hideScreen: "\u96B1\u85CF\u87A2\u5E55(\u4E0D\u9700\u5BC6\u78BC)",
  hideHint: "\u9EDE\u64CA\u6216\u6309 Esc \u5373\u53EF\u91CD\u65B0\u986F\u793A\u87A2\u5E55\u3002",
  coverOnBlur: "\u8996\u7A97\u5931\u53BB\u7126\u9EDE\u6642\u96B1\u85CF",
  coverOnBlurDesc: "\u4E0D\u53EA\u662F\u6700\u5C0F\u5316\u8996\u7A97\u6642,\u53EA\u8981\u5176\u4ED6\u61C9\u7528\u7A0B\u5F0F\u4F4D\u65BC\u524D\u666F\u5C31\u6703\u906E\u4F4F\u7B46\u8A18\u3002\u5728\u5BEC\u9650\u6642\u9593\u5167\u8FD4\u56DE\u4E0D\u9700\u5BC6\u78BC\u3002\u8A2D\u5B9A\u8996\u7A97\u4E0D\u7B97\u96E2\u958B\u3002",
  lockOnSystemLock: "\u96FB\u8166\u9396\u5B9A\u6216\u7761\u7720\u6642\u9396\u5B9A",
  lockOnSystemLockDesc: "\u50C5\u9650\u684C\u9762\u7248\u3002\u4F5C\u696D\u7CFB\u7D71\u9396\u5B9A\u87A2\u5E55\u6216\u9032\u5165\u7761\u7720\u6642\u9396\u5B9A\u3002\u5982\u679C\u6B64\u7248\u672C\u7684 Obsidian \u672A\u63D0\u4F9B\u8A72\u529F\u80FD,\u5247\u4E0D\u6703\u4F5C\u7528\u3002",
  deviceOnly: "\u6B64\u88DD\u7F6E\u4F7F\u7528\u7368\u7ACB\u8A2D\u5B9A",
  deviceOnlyDesc: "\u81EA\u52D5\u9396\u5B9A\u6642\u9593\u3001\u96E2\u958B\u61C9\u7528\u7A0B\u5F0F\u7684\u9078\u9805\u3001\u5931\u53BB\u7126\u9EDE\u6642\u96B1\u85CF\u3001\u7CFB\u7D71\u9396\u5B9A\u8207\u7E2E\u5C0F\u8996\u7A97\u53EA\u5132\u5B58\u5728\u6B64\u88DD\u7F6E\u4E0A,\u4E0D\u6703\u540C\u6B65\u3002",
  logTitle: "\u6700\u8FD1\u7D00\u9304",
  logDesc: "\u540C\u6B65\u6B64\u4FDD\u7BA1\u5EAB\u7684\u88DD\u7F6E\u4E0A\u6700\u8FD1 50 \u6B21\u9396\u5B9A\u3001\u89E3\u9396\u8207\u5BC6\u78BC\u932F\u8AA4\u3002\u7121\u6CD5\u9632\u7AC4\u6539:\u80FD\u7DE8\u8F2F data.json \u7684\u4EBA\u4E5F\u80FD\u7DE8\u8F2F\u9019\u4EFD\u7D00\u9304\u3002",
  logEmpty: "\u5C1A\u7121\u7D00\u9304\u3002",
  logClear: "\u6E05\u9664",
  logLocked: "\u5DF2\u9396\u5B9A",
  logUnlocked: "\u5DF2\u89E3\u9396",
  logFailed: "\u5BC6\u78BC\u932F\u8AA4",
  reasonStartup: "\u555F\u52D5",
  reasonIdle: "\u9592\u7F6E",
  reasonLeft: "\u96E2\u958B\u61C9\u7528\u7A0B\u5F0F",
  reasonManual: "\u624B\u52D5",
  reasonSystem: "\u96FB\u8166\u9396\u5B9A"
};
var zh_tw_default = zhTW;

// src/i18n/es.ts
var es = {
  lockedTitle: "Bloqueado",
  placeholder: "Contrase\xF1a",
  unlock: "Desbloquear",
  checking: "Comprobando\u2026",
  wrong: "Contrase\xF1a incorrecta.",
  wait: "Int\xE9ntalo de nuevo en {n} s.",
  cryptoError: "WebCrypto no est\xE1 disponible aqu\xED, por lo que no se puede verificar la contrase\xF1a.",
  lockNow: "Bloquear ahora",
  noPassword: "Primero establece una contrase\xF1a en los ajustes.",
  settingsInfo: "Este complemento es un bloqueo de pantalla. No cifra los archivos, as\xED que usa tambi\xE9n cifrado de disco (FileVault/BitLocker) por si pierdes el dispositivo.",
  password: "Contrase\xF1a",
  passwordNotSet: "Sin establecer",
  passwordSet: "Establecida",
  setPassword: "Establecer",
  changePassword: "Cambiar",
  removePassword: "Quitar",
  lockOnStartup: "Bloquear al iniciar",
  idle: "Bloqueo autom\xE1tico por inactividad",
  idleOff: "Desactivado",
  minutes: "{n} min",
  lockOnHide: "Bloquear al salir de la app",
  lockOnHideDesc: "Al cambiar de app o minimizar la ventana. Se cubre el contenido al instante para que la nota no se vea en el selector de apps.",
  grace: "Periodo de gracia",
  graceDesc: "No se pide la contrase\xF1a si vuelves dentro de este tiempo.",
  immediately: "Inmediatamente",
  seconds: "{n} s",
  modalSet: "Establecer contrase\xF1a",
  modalChange: "Cambiar contrase\xF1a",
  modalRemove: "Quitar contrase\xF1a",
  current: "Contrase\xF1a actual",
  newPw: "Nueva contrase\xF1a",
  confirmPw: "Confirmar nueva contrase\xF1a",
  save: "Guardar",
  cancel: "Cancelar",
  tooShort: "La contrase\xF1a debe tener al menos {n} caracteres.",
  mismatch: "Las nuevas contrase\xF1as no coinciden.",
  saved: "Contrase\xF1a guardada.",
  removed: "Contrase\xF1a eliminada.",
  appearance: "Personalizar pantalla de bloqueo",
  preview: "Vista previa",
  previewDesc: "Mira la pantalla de bloqueo sin bloquear. Haz clic en cualquier lugar o pulsa Esc para cerrar.",
  previewClose: "Haz clic en cualquier lugar o pulsa Esc para cerrar",
  bgImage: "Imagen de fondo",
  bgImageDesc: "Elige una foto de este dispositivo. Se reduce y se guarda en la carpeta del complemento; no se sube a ning\xFAn sitio.",
  chooseImage: "Elegir imagen",
  removeImage: "Quitar",
  imageFailed: "No se pudo usar esa imagen.",
  dim: "Oscurecer fondo",
  blur: "Desenfocar fondo",
  animation: "Animaci\xF3n de fondo",
  animNone: "Ninguna",
  showClock: "Mostrar reloj",
  showSeconds: "Mostrar segundos",
  showDate: "Mostrar fecha",
  clockFormat: "Formato de hora",
  fmtAuto: "Autom\xE1tico",
  fmt24: "24 horas",
  fmt12: "12 horas",
  showTodos: "Mostrar lista de tareas",
  showTodosDesc: "Cualquiera puede ver y editar esta lista sin la contrase\xF1a. No escribas nada sensible.",
  todoPlaceholder: "A\xF1adir tarea",
  todoAdd: "A\xF1adir",
  todoDelete: "Eliminar",
  shrinkWindow: "Reducir la ventana al bloquear",
  shrinkWindowDesc: "Mientras se muestra la pantalla de bloqueo, la ventana de Obsidian se reduce; al desbloquear vuelve a su tama\xF1o y posici\xF3n anteriores. Solo en escritorio. No se aplica en pantalla completa.",
  lockWindowSize: "Tama\xF1o de la ventana bloqueada",
  hoverReveal: "Ocultar el campo de contrase\xF1a hasta pasar el cursor",
  hoverRevealDesc: "Mantiene limpia la pantalla de bloqueo: el campo aparece al pasar el cursor sobre la zona del candado, pulsar cualquier tecla o tocar.",
  showTitle: "Mostrar el texto \xABBloqueado\xBB",
  titleAuto: "Autom\xE1tico (oculto sobre una foto)",
  titleShow: "Mostrar siempre",
  titleHide: "Ocultar",
  secBackground: "Fondo",
  secText: "Texto y colores",
  secLayout: "Dise\xF1o y forma",
  secWidgets: "Widgets",
  bgKind: "Tipo de fondo",
  bgKindNone: "Ninguno",
  bgKindImage: "Foto",
  bgKindVideo: "V\xEDdeo",
  bgVideo: "V\xEDdeo de fondo",
  bgVideoDesc: "Elige un clip MP4 o WebM de este dispositivo (hasta 30 MB). Se reproduce sin sonido y en bucle solo mientras est\xE1 bloqueado, y se guarda en la carpeta del complemento; no se sube a ning\xFAn sitio. Los clips cortos en bucle quedan muy bien.",
  chooseVideo: "Elegir v\xEDdeo",
  videoFailed: "No se pudo usar ese v\xEDdeo (MP4/WebM reproducible, hasta 30 MB).",
  animAurora: "Aurora",
  animFireflies: "Luci\xE9rnagas",
  animSnow: "Nieve",
  textColor: "Color del texto",
  accentColor: "Color de acento",
  colorAuto: "Autom\xE1tico (sigue el tema y el fondo)",
  resetColor: "Restablecer color",
  clockSize: "Tama\xF1o del reloj",
  clockFont: "Fuente del reloj",
  fontSans: "Sans serif",
  fontSerif: "Serif",
  fontMono: "Monoespaciada",
  fontRounded: "Redondeada",
  clockWeight: "Grosor del reloj",
  customTitle: "Texto personalizado",
  customTitleDesc: "Sustituye al texto \xABBloqueado\xBB. D\xE9jalo vac\xEDo para usar el texto predeterminado.",
  position: "Posici\xF3n vertical",
  posTop: "Arriba",
  posCenter: "Centro",
  posBottom: "Abajo",
  fieldShape: "Forma del campo y el bot\xF3n",
  shapeRounded: "Redondeada",
  shapePill: "P\xEDldora",
  shapeSquare: "Cuadrada",
  showIcon: "Mostrar icono de candado",
  resetAppearance: "Restablecer apariencia",
  resetAppearanceDesc: "Restablece el tipo de fondo, los colores, las fuentes, el dise\xF1o y la animaci\xF3n. La contrase\xF1a, las tareas y los archivos de imagen/v\xEDdeo guardados se conservan.",
  resetAppearanceBtn: "Restablecer",
  theme: "Tema",
  themeDefault: "Predeterminado",
  themeWin95: "Windows 95",
  themeTerminal: "Terminal de desarrollo",
  themeSnake: "Serpiente port\xE1til (juego)",
  themeBreakout: "Arcade rompe-bloques (juego)",
  themeRunner: "Obsidian Runner (juego)",
  themeAuto: "Predeterminada del tema",
  animGlow: "Foco que sigue al cursor",
  animTrail: "Estela del cursor",
  animOrbs: "Esferas perseguidoras",
  unlocked: "Desbloqueado",
  forgot: "\xBFOlvidaste la contrase\xF1a?",
  recoverPlaceholder: "Clave de recuperaci\xF3n",
  recoverUnlock: "Desbloquear con la clave de recuperaci\xF3n",
  backToPassword: "Usar la contrase\xF1a",
  modalReset: "Establecer una contrase\xF1a nueva",
  modalRecovery: "Crear una clave de recuperaci\xF3n",
  resetIntro: "Has desbloqueado con la clave de recuperaci\xF3n. Elige ahora una contrase\xF1a nueva. Tambi\xE9n recibir\xE1s una clave de recuperaci\xF3n nueva.",
  recoveryKeyTitle: "Tu clave de recuperaci\xF3n",
  recoveryKeyIntro: "Anota esta clave y gu\xE1rdala en un lugar seguro, lejos de este equipo. Solo se muestra una vez y no se puede consultar despu\xE9s. Si olvidas la contrase\xF1a, desbloquea la pantalla. Cualquiera que la tenga puede desbloquear la pantalla.",
  copyKey: "Copiar",
  copied: "Copiada.",
  keySaved: "Ya la guard\xE9",
  recoveryRow: "Clave de recuperaci\xF3n",
  recoveryOn: "Establecida. \xDAsala en \u201C\xBFOlvidaste la contrase\xF1a?\u201D de la pantalla de bloqueo.",
  recoveryOff: "No establecida. Sin ella, una contrase\xF1a olvidada solo se arregla editando data.json.",
  makeRecovery: "Crear",
  renewRecovery: "Crear nueva",
  logRecovered: "Desbloqueado con la clave de recuperaci\xF3n",
  hideScreen: "Ocultar pantalla (sin contrase\xF1a)",
  hideHint: "Haz clic o pulsa Esc para volver a mostrar la pantalla.",
  coverOnBlur: "Ocultar al perder el foco la ventana",
  coverOnBlurDesc: "Oculta las notas en cuanto otra aplicaci\xF3n pasa al frente, no solo al minimizar la ventana. Si vuelves dentro del periodo de gracia no se pide contrase\xF1a. La ventana de Ajustes no cuenta como salir.",
  lockOnSystemLock: "Bloquear al bloquearse o suspenderse el equipo",
  lockOnSystemLockDesc: "Solo escritorio. Bloquea cuando el sistema operativo bloquea la pantalla o entra en suspensi\xF3n. No hace nada si esta versi\xF3n de Obsidian no lo ofrece.",
  deviceOnly: "Ajustes propios de este dispositivo",
  deviceOnlyDesc: "El tiempo de bloqueo autom\xE1tico, las opciones al salir de la aplicaci\xF3n, ocultar al perder el foco, el bloqueo del sistema y reducir la ventana se guardan solo en este dispositivo y no se sincronizan.",
  logTitle: "Actividad reciente",
  logDesc: "Los \xFAltimos 50 bloqueos, desbloqueos y contrase\xF1as incorrectas en los dispositivos que sincronizan esta b\xF3veda. No es a prueba de manipulaci\xF3n: quien pueda editar data.json puede editarlo.",
  logEmpty: "A\xFAn no hay registros.",
  logClear: "Borrar",
  logLocked: "Bloqueado",
  logUnlocked: "Desbloqueado",
  logFailed: "Contrase\xF1a incorrecta",
  reasonStartup: "inicio",
  reasonIdle: "inactividad",
  reasonLeft: "sali\xF3 de la aplicaci\xF3n",
  reasonManual: "manual",
  reasonSystem: "equipo bloqueado"
};
var es_default = es;

// src/i18n/fr.ts
var fr = {
  lockedTitle: "Verrouill\xE9",
  placeholder: "Mot de passe",
  unlock: "D\xE9verrouiller",
  checking: "V\xE9rification\u2026",
  wrong: "Mot de passe incorrect.",
  wait: "R\xE9essayez dans {n} s.",
  cryptoError: "WebCrypto n'est pas disponible ici : impossible de v\xE9rifier le mot de passe.",
  lockNow: "Verrouiller maintenant",
  noPassword: "D\xE9finissez d'abord un mot de passe dans les r\xE9glages.",
  settingsInfo: "Ce plugin est un verrouillage d'\xE9cran. Il ne chiffre pas les fichiers : utilisez aussi le chiffrement du disque (FileVault/BitLocker) en cas de perte de l'appareil.",
  password: "Mot de passe",
  passwordNotSet: "Non d\xE9fini",
  passwordSet: "D\xE9fini",
  setPassword: "D\xE9finir",
  changePassword: "Modifier",
  removePassword: "Supprimer",
  lockOnStartup: "Verrouiller au d\xE9marrage",
  idle: "Verrouillage automatique apr\xE8s inactivit\xE9",
  idleOff: "D\xE9sactiv\xE9",
  minutes: "{n} min",
  lockOnHide: "Verrouiller en quittant l'app",
  lockOnHideDesc: "Lors d'un changement d'app ou de la r\xE9duction de la fen\xEAtre. Le contenu est masqu\xE9 imm\xE9diatement pour ne pas appara\xEEtre dans le s\xE9lecteur d'apps.",
  grace: "D\xE9lai de gr\xE2ce",
  graceDesc: "Aucun mot de passe demand\xE9 si vous revenez dans ce d\xE9lai.",
  immediately: "Imm\xE9diatement",
  seconds: "{n} s",
  modalSet: "D\xE9finir le mot de passe",
  modalChange: "Modifier le mot de passe",
  modalRemove: "Supprimer le mot de passe",
  current: "Mot de passe actuel",
  newPw: "Nouveau mot de passe",
  confirmPw: "Confirmer le nouveau mot de passe",
  save: "Enregistrer",
  cancel: "Annuler",
  tooShort: "Le mot de passe doit contenir au moins {n} caract\xE8res.",
  mismatch: "Les nouveaux mots de passe ne correspondent pas.",
  saved: "Mot de passe enregistr\xE9.",
  removed: "Mot de passe supprim\xE9.",
  appearance: "Personnaliser l'\xE9cran de verrouillage",
  preview: "Aper\xE7u",
  previewDesc: "Voir l'\xE9cran de verrouillage sans verrouiller. Cliquez n'importe o\xF9 ou appuyez sur \xC9chap pour fermer.",
  previewClose: "Cliquez n'importe o\xF9 ou appuyez sur \xC9chap pour fermer",
  bgImage: "Image d'arri\xE8re-plan",
  bgImageDesc: "Choisissez une photo sur cet appareil. Elle est r\xE9duite et stock\xE9e dans le dossier du plugin ; rien n'est envoy\xE9 en ligne.",
  chooseImage: "Choisir une image",
  removeImage: "Retirer",
  imageFailed: "Impossible d'utiliser cette image.",
  dim: "Assombrir l'arri\xE8re-plan",
  blur: "Flouter l'arri\xE8re-plan",
  animation: "Animation d'arri\xE8re-plan",
  animNone: "Aucune",
  showClock: "Afficher l'horloge",
  showSeconds: "Afficher les secondes",
  showDate: "Afficher la date",
  clockFormat: "Format de l'heure",
  fmtAuto: "Auto",
  fmt24: "24 heures",
  fmt12: "12 heures",
  showTodos: "Afficher la liste de t\xE2ches",
  showTodosDesc: "N'importe qui peut voir et modifier cette liste sans le mot de passe. N'y \xE9crivez rien de sensible.",
  todoPlaceholder: "Ajouter une t\xE2che",
  todoAdd: "Ajouter",
  todoDelete: "Supprimer",
  shrinkWindow: "R\xE9duire la fen\xEAtre pendant le verrouillage",
  shrinkWindowDesc: "Tant que l'\xE9cran de verrouillage est affich\xE9, la fen\xEAtre d'Obsidian est r\xE9duite ; au d\xE9verrouillage, elle retrouve sa taille et sa position d'origine. Bureau uniquement. Sans effet en plein \xE9cran.",
  lockWindowSize: "Taille de la fen\xEAtre verrouill\xE9e",
  hoverReveal: "Masquer le champ du mot de passe jusqu'au survol",
  hoverRevealDesc: "Garde l'\xE9cran de verrouillage \xE9pur\xE9 : le champ appara\xEEt au survol de la zone du cadenas, en appuyant sur une touche ou en touchant l'\xE9cran.",
  showTitle: "Afficher le texte \xAB Verrouill\xE9 \xBB",
  titleAuto: "Auto (masqu\xE9 sur une photo)",
  titleShow: "Toujours afficher",
  titleHide: "Masquer",
  secBackground: "Arri\xE8re-plan",
  secText: "Texte et couleurs",
  secLayout: "Disposition et forme",
  secWidgets: "Widgets",
  bgKind: "Type d'arri\xE8re-plan",
  bgKindNone: "Aucun",
  bgKindImage: "Photo",
  bgKindVideo: "Vid\xE9o",
  bgVideo: "Vid\xE9o d'arri\xE8re-plan",
  bgVideoDesc: "Choisissez un clip MP4 ou WebM sur cet appareil (30 Mo max.). Il est lu en boucle, sans son, uniquement pendant le verrouillage, et stock\xE9 dans le dossier du plugin ; rien n'est envoy\xE9 en ligne. Les courts clips en boucle conviennent tr\xE8s bien.",
  chooseVideo: "Choisir une vid\xE9o",
  videoFailed: "Impossible d'utiliser cette vid\xE9o (MP4/WebM lisible, 30 Mo max.).",
  animAurora: "Aurore",
  animFireflies: "Lucioles",
  animSnow: "Neige",
  textColor: "Couleur du texte",
  accentColor: "Couleur d'accent",
  colorAuto: "Automatique (suit le th\xE8me et l'arri\xE8re-plan)",
  resetColor: "R\xE9initialiser la couleur",
  clockSize: "Taille de l'horloge",
  clockFont: "Police de l'horloge",
  fontSans: "Sans empattement",
  fontSerif: "Avec empattement",
  fontMono: "Chasse fixe",
  fontRounded: "Arrondie",
  clockWeight: "Graisse de l'horloge",
  customTitle: "Texte personnalis\xE9",
  customTitleDesc: "Remplace le texte \xAB Verrouill\xE9 \xBB. Laissez vide pour utiliser le texte par d\xE9faut.",
  position: "Position verticale",
  posTop: "Haut",
  posCenter: "Centre",
  posBottom: "Bas",
  fieldShape: "Forme du champ et du bouton",
  shapeRounded: "Arrondie",
  shapePill: "Pilule",
  shapeSquare: "Carr\xE9e",
  showIcon: "Afficher l'ic\xF4ne de cadenas",
  resetAppearance: "R\xE9initialiser l'apparence",
  resetAppearanceDesc: "R\xE9tablit le type d'arri\xE8re-plan, les couleurs, les polices, la disposition et l'animation. Le mot de passe, les t\xE2ches et les fichiers image/vid\xE9o enregistr\xE9s sont conserv\xE9s.",
  resetAppearanceBtn: "R\xE9initialiser",
  theme: "Th\xE8me",
  themeDefault: "Par d\xE9faut",
  themeWin95: "Windows 95",
  themeTerminal: "Terminal d\xE9veloppeur",
  themeSnake: "Snake console portable (jeu)",
  themeBreakout: "Casse-briques arcade (jeu)",
  themeRunner: "Obsidian Runner (jeu)",
  themeAuto: "D\xE9faut du th\xE8me",
  animGlow: "Projecteur qui suit le curseur",
  animTrail: "Tra\xEEn\xE9e du curseur",
  animOrbs: "Orbes poursuivants",
  unlocked: "D\xE9verrouill\xE9",
  forgot: "Mot de passe oubli\xE9 ?",
  recoverPlaceholder: "Cl\xE9 de r\xE9cup\xE9ration",
  recoverUnlock: "D\xE9verrouiller avec la cl\xE9 de r\xE9cup\xE9ration",
  backToPassword: "Utiliser le mot de passe",
  modalReset: "D\xE9finir un nouveau mot de passe",
  modalRecovery: "Cr\xE9er une cl\xE9 de r\xE9cup\xE9ration",
  resetIntro: "Vous avez d\xE9verrouill\xE9 avec la cl\xE9 de r\xE9cup\xE9ration. Choisissez maintenant un nouveau mot de passe. Vous recevrez aussi une nouvelle cl\xE9 de r\xE9cup\xE9ration.",
  recoveryKeyTitle: "Votre cl\xE9 de r\xE9cup\xE9ration",
  recoveryKeyIntro: "Notez cette cl\xE9 et gardez-la en lieu s\xFBr, loin de cet ordinateur. Elle n\u2019est affich\xE9e qu\u2019une fois et ne pourra plus \xEAtre consult\xE9e. Si vous oubliez le mot de passe, elle d\xE9verrouille l\u2019\xE9cran. Quiconque la poss\xE8de peut d\xE9verrouiller l\u2019\xE9cran.",
  copyKey: "Copier",
  copied: "Copi\xE9e.",
  keySaved: "Je l\u2019ai enregistr\xE9e",
  recoveryRow: "Cl\xE9 de r\xE9cup\xE9ration",
  recoveryOn: "D\xE9finie. Utilisez \xAB Mot de passe oubli\xE9 ? \xBB sur l\u2019\xE9cran de verrouillage.",
  recoveryOff: "Non d\xE9finie. Sans elle, un mot de passe oubli\xE9 ne se corrige qu\u2019en modifiant data.json.",
  makeRecovery: "Cr\xE9er",
  renewRecovery: "En cr\xE9er une nouvelle",
  logRecovered: "D\xE9verrouill\xE9 avec la cl\xE9 de r\xE9cup\xE9ration",
  hideScreen: "Masquer l\u2019\xE9cran (sans mot de passe)",
  hideHint: "Cliquez ou appuyez sur \xC9chap pour r\xE9afficher l\u2019\xE9cran.",
  coverOnBlur: "Masquer quand la fen\xEAtre perd le focus",
  coverOnBlurDesc: "Masque les notes d\xE8s qu\u2019une autre application passe au premier plan, pas seulement quand la fen\xEAtre est r\xE9duite. Revenir dans le d\xE9lai de gr\xE2ce ne demande pas de mot de passe. La fen\xEAtre des r\xE9glages ne compte pas comme une sortie.",
  lockOnSystemLock: "Verrouiller quand l\u2019ordinateur se verrouille ou se met en veille",
  lockOnSystemLockDesc: "Bureau uniquement. Verrouille quand le syst\xE8me verrouille l\u2019\xE9cran ou passe en veille. Sans effet si cette version d\u2019Obsidian ne le propose pas.",
  deviceOnly: "R\xE9glages propres \xE0 cet appareil",
  deviceOnlyDesc: "Le d\xE9lai de verrouillage automatique, les options de sortie de l\u2019application, le masquage \xE0 la perte de focus, le verrouillage syst\xE8me et la r\xE9duction de la fen\xEAtre restent sur cet appareil et ne sont pas synchronis\xE9s.",
  logTitle: "Activit\xE9 r\xE9cente",
  logDesc: "Les 50 derniers verrouillages, d\xE9verrouillages et mots de passe erron\xE9s sur les appareils qui synchronisent ce coffre. Non infalsifiable : quiconque peut modifier data.json peut le modifier.",
  logEmpty: "Rien d\u2019enregistr\xE9 pour l\u2019instant.",
  logClear: "Effacer",
  logLocked: "Verrouill\xE9",
  logUnlocked: "D\xE9verrouill\xE9",
  logFailed: "Mot de passe erron\xE9",
  reasonStartup: "d\xE9marrage",
  reasonIdle: "inactivit\xE9",
  reasonLeft: "sortie de l\u2019application",
  reasonManual: "manuel",
  reasonSystem: "ordinateur verrouill\xE9"
};
var fr_default = fr;

// src/i18n/de.ts
var de = {
  lockedTitle: "Gesperrt",
  placeholder: "Passwort",
  unlock: "Entsperren",
  checking: "Wird gepr\xFCft\u2026",
  wrong: "Falsches Passwort.",
  wait: "Bitte in {n} s erneut versuchen.",
  cryptoError: "WebCrypto ist hier nicht verf\xFCgbar, das Passwort kann daher nicht gepr\xFCft werden.",
  lockNow: "Jetzt sperren",
  noPassword: "Lege zuerst in den Einstellungen ein Passwort fest.",
  settingsInfo: "Dieses Plugin ist eine Bildschirmsperre. Es verschl\xFCsselt keine Dateien \u2013 nutze zus\xE4tzlich eine Festplattenverschl\xFCsselung (FileVault/BitLocker) f\xFCr den Fall eines Ger\xE4teverlusts.",
  password: "Passwort",
  passwordNotSet: "Nicht festgelegt",
  passwordSet: "Festgelegt",
  setPassword: "Festlegen",
  changePassword: "\xC4ndern",
  removePassword: "Entfernen",
  lockOnStartup: "Beim Start sperren",
  idle: "Automatisch sperren bei Inaktivit\xE4t",
  idleOff: "Aus",
  minutes: "{n} Min.",
  lockOnHide: "Beim Verlassen der App sperren",
  lockOnHideDesc: "Beim Wechsel in eine andere App oder Minimieren des Fensters. Der Inhalt wird sofort verdeckt, damit die Notiz nicht in der App-\xDCbersicht zu sehen ist.",
  grace: "Kulanzzeit",
  graceDesc: "Keine Passwortabfrage, wenn du innerhalb dieser Zeit zur\xFCckkehrst.",
  immediately: "Sofort",
  seconds: "{n} s",
  modalSet: "Passwort festlegen",
  modalChange: "Passwort \xE4ndern",
  modalRemove: "Passwort entfernen",
  current: "Aktuelles Passwort",
  newPw: "Neues Passwort",
  confirmPw: "Neues Passwort best\xE4tigen",
  save: "Speichern",
  cancel: "Abbrechen",
  tooShort: "Das Passwort muss mindestens {n} Zeichen lang sein.",
  mismatch: "Die neuen Passw\xF6rter stimmen nicht \xFCberein.",
  saved: "Passwort gespeichert.",
  removed: "Passwort entfernt.",
  appearance: "Sperrbildschirm gestalten",
  preview: "Vorschau",
  previewDesc: "Sperrbildschirm ansehen, ohne zu sperren. Zum Schlie\xDFen irgendwo klicken oder Esc dr\xFCcken.",
  previewClose: "Zum Schlie\xDFen irgendwo klicken oder Esc dr\xFCcken",
  bgImage: "Hintergrundbild",
  bgImageDesc: "W\xE4hle ein Foto von diesem Ger\xE4t. Es wird verkleinert im Plugin-Ordner gespeichert; nichts wird hochgeladen.",
  chooseImage: "Bild ausw\xE4hlen",
  removeImage: "Entfernen",
  imageFailed: "Dieses Bild kann nicht verwendet werden.",
  dim: "Hintergrund abdunkeln",
  blur: "Hintergrund weichzeichnen",
  animation: "Hintergrundanimation",
  animNone: "Keine",
  showClock: "Uhr anzeigen",
  showSeconds: "Sekunden anzeigen",
  showDate: "Datum anzeigen",
  clockFormat: "Zeitformat",
  fmtAuto: "Automatisch",
  fmt24: "24 Stunden",
  fmt12: "12 Stunden",
  showTodos: "To-do-Liste anzeigen",
  showTodosDesc: "Jeder kann diese Liste ohne Passwort sehen und bearbeiten. Schreibe nichts Sensibles hinein.",
  todoPlaceholder: "Aufgabe hinzuf\xFCgen",
  todoAdd: "Hinzuf\xFCgen",
  todoDelete: "L\xF6schen",
  shrinkWindow: "Fenster beim Sperren verkleinern",
  shrinkWindowDesc: "Solange der Sperrbildschirm angezeigt wird, wird das Obsidian-Fenster verkleinert; nach dem Entsperren erh\xE4lt es Gr\xF6\xDFe und Position zur\xFCck. Nur Desktop. Im Vollbildmodus wirkungslos.",
  lockWindowSize: "Gr\xF6\xDFe des gesperrten Fensters",
  hoverReveal: "Passwortfeld erst beim Dar\xFCberfahren zeigen",
  hoverRevealDesc: "H\xE4lt den Sperrbildschirm aufger\xE4umt: Das Feld erscheint, wenn du mit der Maus \xFCber den Schloss-Bereich f\xE4hrst, eine Taste dr\xFCckst oder tippst.",
  showTitle: "Text \u201EGesperrt\u201C anzeigen",
  titleAuto: "Automatisch (bei Foto ausgeblendet)",
  titleShow: "Immer anzeigen",
  titleHide: "Ausblenden",
  secBackground: "Hintergrund",
  secText: "Text und Farben",
  secLayout: "Layout und Form",
  secWidgets: "Widgets",
  bgKind: "Hintergrundtyp",
  bgKindNone: "Keiner",
  bgKindImage: "Foto",
  bgKindVideo: "Video",
  bgVideo: "Hintergrundvideo",
  bgVideoDesc: "W\xE4hle einen MP4- oder WebM-Clip von diesem Ger\xE4t (bis 30 MB). Er l\xE4uft nur im gesperrten Zustand stumm in Schleife und wird im Plugin-Ordner gespeichert; nichts wird hochgeladen. Kurze Loop-Clips passen gut.",
  chooseVideo: "Video ausw\xE4hlen",
  videoFailed: "Dieses Video kann nicht verwendet werden (abspielbares MP4/WebM, bis 30 MB).",
  animAurora: "Polarlicht",
  animFireflies: "Gl\xFChw\xFCrmchen",
  animSnow: "Schnee",
  textColor: "Textfarbe",
  accentColor: "Akzentfarbe",
  colorAuto: "Automatisch (folgt Theme und Hintergrund)",
  resetColor: "Farbe zur\xFCcksetzen",
  clockSize: "Uhrgr\xF6\xDFe",
  clockFont: "Uhrschrift",
  fontSans: "Serifenlos",
  fontSerif: "Serifen",
  fontMono: "Monospace",
  fontRounded: "Gerundet",
  clockWeight: "Uhr-Schriftst\xE4rke",
  customTitle: "Eigener Text",
  customTitleDesc: "Ersetzt den Text \u201EGesperrt\u201C. Leer lassen f\xFCr den Standardtext.",
  position: "Vertikale Position",
  posTop: "Oben",
  posCenter: "Mitte",
  posBottom: "Unten",
  fieldShape: "Form von Feld und Schaltfl\xE4che",
  shapeRounded: "Abgerundet",
  shapePill: "Pillenform",
  shapeSquare: "Eckig",
  showIcon: "Schloss-Symbol anzeigen",
  resetAppearance: "Aussehen zur\xFCcksetzen",
  resetAppearanceDesc: "Setzt Hintergrundtyp, Farben, Schriften, Layout und Animation auf die Standardwerte zur\xFCck. Passwort, Aufgaben und gespeicherte Bild-/Videodateien bleiben erhalten.",
  resetAppearanceBtn: "Zur\xFCcksetzen",
  theme: "Design",
  themeDefault: "Standard",
  themeWin95: "Windows 95",
  themeTerminal: "Entwickler-Terminal",
  themeSnake: "Handheld-Snake (Spiel)",
  themeBreakout: "Arcade-Breakout (Spiel)",
  themeRunner: "Obsidian-Runner (Spiel)",
  themeAuto: "Theme-Standard",
  animGlow: "Cursor-Scheinwerfer",
  animTrail: "Cursor-Spur",
  animOrbs: "Folgende Kugeln",
  unlocked: "Entsperrt",
  forgot: "Passwort vergessen?",
  recoverPlaceholder: "Wiederherstellungsschl\xFCssel",
  recoverUnlock: "Mit Wiederherstellungsschl\xFCssel entsperren",
  backToPassword: "Stattdessen Passwort verwenden",
  modalReset: "Neues Passwort festlegen",
  modalRecovery: "Wiederherstellungsschl\xFCssel erstellen",
  resetIntro: "Du hast mit dem Wiederherstellungsschl\xFCssel entsperrt. Lege jetzt ein neues Passwort fest. Du erh\xE4ltst auch einen neuen Wiederherstellungsschl\xFCssel.",
  recoveryKeyTitle: "Dein Wiederherstellungsschl\xFCssel",
  recoveryKeyIntro: "Schreibe diesen Schl\xFCssel auf und bewahre ihn sicher auf, weit weg von diesem Computer. Er wird nur einmal angezeigt und l\xE4sst sich sp\xE4ter nicht mehr abrufen. Wenn du das Passwort vergisst, entsperrt er den Bildschirm. Jeder, der ihn hat, kann den Bildschirm entsperren.",
  copyKey: "Kopieren",
  copied: "Kopiert.",
  keySaved: "Ich habe ihn gespeichert",
  recoveryRow: "Wiederherstellungsschl\xFCssel",
  recoveryOn: "Festgelegt. Verwende \u201EPasswort vergessen?\u201C auf dem Sperrbildschirm.",
  recoveryOff: "Nicht festgelegt. Ohne ihn l\xE4sst sich ein vergessenes Passwort nur durch Bearbeiten von data.json beheben.",
  makeRecovery: "Erstellen",
  renewRecovery: "Neu erstellen",
  logRecovered: "Mit Wiederherstellungsschl\xFCssel entsperrt",
  hideScreen: "Bildschirm verbergen (ohne Passwort)",
  hideHint: "Klicken oder Esc dr\xFCcken, um den Bildschirm wieder anzuzeigen.",
  coverOnBlur: "Verbergen, wenn das Fenster den Fokus verliert",
  coverOnBlurDesc: "Verdeckt die Notizen, sobald eine andere App im Vordergrund ist, nicht nur beim Minimieren. Kehrst du innerhalb der Karenzzeit zur\xFCck, wird kein Passwort verlangt. Das Einstellungsfenster z\xE4hlt nicht als Verlassen.",
  lockOnSystemLock: "Sperren, wenn der Computer gesperrt wird oder in den Ruhezustand geht",
  lockOnSystemLockDesc: "Nur Desktop. Sperrt, wenn das Betriebssystem den Bildschirm sperrt oder in den Ruhezustand wechselt. Ohne Wirkung, wenn diese Obsidian-Version das nicht bereitstellt.",
  deviceOnly: "Eigene Einstellungen f\xFCr dieses Ger\xE4t",
  deviceOnlyDesc: "Zeit f\xFCr die automatische Sperre, Optionen beim Verlassen der App, Verbergen bei Fokusverlust, Systemsperre und Fensterverkleinerung bleiben nur auf diesem Ger\xE4t und werden nicht synchronisiert.",
  logTitle: "Letzte Aktivit\xE4t",
  logDesc: "Die letzten 50 Sperrungen, Entsperrungen und falschen Passw\xF6rter auf Ger\xE4ten, die diesen Tresor synchronisieren. Nicht manipulationssicher: Wer data.json bearbeiten kann, kann auch dieses Protokoll bearbeiten.",
  logEmpty: "Noch nichts aufgezeichnet.",
  logClear: "Leeren",
  logLocked: "Gesperrt",
  logUnlocked: "Entsperrt",
  logFailed: "Falsches Passwort",
  reasonStartup: "Start",
  reasonIdle: "Inaktivit\xE4t",
  reasonLeft: "App verlassen",
  reasonManual: "manuell",
  reasonSystem: "Computer gesperrt"
};
var de_default = de;

// src/i18n/pt.ts
var pt = {
  lockedTitle: "Bloqueado",
  placeholder: "Senha",
  unlock: "Desbloquear",
  checking: "Verificando\u2026",
  wrong: "Senha incorreta.",
  wait: "Tente novamente em {n} s.",
  cryptoError: "O WebCrypto n\xE3o est\xE1 dispon\xEDvel aqui, ent\xE3o a senha n\xE3o pode ser verificada.",
  lockNow: "Bloquear agora",
  noPassword: "Defina uma senha nas configura\xE7\xF5es primeiro.",
  settingsInfo: "Este plugin \xE9 um bloqueio de tela. Ele n\xE3o criptografa arquivos; use tamb\xE9m criptografia de disco (FileVault/BitLocker) caso o dispositivo seja perdido.",
  password: "Senha",
  passwordNotSet: "N\xE3o definida",
  passwordSet: "Definida",
  setPassword: "Definir",
  changePassword: "Alterar",
  removePassword: "Remover",
  lockOnStartup: "Bloquear ao iniciar",
  idle: "Bloqueio autom\xE1tico por inatividade",
  idleOff: "Desativado",
  minutes: "{n} min",
  lockOnHide: "Bloquear ao sair do app",
  lockOnHideDesc: "Ao trocar de app ou minimizar a janela. O conte\xFAdo \xE9 coberto na hora para que a nota n\xE3o apare\xE7a no seletor de apps.",
  grace: "Tempo de toler\xE2ncia",
  graceDesc: "A senha n\xE3o \xE9 pedida se voc\xEA voltar dentro deste tempo.",
  immediately: "Imediatamente",
  seconds: "{n} s",
  modalSet: "Definir senha",
  modalChange: "Alterar senha",
  modalRemove: "Remover senha",
  current: "Senha atual",
  newPw: "Nova senha",
  confirmPw: "Confirmar nova senha",
  save: "Salvar",
  cancel: "Cancelar",
  tooShort: "A senha deve ter pelo menos {n} caracteres.",
  mismatch: "As novas senhas n\xE3o coincidem.",
  saved: "Senha salva.",
  removed: "Senha removida.",
  appearance: "Personalizar tela de bloqueio",
  preview: "Pr\xE9-visualizar",
  previewDesc: "Veja a tela de bloqueio sem bloquear. Clique em qualquer lugar ou pressione Esc para fechar.",
  previewClose: "Clique em qualquer lugar ou pressione Esc para fechar",
  bgImage: "Imagem de fundo",
  bgImageDesc: "Escolha uma foto deste dispositivo. Ela \xE9 reduzida e guardada na pasta do plugin; nada \xE9 enviado para a internet.",
  chooseImage: "Escolher imagem",
  removeImage: "Remover",
  imageFailed: "N\xE3o foi poss\xEDvel usar essa imagem.",
  dim: "Escurecer fundo",
  blur: "Desfocar fundo",
  animation: "Anima\xE7\xE3o de fundo",
  animNone: "Nenhuma",
  showClock: "Mostrar rel\xF3gio",
  showSeconds: "Mostrar segundos",
  showDate: "Mostrar data",
  clockFormat: "Formato da hora",
  fmtAuto: "Autom\xE1tico",
  fmt24: "24 horas",
  fmt12: "12 horas",
  showTodos: "Mostrar lista de tarefas",
  showTodosDesc: "Qualquer pessoa pode ver e editar esta lista sem a senha. N\xE3o escreva nada sens\xEDvel.",
  todoPlaceholder: "Adicionar tarefa",
  todoAdd: "Adicionar",
  todoDelete: "Excluir",
  shrinkWindow: "Reduzir a janela ao bloquear",
  shrinkWindowDesc: "Enquanto a tela de bloqueio \xE9 exibida, a janela do Obsidian \xE9 reduzida; ao desbloquear, ela volta ao tamanho e \xE0 posi\xE7\xE3o anteriores. Somente no desktop. N\xE3o se aplica em tela cheia.",
  lockWindowSize: "Tamanho da janela bloqueada",
  hoverReveal: "Ocultar o campo de senha at\xE9 passar o mouse",
  hoverRevealDesc: "Mant\xE9m a tela de bloqueio limpa: o campo aparece ao passar o mouse na \xE1rea do cadeado, pressionar qualquer tecla ou tocar.",
  showTitle: 'Mostrar o texto "Bloqueado"',
  titleAuto: "Autom\xE1tico (oculto sobre uma foto)",
  titleShow: "Sempre mostrar",
  titleHide: "Ocultar",
  secBackground: "Plano de fundo",
  secText: "Texto e cores",
  secLayout: "Layout e formato",
  secWidgets: "Widgets",
  bgKind: "Tipo de fundo",
  bgKindNone: "Nenhum",
  bgKindImage: "Foto",
  bgKindVideo: "V\xEDdeo",
  bgVideo: "V\xEDdeo de fundo",
  bgVideoDesc: "Escolha um clipe MP4 ou WebM deste dispositivo (at\xE9 30 MB). Ele toca sem som e em loop apenas enquanto est\xE1 bloqueado e \xE9 guardado na pasta do plugin; nada \xE9 enviado para a internet. Clipes curtos em loop ficam \xF3timos.",
  chooseVideo: "Escolher v\xEDdeo",
  videoFailed: "N\xE3o foi poss\xEDvel usar esse v\xEDdeo (MP4/WebM reproduz\xEDvel, at\xE9 30 MB).",
  animAurora: "Aurora",
  animFireflies: "Vaga-lumes",
  animSnow: "Neve",
  textColor: "Cor do texto",
  accentColor: "Cor de destaque",
  colorAuto: "Autom\xE1tico (segue o tema e o fundo)",
  resetColor: "Redefinir cor",
  clockSize: "Tamanho do rel\xF3gio",
  clockFont: "Fonte do rel\xF3gio",
  fontSans: "Sem serifa",
  fontSerif: "Com serifa",
  fontMono: "Monoespa\xE7ada",
  fontRounded: "Arredondada",
  clockWeight: "Espessura do rel\xF3gio",
  customTitle: "Texto personalizado",
  customTitleDesc: 'Substitui o texto "Bloqueado". Deixe vazio para usar o texto padr\xE3o.',
  position: "Posi\xE7\xE3o vertical",
  posTop: "Topo",
  posCenter: "Centro",
  posBottom: "Base",
  fieldShape: "Formato do campo e do bot\xE3o",
  shapeRounded: "Arredondado",
  shapePill: "P\xEDlula",
  shapeSquare: "Quadrado",
  showIcon: "Mostrar \xEDcone de cadeado",
  resetAppearance: "Redefinir apar\xEAncia",
  resetAppearanceDesc: "Redefine o tipo de fundo, as cores, as fontes, o layout e a anima\xE7\xE3o. A senha, as tarefas e os arquivos de imagem/v\xEDdeo salvos s\xE3o mantidos.",
  resetAppearanceBtn: "Redefinir",
  theme: "Tema",
  themeDefault: "Padr\xE3o",
  themeWin95: "Windows 95",
  themeTerminal: "Terminal do desenvolvedor",
  themeSnake: "Snake port\xE1til (jogo)",
  themeBreakout: "Quebra-blocos arcade (jogo)",
  themeRunner: "Obsidian Runner (jogo)",
  themeAuto: "Padr\xE3o do tema",
  animGlow: "Holofote do cursor",
  animTrail: "Rastro do cursor",
  animOrbs: "Esferas perseguidoras",
  unlocked: "Desbloqueado",
  forgot: "Esqueceu a senha?",
  recoverPlaceholder: "Chave de recupera\xE7\xE3o",
  recoverUnlock: "Desbloquear com a chave de recupera\xE7\xE3o",
  backToPassword: "Usar a senha",
  modalReset: "Definir uma nova senha",
  modalRecovery: "Criar uma chave de recupera\xE7\xE3o",
  resetIntro: "Voc\xEA desbloqueou com a chave de recupera\xE7\xE3o. Escolha agora uma nova senha. Voc\xEA tamb\xE9m receber\xE1 uma nova chave de recupera\xE7\xE3o.",
  recoveryKeyTitle: "Sua chave de recupera\xE7\xE3o",
  recoveryKeyIntro: "Anote esta chave e guarde-a em um lugar seguro, longe deste computador. Ela \xE9 mostrada s\xF3 uma vez e n\xE3o pode ser consultada depois. Se voc\xEA esquecer a senha, ela desbloqueia a tela. Qualquer pessoa que a tenha pode desbloquear a tela.",
  copyKey: "Copiar",
  copied: "Copiada.",
  keySaved: "J\xE1 guardei",
  recoveryRow: "Chave de recupera\xE7\xE3o",
  recoveryOn: "Definida. Use \u201CEsqueceu a senha?\u201D na tela de bloqueio.",
  recoveryOff: "N\xE3o definida. Sem ela, uma senha esquecida s\xF3 se resolve editando o data.json.",
  makeRecovery: "Criar",
  renewRecovery: "Criar nova",
  logRecovered: "Desbloqueado com a chave de recupera\xE7\xE3o",
  hideScreen: "Ocultar a tela (sem senha)",
  hideHint: "Clique ou pressione Esc para mostrar a tela de novo.",
  coverOnBlur: "Ocultar quando a janela perder o foco",
  coverOnBlurDesc: "Oculta as notas assim que outro aplicativo vem para a frente, n\xE3o s\xF3 ao minimizar a janela. Voltar dentro do per\xEDodo de toler\xE2ncia n\xE3o pede senha. A janela de Configura\xE7\xF5es n\xE3o conta como sair.",
  lockOnSystemLock: "Bloquear quando o computador bloquear ou suspender",
  lockOnSystemLockDesc: "Somente desktop. Bloqueia quando o sistema operacional bloqueia a tela ou entra em suspens\xE3o. N\xE3o faz nada se esta vers\xE3o do Obsidian n\xE3o oferecer o recurso.",
  deviceOnly: "Configura\xE7\xF5es pr\xF3prias deste dispositivo",
  deviceOnlyDesc: "O tempo de bloqueio autom\xE1tico, as op\xE7\xF5es ao sair do app, ocultar ao perder o foco, o bloqueio do sistema e a redu\xE7\xE3o da janela ficam s\xF3 neste dispositivo e n\xE3o s\xE3o sincronizados.",
  logTitle: "Atividade recente",
  logDesc: "Os \xFAltimos 50 bloqueios, desbloqueios e senhas erradas nos dispositivos que sincronizam este cofre. N\xE3o \xE9 \xE0 prova de adultera\xE7\xE3o: quem puder editar o data.json pode edit\xE1-lo.",
  logEmpty: "Nada registrado ainda.",
  logClear: "Limpar",
  logLocked: "Bloqueado",
  logUnlocked: "Desbloqueado",
  logFailed: "Senha incorreta",
  reasonStartup: "in\xEDcio",
  reasonIdle: "inatividade",
  reasonLeft: "saiu do app",
  reasonManual: "manual",
  reasonSystem: "computador bloqueado"
};
var pt_default = pt;

// src/i18n/ru.ts
var ru = {
  lockedTitle: "\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E",
  placeholder: "\u041F\u0430\u0440\u043E\u043B\u044C",
  unlock: "\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
  checking: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0430\u2026",
  wrong: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C.",
  wait: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u043F\u044B\u0442\u043A\u0443 \u0447\u0435\u0440\u0435\u0437 {n} \u0441.",
  cryptoError: "WebCrypto \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0432 \u044D\u0442\u043E\u0439 \u0441\u0440\u0435\u0434\u0435, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043F\u0430\u0440\u043E\u043B\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043D\u0435\u043B\u044C\u0437\u044F.",
  lockNow: "\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0435\u0439\u0447\u0430\u0441",
  noPassword: "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u0434\u0430\u0439\u0442\u0435 \u043F\u0430\u0440\u043E\u043B\u044C \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445.",
  settingsInfo: "\u042D\u0442\u043E\u0442 \u043F\u043B\u0430\u0433\u0438\u043D \u2014 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0430 \u044D\u043A\u0440\u0430\u043D\u0430. \u041E\u043D \u043D\u0435 \u0448\u0438\u0444\u0440\u0443\u0435\u0442 \u0444\u0430\u0439\u043B\u044B, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439 \u043F\u043E\u0442\u0435\u0440\u0438 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \u0438 \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0434\u0438\u0441\u043A\u0430 (FileVault/BitLocker).",
  password: "\u041F\u0430\u0440\u043E\u043B\u044C",
  passwordNotSet: "\u041D\u0435 \u0437\u0430\u0434\u0430\u043D",
  passwordSet: "\u0417\u0430\u0434\u0430\u043D",
  setPassword: "\u0417\u0430\u0434\u0430\u0442\u044C",
  changePassword: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C",
  removePassword: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
  lockOnStartup: "\u0411\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u0438 \u0437\u0430\u043F\u0443\u0441\u043A\u0435",
  idle: "\u0410\u0432\u0442\u043E\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0430 \u043F\u0440\u0438 \u0431\u0435\u0437\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0438",
  idleOff: "\u0412\u044B\u043A\u043B.",
  minutes: "{n} \u043C\u0438\u043D",
  lockOnHide: "\u0411\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u0438 \u0432\u044B\u0445\u043E\u0434\u0435 \u0438\u0437 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F",
  lockOnHideDesc: "\u041F\u0440\u0438 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0438 \u043D\u0430 \u0434\u0440\u0443\u0433\u043E\u0435 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0438\u043B\u0438 \u0441\u0432\u043E\u0440\u0430\u0447\u0438\u0432\u0430\u043D\u0438\u0438 \u043E\u043A\u043D\u0430. \u0421\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u0441\u043A\u0440\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u0441\u0440\u0430\u0437\u0443, \u0447\u0442\u043E\u0431\u044B \u0437\u0430\u043C\u0435\u0442\u043A\u0430 \u043D\u0435 \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0430\u043B\u0430\u0441\u044C \u0432 \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0442\u0435\u043B\u0435 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0439.",
  grace: "\u041B\u044C\u0433\u043E\u0442\u043D\u043E\u0435 \u0432\u0440\u0435\u043C\u044F",
  graceDesc: "\u041F\u0430\u0440\u043E\u043B\u044C \u043D\u0435 \u0437\u0430\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442\u0441\u044F, \u0435\u0441\u043B\u0438 \u0432\u044B \u0432\u0435\u0440\u043D\u0443\u043B\u0438\u0441\u044C \u0432 \u0442\u0435\u0447\u0435\u043D\u0438\u0435 \u044D\u0442\u043E\u0433\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438.",
  immediately: "\u0421\u0440\u0430\u0437\u0443",
  seconds: "{n} \u0441",
  modalSet: "\u0417\u0430\u0434\u0430\u0442\u044C \u043F\u0430\u0440\u043E\u043B\u044C",
  modalChange: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u043F\u0430\u0440\u043E\u043B\u044C",
  modalRemove: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u0430\u0440\u043E\u043B\u044C",
  current: "\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u0430\u0440\u043E\u043B\u044C",
  newPw: "\u041D\u043E\u0432\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C",
  confirmPw: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u043D\u043E\u0432\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C",
  save: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
  cancel: "\u041E\u0442\u043C\u0435\u043D\u0430",
  tooShort: "\u041F\u0430\u0440\u043E\u043B\u044C \u0434\u043E\u043B\u0436\u0435\u043D \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0442\u044C \u043D\u0435 \u043C\u0435\u043D\u0435\u0435 {n} \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432.",
  mismatch: "\u041D\u043E\u0432\u044B\u0435 \u043F\u0430\u0440\u043E\u043B\u0438 \u043D\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u044E\u0442.",
  saved: "\u041F\u0430\u0440\u043E\u043B\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D.",
  removed: "\u041F\u0430\u0440\u043E\u043B\u044C \u0443\u0434\u0430\u043B\u0451\u043D.",
  appearance: "\u041E\u0444\u043E\u0440\u043C\u043B\u0435\u043D\u0438\u0435 \u044D\u043A\u0440\u0430\u043D\u0430 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438",
  preview: "\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440",
  previewDesc: "\u041F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C \u044D\u043A\u0440\u0430\u043D \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438 \u0431\u0435\u0437 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0432 \u043B\u044E\u0431\u043E\u043C \u043C\u0435\u0441\u0442\u0435 \u0438\u043B\u0438 Esc, \u0447\u0442\u043E\u0431\u044B \u0437\u0430\u043A\u0440\u044B\u0442\u044C.",
  previewClose: "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u0432 \u043B\u044E\u0431\u043E\u043C \u043C\u0435\u0441\u0442\u0435 \u0438\u043B\u0438 Esc, \u0447\u0442\u043E\u0431\u044B \u0437\u0430\u043A\u0440\u044B\u0442\u044C",
  bgImage: "\u0424\u043E\u043D\u043E\u0432\u043E\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435",
  bgImageDesc: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0444\u043E\u0442\u043E \u043D\u0430 \u044D\u0442\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435. \u041E\u043D\u043E \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442\u0441\u044F \u0438 \u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0432 \u043F\u0430\u043F\u043A\u0435 \u043F\u043B\u0430\u0433\u0438\u043D\u0430; \u043D\u0438\u043A\u0443\u0434\u0430 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442\u0441\u044F.",
  chooseImage: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435",
  removeImage: "\u0423\u0431\u0440\u0430\u0442\u044C",
  imageFailed: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u044D\u0442\u043E \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435.",
  dim: "\u0417\u0430\u0442\u0435\u043C\u043D\u0438\u0442\u044C \u0444\u043E\u043D",
  blur: "\u0420\u0430\u0437\u043C\u044B\u0442\u044C \u0444\u043E\u043D",
  animation: "\u0410\u043D\u0438\u043C\u0430\u0446\u0438\u044F \u0444\u043E\u043D\u0430",
  animNone: "\u041D\u0435\u0442",
  showClock: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0447\u0430\u0441\u044B",
  showSeconds: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0441\u0435\u043A\u0443\u043D\u0434\u044B",
  showDate: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0434\u0430\u0442\u0443",
  clockFormat: "\u0424\u043E\u0440\u043C\u0430\u0442 \u0432\u0440\u0435\u043C\u0435\u043D\u0438",
  fmtAuto: "\u0410\u0432\u0442\u043E",
  fmt24: "24-\u0447\u0430\u0441\u043E\u0432\u043E\u0439",
  fmt12: "12-\u0447\u0430\u0441\u043E\u0432\u043E\u0439",
  showTodos: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0441\u043F\u0438\u0441\u043E\u043A \u0434\u0435\u043B",
  showTodosDesc: "\u041B\u044E\u0431\u043E\u0439 \u043C\u043E\u0436\u0435\u0442 \u0432\u0438\u0434\u0435\u0442\u044C \u0438 \u043C\u0435\u043D\u044F\u0442\u044C \u044D\u0442\u043E\u0442 \u0441\u043F\u0438\u0441\u043E\u043A \u0431\u0435\u0437 \u043F\u0430\u0440\u043E\u043B\u044F. \u041D\u0435 \u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0439\u0442\u0435 \u043D\u0438\u0447\u0435\u0433\u043E \u043A\u043E\u043D\u0444\u0438\u0434\u0435\u043D\u0446\u0438\u0430\u043B\u044C\u043D\u043E\u0433\u043E.",
  todoPlaceholder: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0434\u0435\u043B\u043E",
  todoAdd: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C",
  todoDelete: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
  shrinkWindow: "\u0423\u043C\u0435\u043D\u044C\u0448\u0430\u0442\u044C \u043E\u043A\u043D\u043E \u043F\u0440\u0438 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0435",
  shrinkWindowDesc: "\u041F\u043E\u043A\u0430 \u043F\u043E\u043A\u0430\u0437\u0430\u043D \u044D\u043A\u0440\u0430\u043D \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438, \u043E\u043A\u043D\u043E Obsidian \u0443\u043C\u0435\u043D\u044C\u0448\u0430\u0435\u0442\u0441\u044F; \u043F\u043E\u0441\u043B\u0435 \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438 \u043E\u043D\u043E \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442\u0441\u044F \u043A \u043F\u0440\u0435\u0436\u043D\u0435\u043C\u0443 \u0440\u0430\u0437\u043C\u0435\u0440\u0443 \u0438 \u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u044E. \u0422\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u0430. \u0412 \u043F\u043E\u043B\u043D\u043E\u044D\u043A\u0440\u0430\u043D\u043D\u043E\u043C \u0440\u0435\u0436\u0438\u043C\u0435 \u043D\u0435 \u043F\u0440\u0438\u043C\u0435\u043D\u044F\u0435\u0442\u0441\u044F.",
  lockWindowSize: "\u0420\u0430\u0437\u043C\u0435\u0440 \u043E\u043A\u043D\u0430 \u043F\u0440\u0438 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0435",
  hoverReveal: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u043F\u043E\u043B\u0435 \u043F\u0430\u0440\u043E\u043B\u044F \u043F\u0440\u0438 \u043D\u0430\u0432\u0435\u0434\u0435\u043D\u0438\u0438",
  hoverRevealDesc: "\u042D\u043A\u0440\u0430\u043D \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438 \u043E\u0441\u0442\u0430\u0451\u0442\u0441\u044F \u0447\u0438\u0441\u0442\u044B\u043C: \u043F\u043E\u043B\u0435 \u043F\u043E\u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F, \u043A\u043E\u0433\u0434\u0430 \u0432\u044B \u043D\u0430\u0432\u043E\u0434\u0438\u0442\u0435 \u043A\u0443\u0440\u0441\u043E\u0440 \u043D\u0430 \u043E\u0431\u043B\u0430\u0441\u0442\u044C \u0437\u0430\u043C\u043A\u0430, \u043D\u0430\u0436\u0438\u043C\u0430\u0435\u0442\u0435 \u043B\u044E\u0431\u0443\u044E \u043A\u043B\u0430\u0432\u0438\u0448\u0443 \u0438\u043B\u0438 \u043A\u0430\u0441\u0430\u0435\u0442\u0435\u0441\u044C \u044D\u043A\u0440\u0430\u043D\u0430.",
  showTitle: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u043D\u0430\u0434\u043F\u0438\u0441\u044C \xAB\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E\xBB",
  titleAuto: "\u0410\u0432\u0442\u043E (\u0441\u043A\u0440\u044B\u0442\u0430 \u043D\u0430 \u0444\u043E\u0442\u043E)",
  titleShow: "\u0412\u0441\u0435\u0433\u0434\u0430 \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C",
  titleHide: "\u0421\u043A\u0440\u044B\u0442\u044C",
  secBackground: "\u0424\u043E\u043D",
  secText: "\u0422\u0435\u043A\u0441\u0442 \u0438 \u0446\u0432\u0435\u0442\u0430",
  secLayout: "\u0420\u0430\u0441\u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0438 \u0444\u043E\u0440\u043C\u0430",
  secWidgets: "\u0412\u0438\u0434\u0436\u0435\u0442\u044B",
  bgKind: "\u0422\u0438\u043F \u0444\u043E\u043D\u0430",
  bgKindNone: "\u041D\u0435\u0442",
  bgKindImage: "\u0424\u043E\u0442\u043E",
  bgKindVideo: "\u0412\u0438\u0434\u0435\u043E",
  bgVideo: "\u0424\u043E\u043D\u043E\u0432\u043E\u0435 \u0432\u0438\u0434\u0435\u043E",
  bgVideoDesc: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0440\u043E\u043B\u0438\u043A MP4 \u0438\u043B\u0438 WebM \u043D\u0430 \u044D\u0442\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435 (\u0434\u043E 30 \u041C\u0411). \u041E\u043D \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0441\u044F \u0431\u0435\u0437 \u0437\u0432\u0443\u043A\u0430 \u043F\u043E \u043A\u0440\u0443\u0433\u0443 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u0440\u0438 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0435 \u0438 \u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0432 \u043F\u0430\u043F\u043A\u0435 \u043F\u043B\u0430\u0433\u0438\u043D\u0430; \u043D\u0438\u043A\u0443\u0434\u0430 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442\u0441\u044F. \u0425\u043E\u0440\u043E\u0448\u043E \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0442 \u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0435 \u0437\u0430\u0446\u0438\u043A\u043B\u0435\u043D\u043D\u044B\u0435 \u0440\u043E\u043B\u0438\u043A\u0438.",
  chooseVideo: "\u0412\u044B\u0431\u0440\u0430\u0442\u044C \u0432\u0438\u0434\u0435\u043E",
  videoFailed: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u044D\u0442\u043E \u0432\u0438\u0434\u0435\u043E (\u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u043C\u044B\u0439 MP4/WebM, \u0434\u043E 30 \u041C\u0411).",
  animAurora: "\u0421\u0435\u0432\u0435\u0440\u043D\u043E\u0435 \u0441\u0438\u044F\u043D\u0438\u0435",
  animFireflies: "\u0421\u0432\u0435\u0442\u043B\u044F\u0447\u043A\u0438",
  animSnow: "\u0421\u043D\u0435\u0433",
  textColor: "\u0426\u0432\u0435\u0442 \u0442\u0435\u043A\u0441\u0442\u0430",
  accentColor: "\u0410\u043A\u0446\u0435\u043D\u0442\u043D\u044B\u0439 \u0446\u0432\u0435\u0442",
  colorAuto: "\u0410\u0432\u0442\u043E (\u043F\u043E \u0442\u0435\u043C\u0435 \u0438 \u0444\u043E\u043D\u0443)",
  resetColor: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0446\u0432\u0435\u0442",
  clockSize: "\u0420\u0430\u0437\u043C\u0435\u0440 \u0447\u0430\u0441\u043E\u0432",
  clockFont: "\u0428\u0440\u0438\u0444\u0442 \u0447\u0430\u0441\u043E\u0432",
  fontSans: "\u0411\u0435\u0437 \u0437\u0430\u0441\u0435\u0447\u0435\u043A",
  fontSerif: "\u0421 \u0437\u0430\u0441\u0435\u0447\u043A\u0430\u043C\u0438",
  fontMono: "\u041C\u043E\u043D\u043E\u0448\u0438\u0440\u0438\u043D\u043D\u044B\u0439",
  fontRounded: "\u0421\u043A\u0440\u0443\u0433\u043B\u0451\u043D\u043D\u044B\u0439",
  clockWeight: "\u041D\u0430\u0441\u044B\u0449\u0435\u043D\u043D\u043E\u0441\u0442\u044C \u0447\u0430\u0441\u043E\u0432",
  customTitle: "\u0421\u0432\u043E\u0439 \u0442\u0435\u043A\u0441\u0442",
  customTitleDesc: "\u0417\u0430\u043C\u0435\u043D\u044F\u0435\u0442 \u043D\u0430\u0434\u043F\u0438\u0441\u044C \xAB\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E\xBB. \u041E\u0441\u0442\u0430\u0432\u044C\u0442\u0435 \u043F\u0443\u0441\u0442\u044B\u043C, \u0447\u0442\u043E\u0431\u044B \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u044C \u043D\u0430\u0434\u043F\u0438\u0441\u044C \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E.",
  position: "\u0412\u0435\u0440\u0442\u0438\u043A\u0430\u043B\u044C\u043D\u043E\u0435 \u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435",
  posTop: "\u0421\u0432\u0435\u0440\u0445\u0443",
  posCenter: "\u041F\u043E \u0446\u0435\u043D\u0442\u0440\u0443",
  posBottom: "\u0421\u043D\u0438\u0437\u0443",
  fieldShape: "\u0424\u043E\u0440\u043C\u0430 \u043F\u043E\u043B\u044F \u0438 \u043A\u043D\u043E\u043F\u043A\u0438",
  shapeRounded: "\u0421\u043A\u0440\u0443\u0433\u043B\u0451\u043D\u043D\u0430\u044F",
  shapePill: "\u0422\u0430\u0431\u043B\u0435\u0442\u043A\u0430",
  shapeSquare: "\u041F\u0440\u044F\u043C\u043E\u0443\u0433\u043E\u043B\u044C\u043D\u0430\u044F",
  showIcon: "\u041F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0437\u043D\u0430\u0447\u043E\u043A \u0437\u0430\u043C\u043A\u0430",
  resetAppearance: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043E\u0444\u043E\u0440\u043C\u043B\u0435\u043D\u0438\u0435",
  resetAppearanceDesc: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0442\u0438\u043F \u0444\u043E\u043D\u0430, \u0446\u0432\u0435\u0442\u0430, \u0448\u0440\u0438\u0444\u0442\u044B, \u0440\u0430\u0441\u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0438 \u0430\u043D\u0438\u043C\u0430\u0446\u0438\u044E \u043A \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F\u043C \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E. \u041F\u0430\u0440\u043E\u043B\u044C, \u0441\u043F\u0438\u0441\u043E\u043A \u0434\u0435\u043B \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0451\u043D\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0439 \u0438 \u0432\u0438\u0434\u0435\u043E \u043E\u0441\u0442\u0430\u044E\u0442\u0441\u044F.",
  resetAppearanceBtn: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C",
  theme: "\u0422\u0435\u043C\u0430",
  themeDefault: "\u041F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E",
  themeWin95: "Windows 95",
  themeTerminal: "\u0422\u0435\u0440\u043C\u0438\u043D\u0430\u043B \u0440\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A\u0430",
  themeSnake: "\u0417\u043C\u0435\u0439\u043A\u0430 \u043D\u0430 \u043A\u043E\u043D\u0441\u043E\u043B\u0438 (\u0438\u0433\u0440\u0430)",
  themeBreakout: "\u0410\u0440\u043A\u0430\u0434\u0430: \u0440\u0430\u0437\u0431\u0435\u0439 \u043A\u0438\u0440\u043F\u0438\u0447\u0438 (\u0438\u0433\u0440\u0430)",
  themeRunner: "Obsidian Runner (\u0438\u0433\u0440\u0430)",
  themeAuto: "\u0418\u0437 \u0442\u0435\u043C\u044B",
  animGlow: "\u041F\u0440\u043E\u0436\u0435\u043A\u0442\u043E\u0440 \u0437\u0430 \u043A\u0443\u0440\u0441\u043E\u0440\u043E\u043C",
  animTrail: "\u0421\u043B\u0435\u0434 \u043A\u0443\u0440\u0441\u043E\u0440\u0430",
  animOrbs: "\u041F\u0440\u0435\u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0435 \u0448\u0430\u0440\u044B",
  unlocked: "\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E",
  forgot: "\u0417\u0430\u0431\u044B\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C?",
  recoverPlaceholder: "\u041A\u043B\u044E\u0447 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F",
  recoverUnlock: "\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043A\u043B\u044E\u0447\u043E\u043C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F",
  backToPassword: "\u0412\u0432\u0435\u0441\u0442\u0438 \u043F\u0430\u0440\u043E\u043B\u044C",
  modalReset: "\u0417\u0430\u0434\u0430\u0442\u044C \u043D\u043E\u0432\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C",
  modalRecovery: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043A\u043B\u044E\u0447 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F",
  resetIntro: "\u0412\u044B \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043B\u0438 \u044D\u043A\u0440\u0430\u043D \u043A\u043B\u044E\u0447\u043E\u043C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F. \u0417\u0430\u0434\u0430\u0439\u0442\u0435 \u043D\u043E\u0432\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C \u0441\u0435\u0439\u0447\u0430\u0441. \u0412\u044B \u0442\u0430\u043A\u0436\u0435 \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0435 \u043D\u043E\u0432\u044B\u0439 \u043A\u043B\u044E\u0447 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F.",
  recoveryKeyTitle: "\u0412\u0430\u0448 \u043A\u043B\u044E\u0447 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F",
  recoveryKeyIntro: "\u0417\u0430\u043F\u0438\u0448\u0438\u0442\u0435 \u044D\u0442\u043E\u0442 \u043A\u043B\u044E\u0447 \u0438 \u0445\u0440\u0430\u043D\u0438\u0442\u0435 \u0432 \u043D\u0430\u0434\u0451\u0436\u043D\u043E\u043C \u043C\u0435\u0441\u0442\u0435, \u043F\u043E\u0434\u0430\u043B\u044C\u0448\u0435 \u043E\u0442 \u044D\u0442\u043E\u0433\u043E \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u0430. \u041E\u043D \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043E\u0434\u0438\u043D \u0440\u0430\u0437, \u043F\u043E\u0442\u043E\u043C \u0435\u0433\u043E \u043D\u0435\u043B\u044C\u0437\u044F \u043F\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u0442\u044C. \u0415\u0441\u043B\u0438 \u0432\u044B \u0437\u0430\u0431\u0443\u0434\u0435\u0442\u0435 \u043F\u0430\u0440\u043E\u043B\u044C, \u043A\u043B\u044E\u0447 \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u0443\u0435\u0442 \u044D\u043A\u0440\u0430\u043D. \u041B\u044E\u0431\u043E\u0439, \u0443 \u043A\u043E\u0433\u043E \u0435\u0441\u0442\u044C \u043A\u043B\u044E\u0447, \u043C\u043E\u0436\u0435\u0442 \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u044D\u043A\u0440\u0430\u043D.",
  copyKey: "\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
  copied: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E.",
  keySaved: "\u042F \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u043B",
  recoveryRow: "\u041A\u043B\u044E\u0447 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F",
  recoveryOn: "\u0417\u0430\u0434\u0430\u043D. \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 \xAB\u0417\u0430\u0431\u044B\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C?\xBB \u043D\u0430 \u044D\u043A\u0440\u0430\u043D\u0435 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438.",
  recoveryOff: "\u041D\u0435 \u0437\u0430\u0434\u0430\u043D. \u0411\u0435\u0437 \u043D\u0435\u0433\u043E \u0437\u0430\u0431\u044B\u0442\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C \u043C\u043E\u0436\u043D\u043E \u0438\u0441\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u0440\u0430\u0432\u043A\u043E\u0439 data.json.",
  makeRecovery: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C",
  renewRecovery: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043D\u043E\u0432\u044B\u0439",
  logRecovered: "\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E \u043A\u043B\u044E\u0447\u043E\u043C \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F",
  hideScreen: "\u0421\u043A\u0440\u044B\u0442\u044C \u044D\u043A\u0440\u0430\u043D (\u0431\u0435\u0437 \u043F\u0430\u0440\u043E\u043B\u044F)",
  hideHint: "\u0429\u0451\u043B\u043A\u043D\u0438\u0442\u0435 \u0438\u043B\u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 Esc, \u0447\u0442\u043E\u0431\u044B \u0441\u043D\u043E\u0432\u0430 \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u044D\u043A\u0440\u0430\u043D.",
  coverOnBlur: "\u0421\u043A\u0440\u044B\u0432\u0430\u0442\u044C, \u043A\u043E\u0433\u0434\u0430 \u043E\u043A\u043D\u043E \u0442\u0435\u0440\u044F\u0435\u0442 \u0444\u043E\u043A\u0443\u0441",
  coverOnBlurDesc: "\u0417\u0430\u043A\u0440\u044B\u0432\u0430\u0435\u0442 \u0437\u0430\u043C\u0435\u0442\u043A\u0438, \u043A\u0430\u043A \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0432\u0435\u0440\u0445 \u0432\u044B\u0445\u043E\u0434\u0438\u0442 \u0434\u0440\u0443\u0433\u043E\u0435 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435, \u0430 \u043D\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u0440\u0438 \u0441\u0432\u043E\u0440\u0430\u0447\u0438\u0432\u0430\u043D\u0438\u0438 \u043E\u043A\u043D\u0430. \u0412\u043E\u0437\u0432\u0440\u0430\u0442 \u0432 \u043F\u0440\u0435\u0434\u0435\u043B\u0430\u0445 \u043B\u044C\u0433\u043E\u0442\u043D\u043E\u0433\u043E \u0432\u0440\u0435\u043C\u0435\u043D\u0438 \u043D\u0435 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043F\u0430\u0440\u043E\u043B\u044F. \u041E\u043A\u043D\u043E \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A \u043D\u0435 \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0432\u044B\u0445\u043E\u0434\u043E\u043C.",
  lockOnSystemLock: "\u0411\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u0440\u0438 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0435 \u0438\u043B\u0438 \u0441\u043D\u0435 \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u0430",
  lockOnSystemLockDesc: "\u0422\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u0430. \u0411\u043B\u043E\u043A\u0438\u0440\u0443\u0435\u0442, \u043A\u043E\u0433\u0434\u0430 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u043E\u043D\u043D\u0430\u044F \u0441\u0438\u0441\u0442\u0435\u043C\u0430 \u0431\u043B\u043E\u043A\u0438\u0440\u0443\u0435\u0442 \u044D\u043A\u0440\u0430\u043D \u0438\u043B\u0438 \u0437\u0430\u0441\u044B\u043F\u0430\u0435\u0442. \u041D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0434\u0435\u043B\u0430\u0435\u0442, \u0435\u0441\u043B\u0438 \u044D\u0442\u0430 \u0441\u0431\u043E\u0440\u043A\u0430 Obsidian \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 \u0442\u0430\u043A\u0443\u044E \u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E\u0441\u0442\u044C.",
  deviceOnly: "\u041E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430",
  deviceOnlyDesc: "\u0412\u0440\u0435\u043C\u044F \u0430\u0432\u0442\u043E\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438, \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u043F\u0440\u0438 \u0432\u044B\u0445\u043E\u0434\u0435 \u0438\u0437 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F, \u0441\u043A\u0440\u044B\u0442\u0438\u0435 \u043F\u0440\u0438 \u043F\u043E\u0442\u0435\u0440\u0435 \u0444\u043E\u043A\u0443\u0441\u0430, \u0441\u0438\u0441\u0442\u0435\u043C\u043D\u0430\u044F \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0430 \u0438 \u0443\u043C\u0435\u043D\u044C\u0448\u0435\u043D\u0438\u0435 \u043E\u043A\u043D\u0430 \u0445\u0440\u0430\u043D\u044F\u0442\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0430 \u044D\u0442\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435 \u0438 \u043D\u0435 \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u0443\u044E\u0442\u0441\u044F.",
  logTitle: "\u041D\u0435\u0434\u0430\u0432\u043D\u044F\u044F \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C",
  logDesc: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 50 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043E\u043A, \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043E\u043A \u0438 \u043D\u0435\u0432\u0435\u0440\u043D\u044B\u0445 \u043F\u0430\u0440\u043E\u043B\u0435\u0439 \u043D\u0430 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430\u0445, \u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u0443\u044E\u0449\u0438\u0445 \u044D\u0442\u043E \u0445\u0440\u0430\u043D\u0438\u043B\u0438\u0449\u0435. \u0417\u0430\u0449\u0438\u0442\u044B \u043E\u0442 \u043F\u043E\u0434\u0434\u0435\u043B\u043A\u0438 \u043D\u0435\u0442: \u043A\u0442\u043E \u043C\u043E\u0436\u0435\u0442 \u043F\u0440\u0430\u0432\u0438\u0442\u044C data.json, \u043C\u043E\u0436\u0435\u0442 \u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0438 \u044D\u0442\u043E\u0442 \u0436\u0443\u0440\u043D\u0430\u043B.",
  logEmpty: "\u041F\u043E\u043A\u0430 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043E.",
  logClear: "\u041E\u0447\u0438\u0441\u0442\u0438\u0442\u044C",
  logLocked: "\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E",
  logUnlocked: "\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E",
  logFailed: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C",
  reasonStartup: "\u0437\u0430\u043F\u0443\u0441\u043A",
  reasonIdle: "\u0431\u0435\u0437\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435",
  reasonLeft: "\u0432\u044B\u0445\u043E\u0434 \u0438\u0437 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u044F",
  reasonManual: "\u0432\u0440\u0443\u0447\u043D\u0443\u044E",
  reasonSystem: "\u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D"
};
var ru_default = ru;

// src/i18n/index.ts
var LOCALES = {
  en: en_default,
  ko: ko_default,
  ja: ja_default,
  zh: zh_default,
  "zh-tw": zh_tw_default,
  es: es_default,
  fr: fr_default,
  de: de_default,
  pt: pt_default,
  ru: ru_default
};
function resolveLocale(tag) {
  const l = (tag ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (LOCALES[l]) return l;
  if (/^zh-(tw|hk|mo|hant)/.test(l)) return "zh-tw";
  const base = l.split("-")[0];
  return LOCALES[base] ? base : "en";
}
function detectTag() {
  return navigator.language || "en";
}
function getStrings(tag = detectTag()) {
  return LOCALES[resolveLocale(tag)];
}
function fmt(template, n) {
  return template.replace("{n}", String(n));
}

// src/text.ts
function charCount(text) {
  return Array.from(text).length;
}
function clipChars(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

// src/themes.ts
var THEMES = ["default", "win95", "terminal", "gameboy-snake", "neon-breakout", "obsidian-runner"];
var GAME_IDS = ["snake", "breakout", "runner"];
var GAME_OF = {
  "gameboy-snake": "snake",
  "neon-breakout": "breakout",
  "obsidian-runner": "runner"
};
function gameOf(theme) {
  return GAME_OF[theme] ?? null;
}
var THEME_TEXT = {
  default: {},
  win95: { unlock: "UNLOCK", placeholder: "none" },
  terminal: { unlock: "[UNLOCK]", title: "[ LOCKED ]", unlocked: "[ UNLOCKED ]", placeholder: "none" },
  "gameboy-snake": { unlock: "PLAY & UNLOCK" },
  "neon-breakout": { unlock: "UNLOCK", placeholder: "none" },
  "obsidian-runner": { unlock: "UNLOCK", placeholder: "english" }
};
function parseTheme(raw) {
  return THEMES.includes(raw) ? raw : "default";
}
var MAX_SCORE = 999999;
function emptyHighScores() {
  return { snake: 0, breakout: 0, runner: 0 };
}
function parseHighScores(raw) {
  const out = emptyHighScores();
  if (typeof raw !== "object" || raw === null) return out;
  const r = raw;
  for (const id of GAME_IDS) {
    const v = r[id];
    if (typeof v === "number" && Number.isFinite(v)) out[id] = Math.min(MAX_SCORE, Math.max(0, Math.floor(v)));
  }
  return out;
}
function mergeHighScores(a, b) {
  const out = emptyHighScores();
  for (const id of GAME_IDS) out[id] = Math.max(a[id], b[id]);
  return out;
}

// src/windowSize.ts
var import_obsidian = require("obsidian");
var WINDOW_SIZES = {
  small: { width: 380, height: 520 },
  medium: { width: 460, height: 620 },
  large: { width: 560, height: 720 }
};
var WINDOW_SIZE_NAMES = Object.keys(WINDOW_SIZES);
function remote() {
  try {
    const g = window;
    return g.require?.("electron")?.remote ?? null;
  } catch {
    return null;
  }
}
function electronWindow() {
  if (!import_obsidian.Platform.isDesktopApp) return null;
  try {
    const direct = window.electronWindow;
    const w = direct ?? remote()?.getCurrentWindow?.();
    return w && typeof w.getBounds === "function" && typeof w.setBounds === "function" ? w : null;
  } catch {
    return null;
  }
}
function windowResizeSupported() {
  return electronWindow() !== null;
}
function finite(n, min, max) {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}
function isSavedWindow(x) {
  if (typeof x !== "object" || x === null) return false;
  const s = x;
  const b = s.bounds;
  return typeof s.maximized === "boolean" && typeof b === "object" && b !== null && finite(b.x, -5e4, 5e4) && finite(b.y, -5e4, 5e4) && finite(b.width, 200, 2e4) && finite(b.height, 150, 2e4);
}
function fitToDisplay(b) {
  try {
    const area = remote()?.screen?.getDisplayMatching(b)?.workArea;
    if (!area) return b;
    const width = Math.min(b.width, area.width);
    const height = Math.min(b.height, area.height);
    return {
      width,
      height,
      x: Math.min(Math.max(b.x, area.x), area.x + area.width - width),
      y: Math.min(Math.max(b.y, area.y), area.y + area.height - height)
    };
  } catch {
    return b;
  }
}
function shrinkWindow(size, existing) {
  const w = electronWindow();
  if (!w) return existing;
  try {
    if (w.isFullScreen()) return existing;
    let saved = existing;
    if (!saved) {
      const maximized = w.isMaximized();
      saved = { bounds: maximized && w.getNormalBounds ? w.getNormalBounds() : w.getBounds(), maximized };
    }
    if (w.isMaximized()) w.unmaximize();
    const cur = w.getBounds();
    const target = {
      width: size.width,
      height: size.height,
      x: Math.round(cur.x + cur.width / 2 - size.width / 2),
      y: Math.round(cur.y + cur.height / 2 - size.height / 2)
    };
    w.setBounds(fitToDisplay(target), false);
    return saved;
  } catch {
    return existing;
  }
}
function restoreWindow(saved) {
  const w = electronWindow();
  if (!w) return;
  try {
    w.setBounds(fitToDisplay(saved.bounds), false);
    if (saved.maximized) w.maximize();
  } catch {
  }
}
function watchSystemLock(onLock) {
  const pm = remote()?.powerMonitor;
  if (!pm || typeof pm.on !== "function" || typeof pm.removeListener !== "function") return () => {
  };
  const events = ["lock-screen", "suspend"];
  try {
    for (const e of events) pm.on(e, onLock);
  } catch {
    return () => {
    };
  }
  return () => {
    try {
      for (const e of events) pm.removeListener(e, onLock);
    } catch {
    }
  };
}

// src/lockscreen.ts
var import_obsidian2 = require("obsidian");

// src/pointerfx.ts
var MAX_PARTICLES = 90;
var rnd = (a, b) => a + Math.random() * (b - a);
var PointerFx = class {
  constructor(doc, win, host, kind, colors) {
    this.doc = doc;
    this.win = win;
    this.kind = kind;
    this.colors = colors;
    this.particles = [];
    this.orbs = [];
    this.raf = 0;
    this.lastT = 0;
    this.w = 0;
    // CSS px
    this.h = 0;
    this.scale = 1;
    // canvas px per CSS px
    this.pos = { x: 0, y: 0 };
    this.target = { x: 0, y: 0 };
    this.last = { x: 0, y: 0 };
    this.lastMove = 0;
    this.active = false;
    // pointer has been seen at least once
    this.destroyed = false;
    this.frame = (t) => {
      this.raf = 0;
      if (this.destroyed) return;
      const dt = Math.min(0.05, Math.max(1e-3, (t - this.lastT) / 1e3));
      this.lastT = t;
      this.update(dt, t / 1e3);
      this.draw(t / 1e3);
      if (this.needsFrame()) this.raf = this.win.requestAnimationFrame(this.frame);
    };
    // ---- simulation ---------------------------------------------------------------------------
    this.glowAlpha = 0;
    this.rgb = colors.map((c) => resolveColor(doc, c) ?? [124, 92, 214]);
    this.canvas = doc.createElement("canvas");
    this.canvas.className = "vault-lock-fx";
    this.canvas.setAttribute("aria-hidden", "true");
    host.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.onMove = (e) => {
      this.target.x = e.clientX;
      this.target.y = e.clientY;
      if (!this.active) {
        this.active = true;
        this.pos.x = this.last.x = e.clientX;
        this.pos.y = this.last.y = e.clientY;
      }
      this.lastMove = performance.now();
      if (this.kind === "trail") this.spawnAlongPath(e.clientX, e.clientY);
      this.last.x = e.clientX;
      this.last.y = e.clientY;
      this.kick();
    };
    this.onVis = () => doc.hidden ? this.stopLoop() : this.kick();
    this.onResize = () => this.resize();
    doc.addEventListener("pointermove", this.onMove, { passive: true });
    doc.addEventListener("pointerdown", this.onMove, { passive: true });
    doc.addEventListener("visibilitychange", this.onVis);
    win.addEventListener("resize", this.onResize);
    this.resize();
    this.pos.x = this.target.x = this.last.x = this.w / 2;
    this.pos.y = this.target.y = this.last.y = this.h / 2;
    if (kind === "orbs") this.makeOrbs();
    this.kick();
  }
  destroy() {
    this.destroyed = true;
    this.stopLoop();
    this.doc.removeEventListener("pointermove", this.onMove);
    this.doc.removeEventListener("pointerdown", this.onMove);
    this.doc.removeEventListener("visibilitychange", this.onVis);
    this.win.removeEventListener("resize", this.onResize);
    this.canvas.remove();
  }
  // ---- loop ---------------------------------------------------------------------------------
  kick() {
    if (this.destroyed || this.raf || this.doc.hidden) return;
    this.lastT = performance.now();
    this.raf = this.win.requestAnimationFrame(this.frame);
  }
  stopLoop() {
    if (this.raf) this.win.cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  needsFrame() {
    const recently = performance.now() - this.lastMove < 2500;
    if (this.kind === "orbs") return true;
    if (this.kind === "trail") return this.particles.length > 0 || recently;
    const dx = this.target.x - this.pos.x;
    const dy = this.target.y - this.pos.y;
    return recently || dx * dx + dy * dy > 1 || this.glowAlpha > 0.01;
  }
  resize() {
    this.w = this.win.innerWidth;
    this.h = this.win.innerHeight;
    const dpr = Math.min(2, this.win.devicePixelRatio || 1);
    this.scale = dpr;
    this.canvas.width = Math.max(1, Math.ceil(this.w * this.scale));
    this.canvas.height = Math.max(1, Math.ceil(this.h * this.scale));
    this.draw(performance.now() / 1e3);
  }
  update(dt, time) {
    const recently = performance.now() - this.lastMove < 2500;
    const ease = 1 - Math.pow(8e-4, dt);
    this.pos.x += (this.target.x - this.pos.x) * ease;
    this.pos.y += (this.target.y - this.pos.y) * ease;
    this.glowAlpha += ((recently ? 1 : 0) - this.glowAlpha) * Math.min(1, dt * 2.2);
    if (this.kind === "trail") {
      for (const p of this.particles) {
        p.age += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.vx *= 1 - 0.8 * dt;
      }
      for (let i = this.particles.length - 1; i >= 0; i--) if (this.particles[i].age >= this.particles[i].life) this.particles.splice(i, 1);
    }
    if (this.kind === "orbs") {
      const cx = this.w / 2;
      const cy = this.h / 2;
      for (const o of this.orbs) {
        o.ang += o.w * dt;
        const tx = recently || this.active ? this.target.x + Math.cos(o.ang) * o.rad : cx + Math.cos(time * 0.3 + o.ci) * this.w * 0.28;
        const ty = recently || this.active ? this.target.y + Math.sin(o.ang) * o.rad : cy + Math.sin(time * 0.37 + o.ci * 1.7) * this.h * 0.22;
        o.vx += (tx - o.x) * o.k;
        o.vy += (ty - o.y) * o.k;
        o.vx *= 0.88;
        o.vy *= 0.88;
        o.x += o.vx;
        o.y += o.vy;
      }
    }
  }
  makeOrbs() {
    const n = 5;
    for (let i = 0; i < n; i++) {
      this.orbs.push({
        x: this.w / 2,
        y: this.h / 2,
        vx: 0,
        vy: 0,
        r: rnd(16, 36),
        ci: i % this.colors.length,
        k: 0.012 + i * 0.011,
        ang: i / n * Math.PI * 2,
        rad: 40 + i * 18,
        w: (i % 2 ? 1 : -1) * rnd(0.7, 1.6)
      });
    }
  }
  spawnAlongPath(x, y) {
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const spacing = 9;
    const n = Math.min(6, Math.floor(dist / spacing));
    for (let i = 1; i <= n; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const f2 = i / n;
      this.particles.push({
        x: this.last.x + dx * f2,
        y: this.last.y + dy * f2,
        vx: rnd(-18, 18),
        vy: rnd(-18, 18),
        age: 0,
        life: rnd(0.8, 1.3),
        size: rnd(5, 13),
        rot: rnd(0, Math.PI * 2),
        vr: rnd(-3, 3),
        ci: Math.floor(Math.random() * this.colors.length)
      });
    }
  }
  // ---- drawing ------------------------------------------------------------------------------
  draw(time) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.drawDefault(ctx, time);
  }
  /** Same colour at a given alpha. Gradients must fade to this, not to "transparent" (transparent black),
   *  or the browser interpolates through grey and leaves a dark rim. */
  rgba(i, a) {
    const c = this.rgb[i % this.rgb.length];
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
  }
  drawDefault(ctx, _time) {
    if (this.kind === "glow") {
      const r = Math.min(this.w, this.h) * 0.34;
      const g = ctx.createRadialGradient(this.pos.x, this.pos.y, 0, this.pos.x, this.pos.y, r);
      ctx.globalAlpha = 0.55 * this.glowAlpha;
      g.addColorStop(0, this.rgba(0, 1));
      g.addColorStop(0.45, this.rgba(1, 0.55));
      g.addColorStop(1, this.rgba(1, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.pos.x, this.pos.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else if (this.kind === "trail") {
      for (const p of this.particles) {
        const f2 = 1 - p.age / p.life;
        const r = p.size * (0.4 + f2 * 0.8);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, this.rgba(p.ci, 1));
        g.addColorStop(1, this.rgba(p.ci, 0));
        ctx.globalAlpha = 0.85 * f2;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      for (const o of this.orbs) {
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 1.8);
        g.addColorStop(0, this.rgba(o.ci, 1));
        g.addColorStop(0.5, this.rgba(o.ci, 0.9));
        g.addColorStop(1, this.rgba(o.ci, 0));
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
};

// src/pixelicons.ts
var W = 14;
var pad = (inner, margin) => ".".repeat(margin) + inner + ".".repeat(W - margin - inner.length);
var body = (inner) => {
  if (inner.length !== 10) throw new Error(`pixel lock body row must be 10 wide, got ${inner.length}`);
  return pad(`o${inner}o`, 1);
};
var f = "f".repeat(10);
var SHACKLE_TOP = [pad("oooooo", 4), pad(`o${"s".repeat(6)}o`, 3)];
var BODY = [
  pad("o".repeat(12), 1),
  body(f),
  body(f),
  body("fffkkkkfff"),
  // keyhole: round top ...
  body("ffffkkffff"),
  // ... and a stem
  body("ffffkkffff"),
  body(f),
  body("s".repeat(10)),
  pad("o".repeat(12), 1)
];
var LOCK_CLOSED = [
  ...SHACKLE_TOP,
  ...Array.from({ length: 4 }, () => pad(`os${".".repeat(6)}so`, 2)),
  ...BODY
];
var LOCK_OPEN = [
  ...SHACKLE_TOP,
  pad(`os${".".repeat(6)}so`, 2),
  pad(`os${".".repeat(6)}so`, 2),
  pad(`os${".".repeat(6)}..`, 2),
  pad(`os${".".repeat(6)}..`, 2),
  ...BODY
];
function pixelLock(doc, open, palette2) {
  const rows = open ? LOCK_OPEN : LOCK_CLOSED;
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${rows.length}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (c === ".") continue;
      const r = doc.createElementNS(NS, "rect");
      r.setAttribute("x", String(x));
      r.setAttribute("y", String(y));
      r.setAttribute("width", "1");
      r.setAttribute("height", "1");
      r.setAttribute("fill", palette2[c]);
      svg.append(r);
    }
  });
  return svg;
}

// src/desktopicons.ts
var PALETTE = {
  k: "#000000",
  w: "#ffffff",
  g: "#c0c0c0",
  d: "#808080",
  y: "#ffff66",
  Y: "#c0a000",
  b: "#0000c0",
  c: "#40e0e0",
  n: "#009000"
};
var COMPUTER = [
  "................",
  ".kkkkkkkkkkkkkk.",
  ".kggggggggggggk.",
  ".kgddddddddddgk.",
  ".kgdwwwcccccdgk.",
  ".kgdwcccccccdgk.",
  ".kgdwcccccccdgk.",
  ".kgdccccccccdgk.",
  ".kgddddddddddgk.",
  ".kgggggggggnngk.",
  ".kkkkkkkkkkkkkk.",
  "......kkkk......",
  "......kkkk......",
  "..kwwwwwwwwwwk..",
  "..kkkkkkkkkkkk..",
  "................"
];
var FOLDER = [
  "................",
  "................",
  ".kkkkkk.........",
  ".kyyyyk.........",
  ".kkkkkkkkkkkkkk.",
  ".kwwwwwwwwwwwwk.",
  ".kyyyyyyyyyyyYk.",
  ".kyyyyyyyyyyyYk.",
  ".kyyyyyyyyyyyYk.",
  ".kyyyyyyyyyyyYk.",
  ".kyyyyyyyyyyyYk.",
  ".kyyyyyyyyyyyYk.",
  ".kYYYYYYYYYYYYk.",
  ".kkkkkkkkkkkkkk.",
  "................",
  "................"
];
var GLOBE = [
  "......kkkk......",
  "....kkkkkkkk....",
  "...kkcccbbbkk...",
  "..kknnnbbnnbkk..",
  ".kknnnbbbbnnbkk.",
  ".kbcnnbbbbbbbbk.",
  "kkbcbbbbnnnnbbkk",
  "kkbbcbbbbnnnbbkk",
  "kkbbbbbbbbnnbbkk",
  "kkbbbbnnbbbbbbkk",
  ".kbbbbnnnbbbbbk.",
  ".kkbbbbnnbbbbkk.",
  "..kkbbbbbbbbkk..",
  "...kkbbbbbbkk...",
  "....kkkkkkkk....",
  "......kkkk......"
];
var BIN = [
  "......kggk......",
  "......kkkk......",
  "..kkkkkkkkkkkk..",
  "..kkkkkkkkkkkk..",
  "...kkkkkkkkkk...",
  "...kgwgdgwgdk...",
  "...kgwgdgwgdk...",
  "...kgwgdgwgdk...",
  "...kgwgnnwgdk...",
  "...kgwndgngdk...",
  "...kgwgnnwgdk...",
  "...kgwndgngdk...",
  "...kgwgdgwgdk...",
  "...kgdddddddk...",
  "...kkkkkkkkkk...",
  "................"
];
var DESKTOP_ICONS = [
  { id: "computer", label: "My Computer", rows: COMPUTER },
  { id: "folder", label: "My Documents", rows: FOLDER },
  { id: "internet", label: "Internet", rows: GLOBE },
  { id: "bin", label: "Recycle Bin", rows: BIN }
];
function bitmapSvg(doc, rows, palette2) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${rows[0]?.length ?? 0} ${rows.length}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      const fill = palette2[c];
      if (!fill) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      const r = doc.createElementNS(NS, "rect");
      r.setAttribute("x", String(x));
      r.setAttribute("y", String(y));
      r.setAttribute("width", String(end - x));
      r.setAttribute("height", "1");
      r.setAttribute("fill", fill);
      svg.append(r);
      x = end;
    }
  });
  return svg;
}
function buildDesktop(doc, into) {
  const figures = DESKTOP_ICONS.map((icon) => {
    const fig = doc.createElement("div");
    fig.className = `vl-icon vl-icon-${icon.id}`;
    const cap = doc.createElement("span");
    cap.className = "vl-icon-label";
    cap.textContent = icon.label;
    fig.append(bitmapSvg(doc, icon.rows, PALETTE), cap);
    return fig;
  });
  into.replaceChildren(...figures);
}

// src/pixeltext.ts
var GLYPHS = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ":": [".", ".", "#", ".", "#", ".", "."]
};
var GLYPH_ROWS = 7;
var isPixelChar = (c) => c in GLYPHS;
function runsOf(text) {
  const out = [];
  for (const ch of Array.from(text)) {
    const pixel = isPixelChar(ch);
    const last = out[out.length - 1];
    if (last && last.pixel === pixel) last.text += ch;
    else out.push({ pixel, text: ch });
  }
  return out;
}
function pixelWidth(text) {
  const chars = Array.from(text).filter(isPixelChar);
  return chars.reduce((w, ch) => w + GLYPHS[ch][0].length, 0) + Math.max(0, chars.length - 1);
}
function pixelSvg(doc, text) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${pixelWidth(text)} ${GLYPH_ROWS}`);
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("vl-px-digits");
  let x = 0;
  for (const ch of Array.from(text)) {
    const rows = GLYPHS[ch];
    if (!rows) continue;
    rows.forEach((row, y) => {
      let c = 0;
      while (c < row.length) {
        if (row[c] !== "#") {
          c++;
          continue;
        }
        let end = c + 1;
        while (end < row.length && row[end] === "#") end++;
        const r = doc.createElementNS(NS, "rect");
        r.setAttribute("x", String(x + c));
        r.setAttribute("y", String(y));
        r.setAttribute("width", String(end - c));
        r.setAttribute("height", "1");
        svg.append(r);
        c = end;
      }
    });
    x += rows[0].length + 1;
  }
  return svg;
}

// src/games/game.ts
var PAUSED_LINES = ["PAUSED", "ESC: BACK TO GAME"];

// src/games/breakout.ts
var W2 = 280;
var H = 320;
var HUD = 24;
var COLS = 8;
var ROWS = 5;
var BRICK_W = 29;
var BRICK_H = 11;
var BRICK_GAP = 4;
var BRICK_TOP = HUD + 18;
var BRICK_LEFT = (W2 - (COLS * BRICK_W + (COLS - 1) * BRICK_GAP)) / 2;
var PADDLE_W = 52;
var PADDLE_H = 6;
var PADDLE_Y = H - 28;
var PADDLE_SPEED = 340;
var BALL_R = 4;
var MAX_ANGLE = 62 * Math.PI / 180;
var MIN_ANGLE = 9 * Math.PI / 180;
var START_LIVES = 3;
var POINTS = 10;
var clamp = (n, min, max) => Math.min(max, Math.max(min, n));
function ballSpeed(level) {
  return Math.min(330, 200 + (level - 1) * 20);
}
function makeBricks() {
  const out = [];
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) out.push({ x: BRICK_LEFT + col * (BRICK_W + BRICK_GAP), y: BRICK_TOP + row * (BRICK_H + BRICK_GAP), row });
  return out;
}
function newGame() {
  const s = {
    paddle: { x: W2 / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H },
    ball: { x: W2 / 2, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, r: BALL_R },
    bricks: makeBricks(),
    lives: START_LIVES,
    level: 1,
    score: 0,
    status: "ready"
  };
  return s;
}
function stick(s) {
  s.ball.x = s.paddle.x;
  s.ball.y = s.paddle.y - s.ball.r;
  s.ball.vx = s.ball.vy = 0;
}
function movePaddleTo(s, x) {
  s.paddle.x = clamp(x, s.paddle.w / 2, W2 - s.paddle.w / 2);
  if (s.status === "ready") stick(s);
}
function launch(s, rng) {
  if (s.status !== "ready") return;
  const angle = (rng() - 0.5) * 0.7;
  const speed = ballSpeed(s.level);
  s.ball.vx = speed * Math.sin(angle);
  s.ball.vy = -speed * Math.cos(angle);
  s.status = "running";
}
function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = clamp(cx, rx, rx + rw);
  const ny = clamp(cy, ry, ry + rh);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}
function loseLife(s) {
  s.lives -= 1;
  if (s.lives <= 0) {
    s.lives = 0;
    s.status = "over";
    return;
  }
  s.status = "ready";
  stick(s);
}
function nextLevel(s) {
  s.level += 1;
  s.bricks = makeBricks();
  s.status = "ready";
  stick(s);
}
function stepBall(s, dt) {
  const b = s.ball;
  const prevX = b.x;
  const prevY = b.y;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x - b.r < 0) {
    b.x = b.r;
    b.vx = Math.abs(b.vx);
  } else if (b.x + b.r > W2) {
    b.x = W2 - b.r;
    b.vx = -Math.abs(b.vx);
  }
  if (b.y - b.r < HUD) {
    b.y = HUD + b.r;
    b.vy = Math.abs(b.vy);
  }
  const p = s.paddle;
  if (b.vy > 0 && prevY + b.r <= p.y + 2 && b.y + b.r >= p.y && b.x >= p.x - p.w / 2 - b.r && b.x <= p.x + p.w / 2 + b.r) {
    const offset = clamp((b.x - p.x) / (p.w / 2 + b.r), -1, 1);
    const speed2 = Math.hypot(b.vx, b.vy);
    let angle = offset * MAX_ANGLE;
    if (Math.abs(angle) < MIN_ANGLE) angle = (offset < 0 || offset === 0 && b.vx < 0 ? -1 : 1) * MIN_ANGLE;
    b.vx = speed2 * Math.sin(angle);
    b.vy = -speed2 * Math.cos(angle);
    b.y = p.y - b.r;
  }
  for (let i = 0; i < s.bricks.length; i++) {
    const k = s.bricks[i];
    if (!circleHitsRect(b.x, b.y, b.r, k.x, k.y, BRICK_W, BRICK_H)) continue;
    s.bricks.splice(i, 1);
    s.score += POINTS;
    if (prevX < k.x || prevX > k.x + BRICK_W) b.vx = -b.vx;
    else b.vy = -b.vy;
    break;
  }
  const speed = Math.hypot(b.vx, b.vy);
  const minVy = speed * 0.2;
  if (speed > 0 && Math.abs(b.vy) < minVy) {
    b.vy = (b.vy < 0 ? -1 : 1) * minVy;
    b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(speed * speed - minVy * minVy);
  }
  if (s.bricks.length === 0) nextLevel(s);
  else if (b.y - b.r > H) loseLife(s);
}
function tick(s, dt, dir) {
  if (s.status === "over") return;
  if (dir !== 0) movePaddleTo(s, s.paddle.x + dir * PADDLE_SPEED * dt);
  if (s.status !== "running") return;
  const dist = Math.hypot(s.ball.vx, s.ball.vy) * dt;
  const n = Math.max(1, Math.ceil(dist / 2));
  for (let i = 0; i < n && s.status === "running"; i++) stepBall(s, dt / n);
}
var NEON = {
  bg: "#070816",
  frame: "#312e6b",
  cyan: "#5ad2e6",
  magenta: "#d46ee6",
  purple: "#9d8cf0",
  text: "#b8c4e6",
  dim: "#4b4f86"
};
var ROW_COLORS = [NEON.magenta, NEON.purple, NEON.cyan, NEON.purple, NEON.magenta];
var FONT = "10px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
var pad4 = (n) => String(Math.min(n, 999999)).padStart(4, "0");
var BreakoutGame = class {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.id = "breakout";
    this.width = W2;
    this.height = H;
    this.s = newGame();
    this.best = 0;
    this.left = false;
    this.right = false;
  }
  get dir() {
    return this.left === this.right ? 0 : this.left ? -1 : 1;
  }
  /** Also true while only the paddle is being moved by a held key, so it glides instead of stepping. */
  get running() {
    return this.s.status === "running" || this.s.status === "ready" && this.dir !== 0;
  }
  get score() {
    return this.s.score;
  }
  setHighScore(score) {
    this.best = score;
  }
  reset() {
    this.s = newGame();
    this.releaseKeys();
  }
  releaseKeys() {
    this.left = this.right = false;
  }
  update(dt) {
    tick(this.s, dt, this.dir);
  }
  key(code, down) {
    if (code === "ArrowLeft" || code === "KeyA") {
      this.left = down;
      return true;
    }
    if (code === "ArrowRight" || code === "KeyD") {
      this.right = down;
      return true;
    }
    if (code === "Space") {
      if (down) this.primary();
      return true;
    }
    return false;
  }
  pointer(x) {
    if (this.s.status !== "over") movePaddleTo(this.s, x);
  }
  pointerDown() {
    this.primary();
    return true;
  }
  /** Space or a click: launch the ball, or start over after the last life. */
  primary() {
    if (this.s.status === "ready") launch(this.s, this.rng);
    else if (this.s.status === "over") {
      this.s = newGame();
      this.releaseKeys();
    }
  }
  draw(ctx, paused) {
    const s = this.s;
    ctx.fillStyle = NEON.bg;
    ctx.fillRect(0, 0, W2, H);
    ctx.lineWidth = 1;
    ctx.strokeStyle = NEON.frame;
    ctx.strokeRect(0.5, HUD + 0.5, W2 - 1, H - HUD - 1);
    ctx.font = FONT;
    ctx.textBaseline = "middle";
    ctx.fillStyle = NEON.text;
    ctx.textAlign = "left";
    ctx.fillText(`SCORE ${pad4(s.score)}`, 6, HUD / 2);
    ctx.textAlign = "right";
    ctx.fillText(`HI ${pad4(Math.max(this.best, s.score))}`, W2 - 6, HUD / 2);
    for (let i = 0; i < START_LIVES; i++) {
      ctx.strokeStyle = i < s.lives ? NEON.magenta : NEON.dim;
      ctx.beginPath();
      ctx.arc(W2 / 2 - 12 + i * 12, HUD / 2, 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const k of s.bricks) {
      ctx.strokeStyle = ROW_COLORS[k.row % ROW_COLORS.length];
      ctx.strokeRect(Math.round(k.x) + 0.5, Math.round(k.y) + 0.5, BRICK_W - 1, BRICK_H - 1);
    }
    ctx.strokeStyle = NEON.cyan;
    ctx.strokeRect(Math.round(s.paddle.x - s.paddle.w / 2) + 0.5, s.paddle.y + 0.5, s.paddle.w - 1, s.paddle.h - 1);
    ctx.strokeStyle = NEON.cyan;
    ctx.beginPath();
    ctx.arc(s.ball.x, s.ball.y, s.ball.r - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    const msg = paused ? PAUSED_LINES : s.status === "ready" ? ["CLICK OR SPACE", "MOUSE OR ARROWS MOVE"] : s.status === "over" ? ["GAME OVER", "SPACE TO RETRY"] : null;
    if (msg) {
      const bw = 160;
      const bh = 40;
      const bx = Math.round((W2 - bw) / 2);
      const by = Math.round(H * 0.58);
      ctx.fillStyle = NEON.bg;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = NEON.purple;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      ctx.textAlign = "center";
      ctx.fillStyle = NEON.cyan;
      ctx.fillText(msg[0], W2 / 2, by + 14);
      ctx.fillStyle = NEON.text;
      ctx.fillText(msg[1], W2 / 2, by + 28);
    }
  }
};

// src/games/pixels.ts
var bitmapSize = (rows) => ({ w: rows[0]?.length ?? 0, h: rows.length });
function drawBitmap(ctx, rows, palette2, x, y, scale) {
  const ox = Math.round(x);
  const oy = Math.round(y);
  rows.forEach((row, ry) => {
    let rx = 0;
    while (rx < row.length) {
      const c = row[rx];
      if (c === ".") {
        rx++;
        continue;
      }
      let end = rx + 1;
      while (end < row.length && row[end] === c) end++;
      ctx.fillStyle = palette2[c];
      ctx.fillRect(ox + rx * scale, oy + ry * scale, (end - rx) * scale, scale);
      rx = end;
    }
  });
}

// src/games/runner.ts
var HEAD = [
  ".gggggg.......",
  ".gggggg.......",
  ".pppppppppppp.",
  ".ffffffffffff.",
  ".ffkffffffkff.",
  ".ffffffffffff.",
  ".gggggggggggg."
];
var BODY2 = [
  "....ssssss....",
  "...ssssssss...",
  "..ssssssssss..",
  "...ssssssss...",
  "...ssssssss..."
];
var RUN_A = [...HEAD, ...BODY2, "...ll....ll...", "...ll....ll...", "...ll.........", "..lll........."];
var RUN_B = [...HEAD, ...BODY2, "...ll....ll...", "...ll....ll...", ".........ll...", ".........lll.."];
var JUMP = [...HEAD, ...BODY2, "...ll....ll...", "...ll....ll...", "..lll....lll..", ".............."];
var SPIKE = ["...s...", "...s...", "..sss..", "..sss..", ".sssss.", ".sssss.", "sssssss", "sssssss"];
var LOCKED_FOLDER = [
  ".gggg.......",
  "ffffffffffff",
  "ffffooooffff",
  "ffffoffoffff",
  "fffoooooofff",
  "fffoyyyyofff",
  "fffoyyyyofff",
  "fffoooooofff",
  "ffffffffffff",
  "gggggggggggg"
];
var CLOUD = [
  "......ccc...........",
  "....ccccccc...ccc...",
  "..ccccccccccccccccc.",
  "ccccccccccccccccccc.",
  ".cccccccccccccccccc."
];
var PALETTE2 = {
  g: "#9ca3af",
  f: "#e5e7eb",
  p: "#ffffff",
  k: "#1f2937",
  s: "#6b7280",
  l: "#e0925c",
  o: "#1f2937",
  y: "#d9ad5f",
  c: "#62636a"
};
var SPIKE_PALETTE = { s: "#b4b9c2" };
var W3 = 320;
var H2 = 160;
var GROUND_Y = 130;
var S = 2;
var CHAR_X = 36;
var CHAR_W = bitmapSize(RUN_A).w * S;
var CHAR_H = bitmapSize(RUN_A).h * S;
var GRAVITY = 1650;
var JUMP_V = 440;
var START_SPEED = 150;
var MAX_SPEED = 340;
var ACCEL = 5;
var CLOUD_TOP = 22;
var CLOUD_SPAN = 24;
var HIT = { left: 6, right: 6, top: 5 };
var OBSTACLE_INSET = 3;
function newGame2(rng) {
  return {
    status: "idle",
    y: 0,
    vy: 0,
    speed: START_SPEED,
    dist: 0,
    t: 0,
    untilNext: 240,
    obstacles: [],
    clouds: [0, 1, 2].map((i) => ({ x: 20 + i * 115 + rng() * 40, y: CLOUD_TOP + rng() * CLOUD_SPAN }))
  };
}
function start(s) {
  if (s.status === "idle") s.status = "running";
}
var onGround = (s) => s.y === 0;
function jump(s) {
  if (s.status !== "running" || !onGround(s)) return;
  s.vy = JUMP_V;
}
var scoreOf = (s) => Math.floor(s.dist / 10);
function gapFor(speed, rng) {
  return 0.7 * speed + 80 + rng() * 160;
}
function spawnObstacle(rng) {
  if (rng() < 0.35) {
    const b2 = bitmapSize(LOCKED_FOLDER);
    return { x: W3 + 4, kind: "folder", count: 1, w: b2.w * S, h: b2.h * S };
  }
  const count = 1 + Math.min(2, Math.floor(rng() * 3));
  const b = bitmapSize(SPIKE);
  return { x: W3 + 4, kind: "spikes", count, w: b.w * S * count, h: b.h * S };
}
function hits(s, o) {
  const cl = CHAR_X + HIT.left;
  const cr = CHAR_X + CHAR_W - HIT.right;
  const cb = GROUND_Y - s.y;
  const ct = cb - CHAR_H + HIT.top;
  const ol = o.x + OBSTACLE_INSET;
  const or = o.x + o.w - OBSTACLE_INSET;
  const ot = GROUND_Y - o.h + 2;
  return cr > ol && cl < or && cb > ot && ct < GROUND_Y;
}
function tick2(s, dt, rng) {
  if (s.status !== "running") return;
  s.t += dt;
  s.speed = Math.min(MAX_SPEED, START_SPEED + ACCEL * s.t);
  const run = s.speed * dt;
  s.dist += run;
  if (s.y > 0 || s.vy > 0) {
    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    if (s.y <= 0) {
      s.y = 0;
      s.vy = 0;
    }
  }
  for (const o of s.obstacles) o.x -= run;
  s.obstacles = s.obstacles.filter((o) => o.x + o.w > 0);
  s.untilNext -= run;
  if (s.untilNext <= 0) {
    const o = spawnObstacle(rng);
    s.obstacles.push(o);
    s.untilNext = o.w + gapFor(s.speed, rng);
  }
  for (const c of s.clouds) {
    c.x -= run * 0.2;
    if (c.x < -CLOUD[0].length * S) {
      c.x = W3 + rng() * 60;
      c.y = CLOUD_TOP + rng() * CLOUD_SPAN;
    }
  }
  if (s.obstacles.some((o) => hits(s, o))) s.status = "over";
}
var BG = "#2a2a2d";
var GROUND = "#6b7280";
var TEXT = "#d1d5db";
var TEXT_DIM = "#8b9099";
var FONT2 = "bold 11px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
var pad5 = (n) => String(Math.min(n, 99999)).padStart(5, "0");
function hash(n) {
  return Math.imul(n ^ 2654435769, 2654435761) >>> 0;
}
var RunnerGame = class {
  constructor(rng = Math.random) {
    this.rng = rng;
    this.id = "runner";
    this.width = W3;
    this.height = H2;
    this.best = 0;
    this.s = newGame2(rng);
  }
  get running() {
    return this.s.status === "running";
  }
  get score() {
    return scoreOf(this.s);
  }
  setHighScore(score) {
    this.best = score;
  }
  reset() {
    this.s = newGame2(this.rng);
  }
  update(dt) {
    tick2(this.s, dt, this.rng);
  }
  key(code, down) {
    if (code !== "Space" && code !== "ArrowUp" && code !== "KeyW") return false;
    if (down) this.primary();
    return true;
  }
  pointerDown() {
    this.primary();
    return true;
  }
  /** Space, Up or a tap: start, jump, or start over. */
  primary() {
    if (this.s.status === "over") this.s = newGame2(this.rng);
    if (this.s.status === "idle") start(this.s);
    jump(this.s);
  }
  draw(ctx, paused) {
    const s = this.s;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W3, H2);
    for (const c of s.clouds) drawBitmap(ctx, CLOUD, PALETTE2, c.x, c.y, S);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, GROUND_Y, W3, 1);
    const off = Math.floor(s.dist);
    for (let x = -(off % 8); x < W3; x += 8) {
      const h = hash(Math.floor((x + off) / 8));
      if (h % 3 !== 0) continue;
      ctx.fillRect(x, GROUND_Y + 5 + (h >>> 8) % 3 * 6, 2 + (h >>> 4) % 5, 1);
    }
    for (const o of s.obstacles) {
      if (o.kind === "folder") drawBitmap(ctx, LOCKED_FOLDER, PALETTE2, o.x, GROUND_Y - o.h, S);
      else for (let i = 0; i < o.count; i++) drawBitmap(ctx, SPIKE, SPIKE_PALETTE, o.x + i * SPIKE[0].length * S, GROUND_Y - o.h, S);
    }
    const frame = s.y > 0 ? JUMP : Math.floor(s.t / 0.09) % 2 === 0 ? RUN_A : RUN_B;
    drawBitmap(ctx, s.status === "over" ? JUMP : frame, PALETTE2, CHAR_X, GROUND_Y - s.y - CHAR_H, S);
    ctx.font = FONT2;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.fillStyle = TEXT;
    ctx.fillText(pad5(this.score), W3 - 8, 12);
    ctx.fillStyle = TEXT_DIM;
    ctx.fillText(`HI ${pad5(Math.max(this.best, this.score))}`, W3 - 8 - 5 * 7 - 10, 12);
    const msg = paused ? PAUSED_LINES : s.status === "idle" ? ["PRESS SPACE", "OR UP ARROW"] : s.status === "over" ? ["GAME OVER", "SPACE TO RETRY"] : null;
    if (msg) {
      ctx.textAlign = "center";
      ctx.fillStyle = TEXT;
      ctx.font = "bold 12px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
      ctx.fillText(msg[0], W3 / 2, 70);
      ctx.fillStyle = TEXT_DIM;
      ctx.font = "10px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
      ctx.fillText(msg[1], W3 / 2, 86);
    }
  }
};

// src/games/snake.ts
var DELTA = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
var OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
var MAX_QUEUE = 2;
function newGame3(cols, rows, rng) {
  const y = Math.floor(rows / 2);
  const x = Math.floor(cols / 2);
  const s = {
    cols,
    rows,
    snake: [
      { x, y },
      { x: x - 1, y },
      { x: x - 2, y }
    ],
    dir: "right",
    queue: [],
    food: null,
    score: 0,
    status: "idle",
    acc: 0
  };
  s.food = placeFood(s, rng);
  return s;
}
function start2(s) {
  if (s.status === "idle") s.status = "running";
}
function speedFor(score) {
  return Math.min(14, 7 + score * 0.3);
}
function turn(s, d) {
  if (s.status !== "running") return;
  const last = s.queue.length > 0 ? s.queue[s.queue.length - 1] : s.dir;
  if (d === last || d === OPPOSITE[last]) return;
  if (s.queue.length < MAX_QUEUE) s.queue.push(d);
}
var same = (a, b) => a.x === b.x && a.y === b.y;
var onSnake = (s, p) => s.snake.some((q) => same(q, p));
function placeFood(s, rng) {
  const free = [];
  for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) if (!onSnake(s, { x, y })) free.push({ x, y });
  if (free.length === 0) return null;
  return free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
}
function step(s, rng) {
  if (s.status !== "running") return "moved";
  const next = s.queue.shift();
  if (next) s.dir = next;
  const d = DELTA[s.dir];
  const head = { x: s.snake[0].x + d.x, y: s.snake[0].y + d.y };
  if (head.x < 0 || head.y < 0 || head.x >= s.cols || head.y >= s.rows) return die(s);
  const eating = s.food !== null && same(head, s.food);
  const body2 = eating ? s.snake : s.snake.slice(0, -1);
  if (body2.some((q) => same(q, head))) return die(s);
  s.snake.unshift(head);
  if (!eating) {
    s.snake.pop();
    return "moved";
  }
  s.score += 1;
  s.food = placeFood(s, rng);
  if (s.food === null) {
    s.status = "won";
    return "won";
  }
  return "ate";
}
function die(s) {
  s.status = "over";
  return "died";
}
function tick3(s, dt, rng) {
  if (s.status !== "running") return;
  s.acc += dt;
  const interval = 1 / speedFor(s.score);
  while (s.acc >= interval && s.status === "running") {
    s.acc -= interval;
    step(s, rng);
  }
}
var LCD = { darkest: "#0F380F", dark: "#306230", light: "#8BAC0F", lightest: "#9BBC0F" };
var COLS2 = 18;
var ROWS2 = 18;
var CELL = 12;
var WALL = 1;
var HUD2 = 26;
var W4 = (COLS2 + 2 * WALL) * CELL;
var H3 = HUD2 + (ROWS2 + 2 * WALL) * CELL;
var KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
var pad2 = (n) => String(Math.min(n, 99)).padStart(2, "0");
var SnakeGame = class {
  // where the last touch or click landed, in canvas px
  constructor(rng = Math.random) {
    this.rng = rng;
    this.id = "snake";
    this.width = W4;
    this.height = H3;
    this.best = 0;
    this.ptr = null;
    this.s = newGame3(COLS2, ROWS2, rng);
  }
  get running() {
    return this.s.status === "running";
  }
  get score() {
    return this.s.score;
  }
  setHighScore(score) {
    this.best = score;
  }
  reset() {
    this.s = newGame3(COLS2, ROWS2, this.rng);
  }
  update(dt) {
    tick3(this.s, dt, this.rng);
  }
  key(code, down) {
    if (!down) return code in KEYS || code === "Space";
    const dir = KEYS[code];
    if (dir) {
      if (this.s.status === "idle") start2(this.s);
      turn(this.s, dir);
      return true;
    }
    if (code === "Space") {
      if (this.s.status === "idle") start2(this.s);
      else if (this.s.status === "over" || this.s.status === "won") {
        this.s = newGame3(COLS2, ROWS2, this.rng);
        start2(this.s);
      }
      return true;
    }
    return false;
  }
  pointer(x, y) {
    this.ptr = { x, y };
  }
  /** Start or restart with a tap; while running, a tap steers toward the tapped side of the head (no keys on a phone). */
  pointerDown() {
    const s = this.s;
    if (s.status === "idle") start2(s);
    else if (s.status === "over" || s.status === "won") {
      this.s = newGame3(COLS2, ROWS2, this.rng);
      start2(this.s);
    } else if (s.status === "running" && this.ptr) {
      const hx = WALL * CELL + s.snake[0].x * CELL + CELL / 2;
      const hy = HUD2 + WALL * CELL + s.snake[0].y * CELL + CELL / 2;
      const dx = this.ptr.x - hx;
      const dy = this.ptr.y - hy;
      turn(s, Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up");
    }
    return true;
  }
  draw(ctx, paused) {
    const s = this.s;
    ctx.fillStyle = LCD.lightest;
    ctx.fillRect(0, 0, W4, H3);
    ctx.fillStyle = LCD.darkest;
    ctx.font = "bold 11px 'Courier New', ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(`SCORE ${pad2(s.score)}`, 6, HUD2 / 2);
    ctx.textAlign = "right";
    ctx.fillText(`HI-SCORE ${pad2(Math.max(this.best, s.score))}`, W4 - 6, HUD2 / 2);
    const top = HUD2;
    for (let y = 0; y < ROWS2 + 2 * WALL; y++) {
      for (let x = 0; x < COLS2 + 2 * WALL; x++) {
        if (x >= WALL && x < COLS2 + WALL && y >= WALL && y < ROWS2 + WALL) continue;
        const px = x * CELL;
        const py = top + y * CELL;
        ctx.fillStyle = LCD.dark;
        ctx.fillRect(px, py, CELL, CELL);
        ctx.fillStyle = LCD.darkest;
        ctx.fillRect(px, py + CELL / 2, CELL, 1);
        ctx.fillRect(px + ((x + y) % 2 === 0 ? 3 : CELL - 4), py, 1, CELL / 2);
        ctx.fillRect(px + ((x + y) % 2 === 0 ? CELL - 4 : 3), py + CELL / 2, 1, CELL / 2);
      }
    }
    const fx = WALL * CELL;
    const fy = top + WALL * CELL;
    ctx.fillStyle = LCD.light;
    ctx.fillRect(fx, fy, COLS2 * CELL, ROWS2 * CELL);
    if (s.food) {
      const cx = fx + s.food.x * CELL + CELL / 2;
      const cy = fy + s.food.y * CELL + CELL / 2 + 1;
      ctx.fillStyle = LCD.darkest;
      ctx.beginPath();
      ctx.arc(cx, cy, CELL / 2 - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = LCD.dark;
      ctx.fillRect(cx, cy - CELL / 2 + 0, 2, 3);
    }
    s.snake.forEach((p, i) => {
      ctx.fillStyle = i === 0 ? LCD.darkest : LCD.dark;
      ctx.fillRect(fx + p.x * CELL + 1, fy + p.y * CELL + 1, CELL - 2, CELL - 2);
    });
    const h = s.snake[0];
    ctx.fillStyle = LCD.lightest;
    ctx.fillRect(fx + h.x * CELL + CELL - 5, fy + h.y * CELL + 3, 2, 2);
    const msg = paused ? PAUSED_LINES : s.status === "idle" ? ["PRESS SPACE", "OR AN ARROW"] : s.status === "over" ? ["GAME OVER", "SPACE TO RETRY"] : s.status === "won" ? ["YOU WIN", "SPACE TO PLAY"] : [];
    if (msg.length > 0) {
      const bw = 150;
      const bh = 18 + msg.length * 14;
      const bx = (W4 - bw) / 2;
      const by = fy + (ROWS2 * CELL - bh) / 2;
      ctx.fillStyle = LCD.lightest;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = LCD.darkest;
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
      ctx.fillStyle = LCD.darkest;
      ctx.textAlign = "center";
      ctx.font = "bold 12px 'Courier New', ui-monospace, monospace";
      msg.forEach((line, i) => {
        if (i === 1) ctx.font = "10px 'Courier New', ui-monospace, monospace";
        ctx.fillText(line, W4 / 2, by + 16 + i * 14);
      });
    }
  }
};

// src/games/host.ts
function isControl(el) {
  if (!el) return false;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName);
}
var MAX_DT = 0.05;
var GameHost = class {
  constructor(game, o) {
    this.game = game;
    this.o = o;
    this.ac = new AbortController();
    this.raf = 0;
    this.pauseTimer = 0;
    this.last = 0;
    this.active = false;
    this.frozen = false;
    this.paused = false;
    this.wasRunning = false;
    this.destroyed = false;
    this.best = o.highScore;
    game.setHighScore(o.highScore);
    const { doc, win } = o;
    const canvas = this.canvas = doc.createElement("canvas");
    canvas.className = "vault-lock-game-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    canvas.width = Math.round(game.width * dpr);
    canvas.height = Math.round(game.height * dpr);
    canvas.style.setProperty("--vl-game-w", `${game.width}px`);
    canvas.style.setProperty("--vl-game-r", String(game.width / game.height));
    canvas.style.aspectRatio = `${game.width} / ${game.height}`;
    this.ctx = canvas.getContext("2d");
    this.ctx?.scale(dpr, dpr);
    o.mount.replaceChildren(canvas);
    const sig = { signal: this.ac.signal };
    o.root.addEventListener("keydown", (e) => this.onKey(e, true), sig);
    o.root.addEventListener("keyup", (e) => this.onKey(e, false), sig);
    o.root.addEventListener("focusin", () => this.syncPause(), sig);
    o.root.addEventListener("focusout", () => this.syncPauseSoon(), sig);
    doc.addEventListener("visibilitychange", () => this.syncPause(), sig);
    canvas.addEventListener("pointermove", (e) => this.onPointer(e), sig);
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (!this.active) return;
        o.root.focus({ preventScroll: true });
        this.reportPointer(e);
        if (game.pointerDown?.()) e.preventDefault();
        this.kick();
      },
      sig
    );
    this.reset();
  }
  /** The overlay is showing (locked or previewing) or not. Leaving it resets the game to its start screen. */
  setActive(active) {
    if (this.destroyed) return;
    if (active) {
      if (this.active && !this.frozen) return;
      if (this.frozen) this.reset();
      this.frozen = false;
      this.active = true;
      this.syncPause();
      this.draw();
    } else if (this.active) {
      this.active = false;
      this.finishRound();
      this.stopLoop();
      this.reset();
    }
  }
  /** Stop for good without redrawing (the unlock fade): the last frame stays on screen, nothing runs or listens. */
  freeze() {
    if (this.destroyed || !this.active) return;
    this.active = false;
    this.frozen = true;
    this.finishRound();
    this.stopLoop();
  }
  setHighScore(score) {
    this.best = Math.max(this.best, score);
    this.game.setHighScore(this.best);
    if (this.active) this.draw();
  }
  destroy() {
    if (this.destroyed) return;
    this.finishRound();
    this.destroyed = true;
    this.ac.abort();
    this.stopLoop();
    this.o.win.clearTimeout(this.pauseTimer);
    this.pauseTimer = 0;
    this.canvas.remove();
  }
  // ---- keyboard / focus ------------------------------------------------------------------
  onKey(e, down) {
    if (!this.active || e.isComposing) return;
    const el = this.o.doc.activeElement;
    if (isControl(el)) {
      if (down && e.code === "Escape") {
        el.blur();
        this.o.root.focus({ preventScroll: true });
        e.preventDefault();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (down && e.code === "Tab" && !e.shiftKey) {
      if (this.o.focusField()) e.preventDefault();
      return;
    }
    if (this.paused) return;
    if (down && e.repeat && !this.game.running) {
      if (this.game.key(e.code, false)) e.preventDefault();
      return;
    }
    if (this.game.key(e.code, down)) e.preventDefault();
    this.kick();
  }
  reportPointer(e) {
    if (!this.game.pointer) return;
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.game.pointer((e.clientX - r.left) / r.width * this.game.width, (e.clientY - r.top) / r.height * this.game.height);
  }
  onPointer(e) {
    if (!this.active || this.paused || !this.game.pointer) return;
    this.reportPointer(e);
    this.kick();
  }
  /** Paused while a control has the keyboard or the window is not visible. */
  syncPause() {
    if (this.destroyed) return;
    const paused = isControl(this.o.doc.activeElement) || this.o.doc.hidden;
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.stopLoop();
      this.game.releaseKeys?.();
    }
    if (this.active) this.draw();
    if (!paused) this.kick();
  }
  /** Focus leaves one element a moment before it lands on the next: look after it has settled. */
  syncPauseSoon() {
    this.o.win.clearTimeout(this.pauseTimer);
    this.pauseTimer = this.o.win.setTimeout(() => {
      this.pauseTimer = 0;
      this.syncPause();
    }, 0);
  }
  // ---- loop ------------------------------------------------------------------------------
  /** Redraw, and make sure the loop is running if the game needs time to pass. */
  kick() {
    if (this.destroyed || !this.active) return;
    this.noteRoundEnd();
    this.draw();
    if (this.game.running && !this.paused && this.raf === 0) {
      this.last = 0;
      this.raf = this.o.win.requestAnimationFrame((t) => this.frame(t));
    }
  }
  frame(t) {
    this.raf = 0;
    if (this.destroyed || !this.active || this.paused) return;
    const dt = this.last === 0 ? 0 : Math.min(MAX_DT, (t - this.last) / 1e3);
    this.last = t;
    this.game.update(dt);
    this.noteRoundEnd();
    this.draw();
    if (this.game.running) this.raf = this.o.win.requestAnimationFrame((n) => this.frame(n));
  }
  stopLoop() {
    if (this.raf !== 0) this.o.win.cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }
  draw() {
    if (!this.ctx) return;
    this.ctx.save();
    this.game.draw(this.ctx, this.paused);
    this.ctx.restore();
  }
  reset() {
    this.wasRunning = false;
    this.game.reset();
    this.draw();
  }
  // ---- high score ------------------------------------------------------------------------
  /** A round just ended: report a new best. */
  noteRoundEnd() {
    const running = this.game.running;
    if (this.wasRunning && !running) this.finishRound();
    this.wasRunning = running;
  }
  finishRound() {
    if (this.game.score > this.best) {
      this.best = this.game.score;
      this.game.setHighScore(this.best);
      this.o.onHighScore(this.best);
    }
  }
};

// src/games/index.ts
function createGame(id) {
  switch (id) {
    case "snake":
      return new SnakeGame();
    case "breakout":
      return new BreakoutGame();
    case "runner":
      return new RunnerGame();
  }
}

// src/lockscreen.ts
var MAX_TODOS = 10;
var MAX_TODO_LENGTH = 80;
var FONT_STACKS = {
  sans: "var(--font-interface, system-ui, sans-serif)",
  serif: '"New York", "Iowan Old Style", Georgia, "Noto Serif KR", "Noto Serif CJK KR", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "D2Coding", monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", Nunito, Quicksand, system-ui, sans-serif'
};
var UNLOCK_MS = 520;
var POINTER_KINDS = ["glow", "trail", "orbs"];
function isFormControl(el) {
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes(el.type);
}
var PIXEL_LOCKS = {
  win95: { o: "#000000", s: "#808080", f: "#c0c0c0", k: "#000000" },
  "obsidian-runner": { o: "#d1d5db", s: "#6b7280", f: "#f3f4f6", k: "#374151" },
  "gameboy-snake": { o: "#9bbc0f", s: "#5f7f1a", f: "#8bac0f", k: "#1b3220" }
};
var clamp2 = (n, min, max) => Math.min(max, Math.max(min, n));
var rnd2 = (min, max) => min + Math.random() * (max - min);
function loginStamp(d) {
  const wd = d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  const mon = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${wd} ${mon} ${d.getDate()} ${hm}`;
}
function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
var OverlayView = class {
  constructor(doc, t, handlers, keymap) {
    this.doc = doc;
    this.t = t;
    this.handlers = handlers;
    this.keymap = keymap;
    this.inerted = /* @__PURE__ */ new Set();
    this.scopePushed = false;
    this.deniedTimer = 0;
    this.fx = null;
    this.theme = "default";
    this.unlockLabel = "";
    this.recoveryOn = false;
    this.baseTitle = "";
    this.unlockedTitle = "";
    this.host = null;
    // the running offline game of a game theme, if any
    this.gameId = null;
    this.imageUrl = null;
    this.imageLoaded = false;
    this.imageAutoDim = 0;
    // legibility floor derived from the photo's brightness
    this.video = null;
    this.videoUrl = null;
    this.videoLoaded = false;
    this.videoAutoDim = 0;
    this.userDim = 0.35;
    this.timeFmt = null;
    this.dateFmt = null;
    this.lastTime = "";
    this.lastDate = "";
    this.win = doc.defaultView ?? window;
    const el = (tag, cls) => {
      const e = doc.createElement(tag);
      e.className = cls;
      return e;
    };
    const root = this.root = el("div", "vault-lock-overlay");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", t.lockedTitle);
    root.tabIndex = -1;
    this.bg = el("div", "vault-lock-bg");
    this.anim = el("div", "vault-lock-anim");
    this.anim.setAttribute("aria-hidden", "true");
    this.bg.setAttribute("aria-hidden", "true");
    const stage = this.stage = el("div", "vault-lock-stage");
    this.clockEl = el("div", "vault-lock-clock");
    this.timeEl = el("div", "vault-lock-time");
    this.dateEl = el("div", "vault-lock-date");
    this.clockEl.append(this.timeEl, this.dateEl);
    const card = el("div", "vault-lock-card");
    const icon = this.iconEl = el("div", "vault-lock-icon");
    (0, import_obsidian2.setIcon)(icon, "lock");
    const title = this.titleEl = el("div", "vault-lock-title");
    title.textContent = t.lockedTitle;
    const form = el("form", "vault-lock-form");
    form.noValidate = true;
    const input = this.input = el("input", "vault-lock-input");
    input.type = "password";
    input.placeholder = t.placeholder;
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", t.placeholder);
    const button = this.button = el("button", "vault-lock-button mod-cta");
    button.type = "submit";
    button.textContent = t.unlock;
    this.unlockLabel = t.unlock;
    this.baseTitle = t.lockedTitle;
    this.unlockedTitle = t.unlocked;
    const prompt = el("span", "vault-lock-prompt");
    prompt.setAttribute("aria-hidden", "true");
    prompt.textContent = "$ password:";
    form.append(prompt, input, button);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handlers.submit(input.value, this.recoveryOn ? "recovery" : "password");
    });
    const message = this.message = el("div", "vault-lock-message");
    message.setAttribute("aria-live", "polite");
    this.hint = el("div", "vault-lock-hint");
    this.hint.textContent = t.previewClose;
    const forgot = this.forgotBtn = el("button", "vault-lock-forgot");
    forgot.type = "button";
    forgot.textContent = t.forgot;
    forgot.addEventListener("click", () => {
      this.setRecovery(!this.recoveryOn);
      input.value = "";
      input.focus({ preventScroll: true });
    });
    card.append(icon, title, form, forgot, message, this.hint);
    this.todosEl = el("div", "vault-lock-todos");
    this.todoList = el("div", "vault-lock-todo-list");
    const addForm = el("form", "vault-lock-todo-add");
    addForm.noValidate = true;
    const addInput = el("input", "vault-lock-todo-input");
    addInput.type = "text";
    addInput.maxLength = MAX_TODO_LENGTH;
    addInput.placeholder = t.todoPlaceholder;
    addInput.autocomplete = "off";
    addInput.setAttribute("aria-label", t.todoPlaceholder);
    const addBtn = el("button", "vault-lock-todo-btn");
    addBtn.type = "submit";
    addBtn.setAttribute("aria-label", t.todoAdd);
    (0, import_obsidian2.setIcon)(addBtn, "plus");
    addForm.append(addInput, addBtn);
    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = addInput.value.trim();
      if (!text) return;
      addInput.value = "";
      handlers.addTodo(text);
    });
    this.todosEl.append(this.todoList, addForm);
    const chrome = el("div", "vault-lock-chrome");
    chrome.setAttribute("aria-hidden", "true");
    const dots = el("span", "vl-dots");
    for (let n = 0; n < 3; n++) dots.append(el("i", "vl-dot"));
    const chromeTitle = this.chromeTitleEl = el("span", "vl-chrome-title");
    const winBtns = el("span", "vl-winbtns");
    for (const k of ["min", "max", "close"]) winBtns.append(el("i", `vl-winbtn vl-wb-${k}`));
    chrome.append(dots, chromeTitle, winBtns);
    const log = el("div", "vault-lock-log");
    log.setAttribute("aria-hidden", "true");
    this.loginEl = el("div", "vl-log-line");
    const l2 = el("div", "vl-log-line");
    l2.textContent = "[vault] status: locked";
    const l3 = el("div", "vl-log-line");
    l3.textContent = "[system] lockscape ready";
    log.append(this.loginEl, l2, l3);
    this.gameEl = el("div", "vault-lock-game");
    const hint = el("div", "vault-lock-cover-hint");
    hint.textContent = t.hideHint;
    stage.append(chrome, this.clockEl, log, this.gameEl, card, hint, this.todosEl);
    const drag = el("div", "vault-lock-drag");
    drag.setAttribute("aria-hidden", "true");
    this.desktopEl = el("div", "vault-lock-desktop");
    this.desktopEl.setAttribute("aria-hidden", "true");
    root.append(this.bg, this.anim, this.desktopEl, stage, drag);
    root.addEventListener("keydown", (e) => {
      if (root.classList.contains("is-manual") ? ["Escape", "Enter", " "].includes(e.key) : e.key === "Escape" && root.classList.contains("is-preview")) handlers.closePreview();
      e.stopPropagation();
      if (root.classList.contains("hover-reveal") && !root.classList.contains("is-preview") && !root.classList.contains("is-cover") && doc.activeElement !== input && !isFormControl(doc.activeElement) && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        input.focus({ preventScroll: true });
      }
    });
    this.keyScope = new import_obsidian2.Scope();
    this.keyScope.register(null, null, (e) => {
      if (this.root.contains(e.target)) return void 0;
      this.root.focus({ preventScroll: true });
      return false;
    });
    root.addEventListener("focusout", (e) => {
      const to = e.relatedTarget;
      if (to && root.contains(to)) return;
      this.win.setTimeout(() => {
        if (root.isConnected && doc.hasFocus() && !root.contains(doc.activeElement)) root.focus({ preventScroll: true });
      }, 0);
    });
    this.onWinFocus = () => {
      this.pushKeyScope();
      this.win.setTimeout(() => this.pushKeyScope(), 0);
    };
    this.win.addEventListener("focus", this.onWinFocus);
    card.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || !root.classList.contains("hover-reveal")) return;
      if (!e.target.closest(".vault-lock-form")) input.focus({ preventScroll: true });
    });
    root.addEventListener("click", (e) => {
      if (!root.classList.contains("is-preview") && !root.classList.contains("is-manual")) return;
      const path = e.composedPath();
      if (path.includes(this.todosEl) || path.includes(this.gameEl)) return;
      handlers.closePreview();
    });
    const vv = this.win.visualViewport;
    if (vv) {
      this.onViewport = () => {
        root.style.top = `${vv.offsetTop}px`;
        root.style.height = `${vv.height}px`;
      };
      vv.addEventListener("resize", this.onViewport);
      vv.addEventListener("scroll", this.onViewport);
    } else {
      this.onViewport = null;
    }
    const RO = this.win.ResizeObserver;
    this.slotObserver = RO ? new RO(() => root.style.setProperty("--vl-slot-h", `${form.offsetHeight}px`)) : null;
    this.slotObserver?.observe(form);
    this.onVis = () => {
      const v = this.video;
      if (!v) return;
      if (doc.hidden) v.pause();
      else if (!this.reducedMotion()) void v.play().catch(() => void 0);
    };
    doc.addEventListener("visibilitychange", this.onVis);
    this.observer = new MutationObserver(() => this.enforce());
  }
  attach() {
    const body2 = this.doc.body;
    if (!this.root.isConnected) body2.append(this.root);
    this.enforce();
    this.pushKeyScope();
    this.observer.observe(body2, { childList: true });
    this.onViewport?.();
  }
  enforce() {
    const body2 = this.doc.body;
    if (!this.root.isConnected) body2.append(this.root);
    let added = false;
    for (const child of Array.from(body2.children)) {
      if (child === this.root || this.inerted.has(child)) continue;
      added = true;
      if (child.inert) continue;
      child.inert = true;
      this.inerted.add(child);
    }
    if (added) this.pushKeyScope();
  }
  /** Make our scope the top of this window's scope stack. Does nothing for a window Obsidian does not consider active. */
  pushKeyScope() {
    if (!this.root.isConnected || this.win !== activeWindow) return;
    if (this.scopePushed) this.keymap.popScope(this.keyScope);
    this.keymap.pushScope(this.keyScope);
    this.scopePushed = true;
  }
  popKeyScope() {
    if (!this.scopePushed) return;
    this.scopePushed = false;
    this.keymap.popScope(this.keyScope);
  }
  /** The padlock: pixel art for the themes that have it, the icon set's line icon otherwise. */
  drawIcon(open) {
    const pixel = PIXEL_LOCKS[this.theme];
    if (pixel) {
      this.iconEl.replaceChildren(pixelLock(this.doc, open, pixel));
      return;
    }
    (0, import_obsidian2.setIcon)(this.iconEl, open ? "lock-open" : "lock");
    if (open && !this.iconEl.querySelector("svg")) (0, import_obsidian2.setIcon)(this.iconEl, "unlock");
  }
  /** Undo setUnlocking() when the screen is locked again before it went away. */
  cancelUnlocking() {
    this.root.classList.remove("is-unlocking");
    this.titleEl.textContent = this.baseTitle;
    this.drawIcon(false);
    this.setBusy(false);
  }
  /** Success feedback: the padlock opens and the text says so; the caller removes the overlay shortly after. */
  setUnlocking() {
    this.root.classList.add("is-unlocking");
    this.host?.freeze();
    this.input.disabled = true;
    this.button.disabled = true;
    this.drawIcon(true);
    this.titleEl.textContent = this.unlockedTitle;
    this.button.textContent = "\u2713";
  }
  /** Wrong password: the card shakes once. */
  setDenied() {
    const r = this.root;
    r.classList.remove("is-denied", "is-error");
    void r.offsetWidth;
    r.classList.add("is-denied", "is-error");
    this.win.clearTimeout(this.deniedTimer);
    this.deniedTimer = this.win.setTimeout(() => r.classList.remove("is-denied", "is-error"), 350);
  }
  reducedMotion() {
    try {
      return this.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }
  detach() {
    this.win.clearTimeout(this.deniedTimer);
    this.root.classList.remove("is-denied", "is-error", "is-unlocking");
    if (this.iconEl.querySelector("svg") && this.root.isConnected) this.drawIcon(false);
    this.fx?.destroy();
    this.fx = null;
    this.disposeGame();
    this.clearVideo();
    this.observer.disconnect();
    this.popKeyScope();
    for (const el of this.inerted) el.inert = false;
    this.inerted.clear();
    this.root.remove();
    this.root.style.removeProperty("top");
    this.root.style.removeProperty("height");
    this.input.value = "";
    this.setBusy(false);
    this.setMessage("");
  }
  destroy() {
    this.detach();
    this.slotObserver?.disconnect();
    this.win.removeEventListener("focus", this.onWinFocus);
    this.doc.removeEventListener("visibilitychange", this.onVis);
    const vv = this.win.visualViewport;
    if (vv && this.onViewport) {
      vv.removeEventListener("resize", this.onViewport);
      vv.removeEventListener("scroll", this.onViewport);
    }
  }
  /** Switch the field between password entry and recovery-key entry ("Forgot your password?"). */
  setRecovery(on) {
    this.recoveryOn = on;
    this.root.classList.toggle("is-recovery", on);
    this.refreshLabels();
  }
  /** Placeholder, accessible name, button text and link text for the current entry kind. Themes may reword the password ones. */
  refreshLabels() {
    const busy = this.root.classList.contains("is-busy") || this.root.classList.contains("is-unlocking");
    if (this.recoveryOn) {
      this.input.placeholder = this.t.recoverPlaceholder;
      this.input.setAttribute("aria-label", this.t.recoverPlaceholder);
      this.input.autocapitalize = "characters";
      if (!busy) this.button.textContent = this.t.recoverUnlock;
      this.forgotBtn.textContent = this.t.backToPassword;
    } else {
      this.input.setAttribute("aria-label", this.t.placeholder);
      this.input.autocapitalize = "off";
      if (!busy) this.button.textContent = this.unlockLabel;
      this.forgotBtn.textContent = this.t.forgot;
      const text = THEME_TEXT[this.theme];
      this.input.placeholder = text.placeholder === "none" ? " " : text.placeholder === "english" ? "password" : this.t.placeholder;
    }
  }
  setMode(mode, manual = false) {
    const cover = mode === "cover";
    const preview = mode === "preview";
    this.root.classList.toggle("is-manual", cover && manual);
    this.root.classList.toggle("is-cover", cover);
    this.root.classList.toggle("is-preview", preview);
    this.input.disabled = cover || preview;
    this.button.disabled = cover || preview;
    this.host?.setActive(mode === "locked" || preview);
  }
  /** Another window's game set a new best: this window's game shows it too. */
  setHighScore(game, score) {
    if (this.gameId === game) this.host?.setHighScore(score);
  }
  /** Start the game of a game theme, stop and remove the previous one when the theme changed. */
  syncGame(a) {
    const id = gameOf(a.theme);
    if (id === this.gameId) {
      if (id) this.host?.setHighScore(a.highScores[id]);
      return;
    }
    this.disposeGame();
    if (!id) return;
    this.gameId = id;
    this.host = new GameHost(createGame(id), {
      doc: this.doc,
      win: this.win,
      mount: this.gameEl,
      root: this.root,
      highScore: a.highScores[id],
      onHighScore: (score) => this.handlers.highScore(id, score),
      focusField: () => {
        if (this.input.disabled) return false;
        this.input.focus({ preventScroll: true });
        return this.doc.activeElement === this.input;
      }
    });
  }
  disposeGame() {
    this.host?.destroy();
    this.host = null;
    this.gameId = null;
    this.gameEl.replaceChildren();
  }
  /** Apply the cosmetic settings: background, animation, text, clock, layout and widgets. */
  applyAppearance(a, todos) {
    this.setImage(a.imageUrl);
    this.setVideo(a.videoUrl);
    const r = this.root;
    this.theme = a.theme;
    const game = gameOf(a.theme);
    const text = THEME_TEXT[a.theme];
    r.dataset.theme = a.theme;
    r.classList.toggle("is-game", game !== null);
    this.syncGame(a);
    if (a.theme === "win95") {
      if (this.desktopEl.childElementCount === 0) buildDesktop(this.doc, this.desktopEl);
    } else if (this.desktopEl.childElementCount > 0) this.desktopEl.replaceChildren();
    r.classList.toggle("hover-reveal", a.hoverReveal && game === null);
    this.unlockLabel = text.unlock ?? this.t.unlock;
    this.unlockedTitle = text.unlocked ?? this.t.unlocked;
    this.baseTitle = text.title ?? this.t.lockedTitle;
    if (!this.root.classList.contains("is-unlocking")) this.drawIcon(false);
    this.input.placeholder = text.placeholder === "none" ? " " : text.placeholder === "english" ? "password" : this.t.placeholder;
    this.chromeTitleEl.textContent = a.theme === "win95" ? "Obsidian" : a.theme === "terminal" ? "obsidian \u2014 zsh" : "";
    r.classList.toggle("has-recovery", a.hasRecovery);
    if (!a.hasRecovery && this.recoveryOn) this.setRecovery(false);
    this.refreshLabels();
    r.classList.toggle("title-auto", a.titleMode === "auto");
    r.classList.toggle("title-hide", a.titleMode === "hide");
    r.classList.toggle("custom-title", a.customTitle !== "");
    r.classList.toggle("no-icon", !a.showIcon);
    r.classList.toggle("pos-top", a.position === "top");
    r.classList.toggle("pos-bottom", a.position === "bottom");
    r.classList.toggle("shape-round", a.fieldShape === "rounded");
    r.classList.toggle("shape-pill", a.fieldShape === "pill");
    r.classList.toggle("shape-square", a.fieldShape === "square");
    this.titleEl.textContent = a.customTitle || this.baseTitle;
    const setVar = (name, value) => value ? r.style.setProperty(name, value) : r.style.removeProperty(name);
    setVar("--vl-text", a.textColor);
    setVar("--vl-accent", a.accentColor);
    const accentRgb = a.accentColor ? resolveColor(this.doc, a.accentColor) : null;
    setVar("--vl-on-accent", accentRgb ? inkFor(accentRgb) : "");
    r.style.setProperty("--vl-clock-scale", String(clamp2(a.clockScale, 60, 160) / 100));
    if (a.clockFont === "auto") {
      r.style.removeProperty("--vl-clock-weight");
      r.style.removeProperty("--vl-clock-font");
    } else {
      r.style.setProperty("--vl-clock-weight", String(clamp2(a.clockWeight, 100, 700)));
      r.style.setProperty("--vl-clock-font", FONT_STACKS[a.clockFont]);
    }
    r.style.setProperty("--vl-blur", `${clamp2(a.blur, 0, 20)}px`);
    this.userDim = clamp2(a.dim, 0, 80) / 100;
    this.updateMedia();
    this.buildAnimation(a);
    this.clockEl.classList.toggle("is-off", !a.showClock);
    this.dateEl.classList.toggle("is-off", !a.showDate);
    const hourCycle = a.clockFormat === "24" ? "h23" : a.clockFormat === "12" ? "h12" : void 0;
    const timeOpts = {
      hour: a.clockFormat === "24" ? "2-digit" : "numeric",
      minute: "2-digit",
      second: a.showSeconds ? "2-digit" : void 0,
      hourCycle
    };
    const dateOpts = { weekday: "long", month: "long", day: "numeric" };
    try {
      this.timeFmt = new Intl.DateTimeFormat(a.locale || void 0, timeOpts);
      this.dateFmt = new Intl.DateTimeFormat(a.locale || void 0, dateOpts);
    } catch {
      this.timeFmt = new Intl.DateTimeFormat(void 0, timeOpts);
      this.dateFmt = new Intl.DateTimeFormat(void 0, dateOpts);
    }
    this.lastTime = this.lastDate = "";
    this.updateClock(/* @__PURE__ */ new Date());
    this.todosEl.classList.toggle("is-off", !a.showTodos);
    this.stage.classList.toggle("has-todos", a.showTodos);
    this.renderTodos(todos);
  }
  setImage(url) {
    if (url === this.imageUrl) return;
    this.imageUrl = url;
    this.imageLoaded = false;
    this.imageAutoDim = 0;
    this.bg.style.removeProperty("background-image");
    this.updateMedia();
    if (!url) return;
    const probe = this.doc.createElement("img");
    probe.onload = () => {
      if (this.imageUrl !== url) return;
      this.imageAutoDim = this.legibilityDim(probe);
      this.bg.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
      this.imageLoaded = true;
      this.updateMedia();
    };
    probe.src = url;
  }
  setVideo(url) {
    const reduced = this.reducedMotion();
    if (url === this.videoUrl && this.video) {
      if (!reduced && !this.doc.hidden) void this.video.play().catch(() => void 0);
      return;
    }
    this.clearVideo();
    this.videoUrl = url;
    if (!url) {
      this.updateMedia();
      return;
    }
    const v = this.doc.createElement("video");
    v.className = "vault-lock-video";
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = !reduced && !this.doc.hidden;
    v.preload = "auto";
    v.controls = false;
    v.disablePictureInPicture = true;
    v.setAttribute("aria-hidden", "true");
    v.addEventListener("loadeddata", () => {
      if (this.videoUrl !== url) return;
      this.videoAutoDim = this.legibilityDim(v);
      this.videoLoaded = true;
      this.updateMedia();
      if (!reduced && !this.doc.hidden) void v.play().catch(() => void 0);
    });
    v.src = url;
    this.bg.prepend(v);
    this.video = v;
  }
  clearVideo() {
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      this.video.remove();
      this.video = null;
    }
    this.videoUrl = null;
    this.videoLoaded = false;
    this.videoAutoDim = 0;
    this.updateMedia();
  }
  updateMedia() {
    this.root.classList.toggle("has-image", this.imageLoaded || this.videoLoaded);
    this.root.classList.toggle("has-video", this.videoLoaded);
    const floor = Math.max(this.imageLoaded ? this.imageAutoDim : 0, this.videoLoaded ? this.videoAutoDim : 0);
    this.root.style.setProperty("--vl-dim", String(Math.max(this.userDim, floor)));
  }
  /** White text needs the dimmed picture to stay below ~45% brightness; bump dim up for bright media. */
  legibilityDim(src) {
    try {
      const size = 24;
      const canvas = this.doc.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return 0;
      ctx.drawImage(src, 0, 0, size, size);
      const px = ctx.getImageData(0, 0, size, size).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      const luma = sum / (size * size * 255);
      return luma > 0.45 ? Math.min(0.8, 1 - 0.45 / luma) : 0;
    } catch {
      return 0;
    }
  }
  /** Build the decorative animation. Transform/opacity only; counts scale with the screen area. */
  buildAnimation(a) {
    this.fx?.destroy();
    this.fx = null;
    this.anim.className = `vault-lock-anim is-${a.animation}`;
    this.anim.replaceChildren();
    if (a.animation === "none") return;
    const base = a.accentColor && resolveColor(this.doc, a.accentColor) || themeAccent(this.doc);
    const colors = palette(base);
    if (POINTER_KINDS.includes(a.animation)) {
      if (!this.reducedMotion()) {
        const palette4 = [...colors, colors[0]];
        this.fx = new PointerFx(this.doc, this.win, this.anim, a.animation, palette4);
      }
      return;
    }
    colors.forEach((c, i) => this.anim.style.setProperty(`--vl-c${i + 1}`, c));
    const area = this.win.innerWidth * this.win.innerHeight;
    const add = (tag, vars) => {
      const e = this.doc.createElement(tag);
      for (const [k, v] of Object.entries(vars)) e.style.setProperty(k, v);
      this.anim.append(e);
    };
    const f2 = (n) => n.toFixed(1);
    if (a.animation === "aurora") {
      for (let i = 0; i < 4; i++) {
        add("b", {
          "--c": colors[i % 3],
          "--x": `${f2(rnd2(5, 95))}%`,
          "--y": `${f2(rnd2(5, 95))}%`,
          "--s": `${f2(rnd2(60, 90))}vmax`,
          "--dx": `${f2(rnd2(-24, 24))}vmax`,
          "--dy": `${f2(rnd2(-18, 18))}vmax`,
          "--d": `${f2(rnd2(22, 38))}s`,
          "--delay": `-${f2(rnd2(0, 30))}s`
        });
      }
    } else if (a.animation === "fireflies") {
      const n = clamp2(Math.round(area / 52e3), 10, 30);
      for (let i = 0; i < n; i++) {
        const s = rnd2(3, 7);
        add("i", {
          "--c": colors[i % 3],
          "--x": `${f2(rnd2(2, 98))}%`,
          "--y": `${f2(rnd2(4, 96))}%`,
          "--s": `${f2(s)}px`,
          "--x1": `${f2(rnd2(-16, 16))}vmin`,
          "--y1": `${f2(rnd2(-16, 16))}vmin`,
          "--x2": `${f2(rnd2(-20, 20))}vmin`,
          "--y2": `${f2(rnd2(-20, 20))}vmin`,
          "--x3": `${f2(rnd2(-16, 16))}vmin`,
          "--y3": `${f2(rnd2(-16, 16))}vmin`,
          "--d": `${f2(rnd2(18, 34))}s`,
          "--p": `${f2(rnd2(2.8, 6))}s`,
          "--delay": `-${f2(rnd2(0, 30))}s`
        });
      }
    } else if (a.animation === "snow") {
      const n = clamp2(Math.round(area / 36e3), 14, 48);
      for (let i = 0; i < n; i++) {
        add("i", {
          "--x": `${f2(rnd2(0, 100))}%`,
          "--s": `${f2(rnd2(2, 6))}px`,
          "--o": f2(rnd2(0.35, 0.9)),
          "--sway": `${f2(rnd2(-40, 40))}px`,
          "--d": `${f2(rnd2(9, 20))}s`,
          "--delay": `-${f2(rnd2(0, 20))}s`
        });
      }
    }
  }
  /** The time as text, or (Windows 95) digits and colons as pixel art with the rest, such as "오후", left as text. */
  drawTime(time) {
    if (this.theme !== "win95") {
      this.timeEl.textContent = time;
      this.timeEl.removeAttribute("role");
      this.timeEl.removeAttribute("aria-label");
      return;
    }
    const parts = runsOf(time).map((run) => {
      if (run.pixel) return pixelSvg(this.doc, run.text);
      const span = this.doc.createElement("span");
      span.className = "vl-px-text";
      span.textContent = run.text;
      return span;
    });
    this.timeEl.replaceChildren(...parts);
    this.timeEl.setAttribute("role", "img");
    this.timeEl.setAttribute("aria-label", time);
  }
  updateClock(now) {
    if (!this.timeFmt || !this.dateFmt) return;
    const time = this.timeFmt.format(now);
    if (time !== this.lastTime) {
      this.lastTime = time;
      this.drawTime(time);
      if (this.theme === "terminal") this.loginEl.textContent = `last login: ${loginStamp(now)}`;
    }
    const date = this.dateFmt.format(now);
    if (date !== this.lastDate) {
      this.lastDate = date;
      this.dateEl.textContent = date;
    }
  }
  renderTodos(todos) {
    const doc = this.doc;
    const rows = todos.map((todo) => {
      const row = doc.createElement("div");
      row.className = "vault-lock-todo" + (todo.done ? " is-done" : "");
      const label = doc.createElement("label");
      label.className = "vault-lock-todo-label";
      const box = doc.createElement("input");
      box.type = "checkbox";
      box.checked = todo.done;
      box.addEventListener("change", () => this.handlers.toggleTodo(todo.id));
      const text = doc.createElement("span");
      text.textContent = todo.text;
      label.append(box, text);
      const del = doc.createElement("button");
      del.type = "button";
      del.className = "vault-lock-todo-btn";
      del.setAttribute("aria-label", this.t.todoDelete);
      (0, import_obsidian2.setIcon)(del, "x");
      del.addEventListener("click", () => this.handlers.deleteTodo(todo.id));
      row.append(label, del);
      return row;
    });
    this.todoList.replaceChildren(...rows);
    const addForm = this.todosEl.querySelector(".vault-lock-todo-add");
    addForm?.classList.toggle("is-off", todos.length >= MAX_TODOS);
  }
  setMessage(text) {
    this.message.textContent = text;
    this.root.classList.toggle("has-message", text !== "");
  }
  setBusy(busy) {
    this.root.classList.toggle("is-busy", busy);
    this.input.disabled = busy;
    this.button.disabled = busy;
    this.button.textContent = busy ? this.t.checking : this.recoveryOn ? this.t.recoverUnlock : this.unlockLabel;
  }
  focus() {
    this.input.focus({ preventScroll: true });
  }
  focusRoot() {
    this.root.focus({ preventScroll: true });
  }
};
var LockScreen = class {
  constructor(t, hooks) {
    this.t = t;
    this.hooks = hooks;
    this.mode = "off";
    /** The cover was asked for ("hide screen" command), not caused by leaving the app: a click or Esc takes it away, no password. */
    this.manual = false;
    this.views = /* @__PURE__ */ new Map();
    this.countdown = null;
    this.clockTimer = null;
    this.busy = false;
    this.unlockTimer = 0;
    this.unlocking = false;
    /** Where the keyboard focus was in each window before the overlay took over; given back when it goes away. */
    this.savedFocus = /* @__PURE__ */ new Map();
  }
  get isLocked() {
    return this.mode === "locked";
  }
  get isCovering() {
    return this.mode === "cover";
  }
  get isManualCover() {
    return this.mode === "cover" && this.manual;
  }
  get isPreviewing() {
    return this.mode === "preview";
  }
  /** Hide content immediately without asking for a password (grace period running). */
  cover() {
    if (this.mode === "locked") return;
    this.rememberFocus();
    this.mode = "cover";
    this.render();
  }
  /** Hide the screen at once (before sharing it, say). No password: a click or Esc shows it again. */
  hideScreen() {
    if (this.mode === "locked" || this.mode === "preview") return;
    this.rememberFocus();
    this.manual = true;
    this.mode = "cover";
    this.render();
    window.setTimeout(() => {
      if (!this.isManualCover) return;
      for (const v of this.views.values()) if (v.doc.hasFocus()) v.focusRoot();
    }, 50);
  }
  lock() {
    this.manual = false;
    if (this.unlocking) {
      window.clearTimeout(this.unlockTimer);
      this.unlocking = false;
      this.busy = false;
      this.eachView((v) => v.cancelUnlocking());
    }
    this.rememberFocus();
    this.mode = "locked";
    this.notifyLock();
    this.notifyWindow(true);
    this.render();
    this.eachView((v) => v.setRecovery(false));
    this.startCountdown();
    const ap = this.hooks.getAppearance();
    const preferInput = !ap.hoverReveal && gameOf(ap.theme) === null;
    window.setTimeout(() => this.focusActive(preferInput), 50);
  }
  /** Show the lock screen without locking, so appearance settings can be judged. Click/Esc closes it. */
  preview() {
    if (this.mode === "locked") return;
    this.rememberFocus();
    this.mode = "preview";
    this.notifyWindow(true);
    this.render();
    window.setTimeout(() => {
      if (this.mode !== "preview") return;
      for (const v of this.views.values()) if (v.doc.hasFocus()) v.focusRoot();
    }, 50);
  }
  release() {
    this.manual = false;
    window.clearTimeout(this.unlockTimer);
    this.unlocking = false;
    this.mode = "off";
    this.stopCountdown();
    this.stopClock();
    for (const view of this.views.values()) view.detach();
    this.notifyWindow(false);
    this.restoreFocus();
  }
  /** Remember the focused element of every window, but only when the overlay is not already up (cover -> locked keeps the first). */
  rememberFocus() {
    if (this.mode !== "off") return;
    this.savedFocus.clear();
    for (const doc of this.hooks.getDocuments()) {
      const el = doc.activeElement;
      if (el && el !== doc.body && el !== doc.documentElement) this.savedFocus.set(doc, el);
    }
  }
  restoreFocus() {
    for (const [doc, el] of this.savedFocus) {
      if (el.isConnected && typeof el.focus === "function" && doc.hasFocus()) el.focus({ preventScroll: true });
    }
    this.savedFocus.clear();
  }
  destroy() {
    window.clearTimeout(this.unlockTimer);
    const wasShowing = this.mode !== "off";
    this.savedFocus.clear();
    this.mode = "off";
    if (wasShowing) this.notifyWindow(false);
    this.stopCountdown();
    this.stopClock();
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
  }
  /** Closing the owner's open dialogs is best effort; the lock screen must come up even if it throws. */
  notifyLock() {
    try {
      this.hooks.onLock();
    } catch {
    }
  }
  /**
   * Window shrinking is cosmetic. If it throws, the lock screen must still appear (fail closed),
   * so errors from this hook are swallowed.
   */
  notifyWindow(active) {
    try {
      this.hooks.onWindow(active);
    } catch {
    }
  }
  /** Call when a popout window opens/closes while locked. */
  refresh() {
    if (this.mode !== "off") this.render();
  }
  render() {
    const docs = new Set(this.hooks.getDocuments());
    for (const [doc, view] of this.views) {
      if (!docs.has(doc)) {
        view.destroy();
        this.views.delete(doc);
      }
    }
    const appearance = this.hooks.getAppearance();
    const todos = this.hooks.getTodos();
    for (const doc of docs) {
      let view = this.views.get(doc);
      if (!view) {
        view = new OverlayView(doc, this.t, {
          submit: (pw, kind) => void this.handleSubmit(pw, kind),
          closePreview: () => {
            if (this.mode === "preview" || this.manual) this.release();
          },
          highScore: (game, score) => {
            this.hooks.onHighScore(game, score);
            this.eachView((v) => v.setHighScore(game, score));
          },
          addTodo: (text) => this.editTodos((list) => {
            if (list.length < MAX_TODOS) list.push({ id: newId(), text: clipChars(text, MAX_TODO_LENGTH), done: false });
          }),
          toggleTodo: (id) => this.editTodos((list) => {
            const item = list.find((x) => x.id === id);
            if (item) item.done = !item.done;
          }),
          deleteTodo: (id) => this.editTodos((list) => {
            const i = list.findIndex((x) => x.id === id);
            if (i >= 0) list.splice(i, 1);
          })
        }, this.hooks.keymap);
        this.views.set(doc, view);
      }
      view.applyAppearance(appearance, todos);
      view.attach();
      view.setMode(this.mode, this.manual);
    }
    this.startClock();
  }
  editTodos(change) {
    const list = this.hooks.getTodos().map((x) => ({ ...x }));
    change(list);
    this.hooks.setTodos(list);
    this.eachView((v) => v.renderTodos(list));
  }
  startClock() {
    if (this.clockTimer !== null) return;
    this.clockTimer = window.setInterval(() => {
      const now = /* @__PURE__ */ new Date();
      this.eachView((v) => v.updateClock(now));
    }, 1e3);
  }
  stopClock() {
    if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
    this.clockTimer = null;
  }
  focusActive(preferInput = true) {
    if (this.mode !== "locked") return;
    let target;
    for (const view2 of this.views.values()) {
      if (view2.doc.hasFocus()) target = view2;
    }
    const view = target ?? this.views.values().next().value;
    if (preferInput) view?.focus();
    else view?.focusRoot();
  }
  async handleSubmit(password, kind) {
    if (this.busy || this.mode !== "locked") return;
    if (password === "") return;
    this.busy = true;
    this.eachView((v) => v.setBusy(true));
    let result;
    try {
      result = await this.hooks.submit(password, kind);
    } catch {
      result = { ok: false, message: this.t.cryptoError };
    }
    if (result.ok) {
      this.stopCountdown();
      this.unlocking = true;
      this.eachView((v) => v.setUnlocking());
      const wait = this.prefersReducedMotion() ? 0 : UNLOCK_MS;
      this.unlockTimer = window.setTimeout(() => {
        this.unlocking = false;
        this.busy = false;
        this.release();
        this.hooks.onUnlocked(kind);
      }, wait);
      return;
    }
    this.busy = false;
    this.eachView((v) => {
      v.setBusy(false);
      v.input.value = "";
      v.setMessage(result.message);
      v.setDenied();
    });
    this.startCountdown();
    this.focusActive();
  }
  /** While the caller refuses attempts, show a live "try again in Ns" and disable input. */
  startCountdown() {
    this.stopCountdown();
    const tick4 = () => {
      const left = Math.ceil((this.hooks.getRetryAt() - Date.now()) / 1e3);
      if (left > 0) {
        this.eachView((v) => {
          v.setMessage(fmt(this.t.wait, left));
          v.input.disabled = true;
        });
        return;
      }
      this.stopCountdown();
      this.eachView((v) => {
        v.input.disabled = false;
        v.setMessage("");
      });
      this.focusActive();
    };
    if (this.hooks.getRetryAt() > Date.now()) {
      tick4();
      this.countdown = window.setInterval(tick4, 1e3);
    }
  }
  stopCountdown() {
    if (this.countdown !== null) window.clearInterval(this.countdown);
    this.countdown = null;
  }
  prefersReducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }
  eachView(fn) {
    for (const v of this.views.values()) fn(v);
  }
};

// src/main.ts
var MIN_PASSWORD_LENGTH = 8;
var FREE_ATTEMPTS = 5;
var BACKOFF_BASE_MS = 3e4;
var BACKOFF_MAX_MS = 15 * 6e4;
var DEFAULTS = {
  settingsVersion: 2,
  credential: null,
  recovery: null,
  lockOnStartup: true,
  idleMinutes: 10,
  lockOnHide: true,
  coverOnBlur: false,
  lockOnSystemLock: true,
  graceSeconds: 30,
  failCount: 0,
  retryAt: 0,
  theme: "default",
  highScores: emptyHighScores(),
  backgroundKind: "none",
  hasBackground: false,
  hasVideo: false,
  videoExt: "mp4",
  dim: 35,
  blur: 0,
  animation: "none",
  showClock: true,
  showSeconds: false,
  showDate: true,
  clockFormat: "auto",
  showTodos: false,
  // off by default: the list is visible without the password
  todos: [],
  hoverReveal: false,
  titleMode: "auto",
  customTitle: "",
  showIcon: true,
  position: "center",
  fieldShape: "auto",
  clockScale: 100,
  clockFont: "auto",
  clockWeight: 300,
  textColor: "",
  accentColor: "",
  shrinkOnLock: false,
  lockWindowSize: "small",
  savedWindow: null,
  log: [],
  lockedAtExit: false
};
var DEVICE_ONLY_KEY = "lockscape-device-only";
var DEVICE_VALUES_KEY = "lockscape-device-values";
var IDLE_CHOICES = [0, 1, 5, 10, 15, 30, 60];
var GRACE_CHOICES = [0, 15, 30, 60, 300];
var ANIMATIONS = ["none", "aurora", "fireflies", "snow", "glow", "trail", "orbs"];
var BACKGROUND_KINDS = ["none", "image", "video"];
var POSITIONS = ["top", "center", "bottom"];
var FONT_STYLES = ["auto", "sans", "serif", "mono", "rounded"];
var FIELD_SHAPES = ["auto", "rounded", "pill", "square"];
var LEGACY_ANIMATIONS = { gradient: "aurora", bubbles: "fireflies" };
var APPEARANCE_KEYS = [
  "theme",
  "backgroundKind",
  "dim",
  "blur",
  "animation",
  "showClock",
  "showSeconds",
  "showDate",
  "clockFormat",
  "clockScale",
  "clockFont",
  "clockWeight",
  "hoverReveal",
  "titleMode",
  "customTitle",
  "showIcon",
  "position",
  "fieldShape",
  "textColor",
  "accentColor",
  "showTodos"
];
var CLOCK_FORMATS = ["auto", "24", "12"];
var TITLE_MODES = ["auto", "show", "hide"];
function num(v, fallback, min, max) {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
function bool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}
function oneOf(v, allowed, fallback) {
  return typeof v === "string" && allowed.includes(v) ? v : fallback;
}
function cleanTodos(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const x of v) {
    if (out.length >= MAX_TODOS) break;
    if (typeof x !== "object" || x === null) continue;
    const r = x;
    if (typeof r.id !== "string" || typeof r.text !== "string" || r.id.length > 64) continue;
    const text = clipChars(r.text.trim(), MAX_TODO_LENGTH);
    if (!text) continue;
    out.push({ id: r.id, text, done: r.done === true });
  }
  return out;
}
var VaultLockPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULTS };
    this.t = getStrings((0, import_obsidian3.getLanguage)());
    this.lastActivity = Date.now();
    this.hiddenAt = null;
    /** Documents of popout windows, taken straight from `window-open`: the window has no leaf yet at that moment. */
    this.popoutDocs = /* @__PURE__ */ new Set();
    /** The open set/change/remove-password dialog, so it can be closed when the lock engages. */
    this.passwordModal = null;
    /** This device keeps its own auto-lock options (see devicesettings.ts). Stored in local storage, never synced. */
    this.deviceOnly = false;
    /** The shared (data.json) values of the device keys while `deviceOnly` is on, so saving never overwrites them. */
    this.sharedDevice = {};
    this.stopSystemLock = null;
    this.watchedWindows = /* @__PURE__ */ new WeakSet();
  }
  get hasPassword() {
    return this.settings.credential !== null;
  }
  /** Persist whether the screen is locked, so quitting while locked cannot be used to get past the lock. */
  rememberLocked(locked) {
    if (this.settings.lockedAtExit === locked) return;
    this.settings.lockedAtExit = locked;
    void this.saveSettings();
  }
  /**
   * Called when the lock engages. The Settings screen opens in its own window, which the overlay does not cover,
   * and the password dialog opened from it lives there too: close both so nothing stays usable behind the lock.
   */
  closeOwnerDialogs() {
    this.passwordModal?.close();
    this.app.setting?.close?.();
  }
  /** The lock screen or the grace-period cover is up. Settings must not change then. */
  get isLockActive() {
    return this.lockScreen.isLocked || this.lockScreen.isCovering;
  }
  get pluginDir() {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }
  get imagePath() {
    return backgroundPath(this.pluginDir);
  }
  /** Local app:// resource URL of the chosen background photo, or null. Never a remote URL. */
  get imageUrl() {
    const s = this.settings;
    return s.backgroundKind === "image" && s.hasBackground ? this.app.vault.adapter.getResourcePath(this.imagePath) : null;
  }
  /** Local app:// resource URL of the chosen background video, or null. */
  get videoUrl() {
    const s = this.settings;
    return s.backgroundKind === "video" && s.hasVideo ? this.app.vault.adapter.getResourcePath(videoPath(this.pluginDir, s.videoExt)) : null;
  }
  async onload() {
    await this.loadSettings();
    this.t = getStrings((0, import_obsidian3.getLanguage)());
    this.lockScreen = new LockScreen(this.t, {
      submit: (pw, kind) => this.attemptUnlock(pw, kind),
      getRetryAt: () => this.capRetryAt(),
      getDocuments: () => this.collectDocuments(),
      getAppearance: () => this.appearance(),
      getTodos: () => this.settings.todos,
      setTodos: (todos) => {
        this.settings.todos = todos;
        void this.saveSettings();
      },
      onWindow: (active) => this.applyWindow(active),
      onHighScore: (game, score) => {
        if (score <= this.settings.highScores[game]) return;
        this.settings.highScores = { ...this.settings.highScores, [game]: Math.min(MAX_SCORE, Math.floor(score)) };
        void this.saveSettings();
      },
      onUnlocked: (kind) => {
        this.markActivity();
        this.rememberLocked(false);
        this.logEvent({ t: Date.now(), k: kind === "recovery" ? "recover" : "unlock" });
        if (kind === "recovery") window.setTimeout(() => new PasswordModal(this.app, this, "reset", () => {
        }).open(), 100);
      },
      onLock: () => {
        this.rememberLocked(true);
        this.closeOwnerDialogs();
      },
      keymap: this.app.keymap
    });
    if (this.hasPassword && (this.settings.lockOnStartup || this.settings.lockedAtExit)) this.lockWith("startup");
    else if (this.settings.savedWindow) this.applyWindow(false);
    this.addSettingTab(new VaultLockSettingTab(this.app, this));
    this.addCommand({ id: "lock-now", name: this.t.lockNow, callback: () => this.lockNow() });
    this.addCommand({ id: "hide-screen", name: this.t.hideScreen, callback: () => this.lockScreen.hideScreen() });
    this.addRibbonIcon("lock", this.t.lockNow, () => this.lockNow());
    this.watchActivity(window);
    this.app.workspace.onLayoutReady(() => {
      for (const doc of this.collectDocuments()) if (doc.defaultView) this.watchActivity(doc.defaultView);
    });
    this.registerEvent(
      this.app.workspace.on("window-open", (_w, win) => {
        this.watchActivity(win);
        this.popoutDocs.add(win.document);
        this.lockScreen.refresh();
        window.setTimeout(() => this.lockScreen.refresh(), 150);
      })
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (_w, win) => {
        this.popoutDocs.delete(win.document);
        this.lockScreen.refresh();
      })
    );
    this.registerInterval(window.setInterval(() => this.checkIdle(), 5e3));
    this.registerDomEvent(window, "focus", () => this.checkIdle());
    this.registerDomEvent(window, "pageshow", () => this.checkIdle());
    this.syncSystemLock();
  }
  onunload() {
    this.stopSystemLock?.();
    this.lockScreen?.destroy();
  }
  /** data.json changed on disk (sync from another device). Without this, our next save would overwrite it with stale values. */
  async onExternalSettingsChange() {
    const local = {
      log: this.settings.log,
      savedWindow: this.settings.savedWindow,
      lockedAtExit: this.settings.lockedAtExit,
      highScores: this.settings.highScores
    };
    await this.loadSettings();
    this.settings.log = mergeLogs(local.log, this.settings.log);
    this.settings.savedWindow = local.savedWindow;
    this.settings.lockedAtExit = local.lockedAtExit;
    this.settings.highScores = mergeHighScores(local.highScores, this.settings.highScores);
    this.syncSystemLock();
    this.lockScreen.refresh();
  }
  lockNow() {
    if (!this.hasPassword) {
      new import_obsidian3.Notice(this.t.noPassword);
      return;
    }
    this.lockWith("manual");
  }
  /** Lock, and note why in the activity log (once: locking an already locked screen adds nothing). */
  lockWith(reason) {
    if (!this.lockScreen.isLocked) this.logEvent({ t: Date.now(), k: "lock", r: reason });
    this.lockScreen.lock();
  }
  /** Make a new recovery key, store its hash and return the key to show once. Null if the lock engaged meanwhile. */
  async issueRecoveryKey() {
    const key = generateRecoveryKey();
    const credential = await createRecoveryCredential(key);
    if (this.isLockActive || !this.hasPassword) return null;
    this.settings.recovery = credential;
    await this.saveSettings();
    this.lockScreen.refresh();
    return key;
  }
  logEvent(entry) {
    this.settings.log = appendLog(this.settings.log, entry);
    void this.saveSettings();
  }
  refreshSystemLock() {
    this.syncSystemLock();
  }
  /** Lock when the OS locks the screen or goes to sleep (desktop, and only when the app exposes the power monitor). */
  syncSystemLock() {
    this.stopSystemLock?.();
    this.stopSystemLock = null;
    if (!import_obsidian3.Platform.isDesktopApp || !this.settings.lockOnSystemLock) return;
    this.stopSystemLock = watchSystemLock(() => {
      if (this.hasPassword && !this.lockScreen.isLocked) this.lockWith("system");
    });
  }
  /** Show the lock screen without locking (works without a password set). */
  previewLock() {
    this.lockScreen.preview();
  }
  /** Shrink the app window while the lock screen shows; restore it when it goes away. Desktop only. */
  applyWindow(active) {
    if (active) {
      if (!this.settings.shrinkOnLock || !import_obsidian3.Platform.isDesktopApp) return;
      const saved = shrinkWindow(WINDOW_SIZES[this.settings.lockWindowSize], this.settings.savedWindow);
      if (saved !== this.settings.savedWindow) {
        this.settings.savedWindow = saved;
        void this.saveSettings();
      }
    } else if (this.settings.savedWindow) {
      restoreWindow(this.settings.savedWindow);
      this.settings.savedWindow = null;
      void this.saveSettings();
    }
  }
  appearance() {
    const s = this.settings;
    return {
      hasRecovery: s.recovery !== null && s.credential !== null,
      theme: s.theme,
      highScores: s.highScores,
      imageUrl: this.imageUrl,
      videoUrl: this.videoUrl,
      dim: s.dim,
      blur: s.blur,
      animation: s.animation,
      showClock: s.showClock,
      showSeconds: s.showSeconds,
      showDate: s.showDate,
      clockFormat: s.clockFormat,
      showTodos: s.showTodos,
      hoverReveal: s.hoverReveal,
      titleMode: s.titleMode,
      customTitle: s.customTitle,
      showIcon: s.showIcon,
      position: s.position,
      fieldShape: s.fieldShape,
      clockScale: s.clockScale,
      clockFont: s.clockFont,
      clockWeight: s.clockWeight,
      textColor: s.textColor,
      accentColor: s.accentColor,
      locale: (0, import_obsidian3.getLanguage)()
    };
  }
  // ---- unlock / rate limiting ---------------------------------------------------------
  /** The stored wait can only be longer than the maximum if the system clock moved backwards: cap it (and keep the cap). */
  capRetryAt() {
    const limit = Date.now() + BACKOFF_MAX_MS;
    if (this.settings.retryAt > limit) {
      this.settings.retryAt = limit;
      void this.saveSettings();
    }
    return this.settings.retryAt;
  }
  /** Check the password, or the recovery key (`kind`). Both share one failure counter and one back-off. */
  async attemptUnlock(password, kind = "password") {
    this.capRetryAt();
    const now = Date.now();
    const cred = kind === "recovery" ? this.settings.recovery : this.settings.credential;
    if (!this.settings.credential) return { ok: true };
    if (!cred) return { ok: false, message: this.t.wrong };
    if (now < this.settings.retryAt) {
      return { ok: false, message: fmt(this.t.wait, Math.ceil((this.settings.retryAt - now) / 1e3)), retryAt: this.settings.retryAt };
    }
    if (!cryptoAvailable()) return { ok: false, message: this.t.cryptoError };
    if (password === "") return { ok: false, message: this.t.wrong };
    let ok = false;
    try {
      ok = kind === "recovery" ? await verifyRecoveryKey(password, cred) : await verifyPassword(password, cred);
    } catch {
      return { ok: false, message: this.t.cryptoError };
    }
    if (ok) {
      this.settings.failCount = 0;
      this.settings.retryAt = 0;
      await this.saveSettings();
      return { ok: true };
    }
    this.settings.failCount += 1;
    this.settings.log = appendLog(this.settings.log, { t: Date.now(), k: "fail" });
    if (this.settings.failCount >= FREE_ATTEMPTS) {
      const wait = Math.min(BACKOFF_BASE_MS * 2 ** (this.settings.failCount - FREE_ATTEMPTS), BACKOFF_MAX_MS);
      this.settings.retryAt = Date.now() + wait;
    }
    await this.saveSettings();
    return { ok: false, message: this.t.wrong, retryAt: this.settings.retryAt || void 0 };
  }
  // ---- idle / visibility --------------------------------------------------------------
  markActivity() {
    this.lastActivity = Date.now();
  }
  watchActivity(win) {
    if (this.watchedWindows.has(win)) return;
    this.watchedWindows.add(win);
    this.registerDomEvent(win.document, "visibilitychange", () => this.onVisibility());
    for (const ev of ["blur", "focus"]) {
      this.registerDomEvent(win, ev, () => {
        if (this.settings.coverOnBlur) window.setTimeout(() => this.onVisibility(), 150);
      });
    }
    const bump = () => {
      if (!this.lockScreen.isLocked && !this.lockScreen.isCovering) this.markActivity();
    };
    for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) {
      this.registerDomEvent(win, ev, bump, { passive: true, capture: true });
    }
    let last = 0;
    this.registerDomEvent(
      win,
      "pointermove",
      () => {
        const now = Date.now();
        if (now - last > 1e3) {
          last = now;
          bump();
        }
      },
      { passive: true, capture: true }
    );
  }
  checkIdle() {
    const { idleMinutes } = this.settings;
    if (!this.hasPassword || idleMinutes <= 0 || this.lockScreen.isLocked) return;
    if (this.lockScreen.isCovering && !this.lockScreen.isManualCover) return;
    if (Date.now() - this.lastActivity >= idleMinutes * 6e4) this.lockWith("idle");
  }
  onVisibility() {
    if (!this.hasPassword || !this.settings.lockOnHide) return;
    if (this.lockScreen.isManualCover) return;
    if (this.isAway()) {
      if (this.lockScreen.isLocked) return;
      if (this.hiddenAt !== null) return;
      this.hiddenAt = Date.now();
      if (this.settings.graceSeconds === 0) this.lockWith("left");
      else this.lockScreen.cover();
      return;
    }
    if (this.hiddenAt === null) return;
    const away = Date.now() - this.hiddenAt;
    this.hiddenAt = null;
    if (this.lockScreen.isLocked) return;
    if (away >= this.settings.graceSeconds * 1e3) this.lockWith("left");
    else {
      this.lockScreen.release();
      this.markActivity();
    }
  }
  /**
   * The app is out of sight: every window hidden or minimised, or (when the option is on) no window of the app has
   * focus. Obsidian's Settings window counts as the app, so using it never covers the notes.
   */
  isAway() {
    if (this.allWindowsHidden()) return true;
    if (!this.settings.coverOnBlur) return false;
    if (this.collectDocuments().some((d) => d.hasFocus())) return false;
    const settingsDoc = this.app.setting?.modalEl?.ownerDocument;
    return !(settingsDoc && settingsDoc !== document && settingsDoc.hasFocus());
  }
  allWindowsHidden() {
    return this.collectDocuments().every((d) => d.visibilityState === "hidden");
  }
  collectDocuments() {
    const docs = /* @__PURE__ */ new Set([document]);
    this.app.workspace.iterateAllLeaves((leaf) => {
      const doc = leaf.view?.containerEl?.ownerDocument;
      if (doc) docs.add(doc);
    });
    for (const doc of this.popoutDocs) {
      if (doc.defaultView && !doc.defaultView.closed) docs.add(doc);
      else this.popoutDocs.delete(doc);
    }
    return Array.from(docs);
  }
  // ---- settings I/O -------------------------------------------------------------------
  async loadSettings() {
    const stored = await this.loadData() ?? {};
    this.sharedDevice = pickDevice(this.parseSettings(stored));
    this.deviceOnly = this.app.loadLocalStorage(DEVICE_ONLY_KEY) === true;
    const raw = this.deviceOnly ? applyDevice(stored, this.app.loadLocalStorage(DEVICE_VALUES_KEY)) : stored;
    this.settings = this.parseSettings(raw);
  }
  parseSettings(raw) {
    const v1 = typeof raw.settingsVersion !== "number" || raw.settingsVersion < 2;
    const legacyFont = v1 && raw.clockFont === "sans" && (raw.clockWeight === void 0 || raw.clockWeight === 300);
    const legacyShape = v1 && raw.fieldShape === "rounded";
    return {
      settingsVersion: 2,
      theme: parseTheme(raw.theme),
      // retro and cartoon (earlier versions) fall back to the default
      highScores: parseHighScores(raw.highScores),
      credential: isCredential(raw.credential) ? raw.credential : null,
      recovery: isCredential(raw.credential) && isCredential(raw.recovery) ? raw.recovery : null,
      lockOnStartup: bool(raw.lockOnStartup, DEFAULTS.lockOnStartup),
      idleMinutes: num(raw.idleMinutes, DEFAULTS.idleMinutes, 0, 24 * 60),
      lockOnHide: bool(raw.lockOnHide, DEFAULTS.lockOnHide),
      coverOnBlur: bool(raw.coverOnBlur, DEFAULTS.coverOnBlur),
      lockOnSystemLock: bool(raw.lockOnSystemLock, DEFAULTS.lockOnSystemLock),
      graceSeconds: num(raw.graceSeconds, DEFAULTS.graceSeconds, 0, 3600),
      failCount: num(raw.failCount, 0, 0, 1e3),
      retryAt: num(raw.retryAt, 0, 0, Number.MAX_SAFE_INTEGER),
      backgroundKind: oneOf(raw.backgroundKind, BACKGROUND_KINDS, raw.hasBackground === true ? "image" : "none"),
      hasBackground: bool(raw.hasBackground, DEFAULTS.hasBackground),
      hasVideo: bool(raw.hasVideo, DEFAULTS.hasVideo),
      videoExt: oneOf(raw.videoExt, VIDEO_EXTS, DEFAULTS.videoExt),
      dim: num(raw.dim, DEFAULTS.dim, 0, 80),
      blur: num(raw.blur, DEFAULTS.blur, 0, 20),
      animation: oneOf(
        typeof raw.animation === "string" && raw.animation in LEGACY_ANIMATIONS ? LEGACY_ANIMATIONS[raw.animation] : raw.animation,
        ANIMATIONS,
        DEFAULTS.animation
      ),
      showClock: bool(raw.showClock, DEFAULTS.showClock),
      showSeconds: bool(raw.showSeconds, DEFAULTS.showSeconds),
      showDate: bool(raw.showDate, DEFAULTS.showDate),
      clockFormat: oneOf(raw.clockFormat, CLOCK_FORMATS, DEFAULTS.clockFormat),
      showTodos: bool(raw.showTodos, DEFAULTS.showTodos),
      todos: cleanTodos(raw.todos),
      hoverReveal: bool(raw.hoverReveal, DEFAULTS.hoverReveal),
      titleMode: oneOf(raw.titleMode, TITLE_MODES, DEFAULTS.titleMode),
      customTitle: typeof raw.customTitle === "string" ? clipChars(raw.customTitle.trim(), 60) : "",
      showIcon: bool(raw.showIcon, DEFAULTS.showIcon),
      position: oneOf(raw.position, POSITIONS, DEFAULTS.position),
      fieldShape: legacyShape ? "auto" : oneOf(raw.fieldShape, FIELD_SHAPES, DEFAULTS.fieldShape),
      clockScale: num(raw.clockScale, DEFAULTS.clockScale, 60, 160),
      clockFont: legacyFont ? "auto" : oneOf(raw.clockFont, FONT_STYLES, DEFAULTS.clockFont),
      clockWeight: num(raw.clockWeight, DEFAULTS.clockWeight, 100, 700),
      textColor: cleanHex(raw.textColor),
      accentColor: cleanHex(raw.accentColor),
      shrinkOnLock: bool(raw.shrinkOnLock, DEFAULTS.shrinkOnLock),
      lockWindowSize: oneOf(raw.lockWindowSize, WINDOW_SIZE_NAMES, DEFAULTS.lockWindowSize),
      savedWindow: isSavedWindow(raw.savedWindow) ? raw.savedWindow : null,
      log: parseLog(raw.log),
      lockedAtExit: bool(raw.lockedAtExit, false)
    };
  }
  async saveSettings() {
    if (this.deviceOnly) {
      this.app.saveLocalStorage(DEVICE_VALUES_KEY, pickDevice(this.settings));
      await this.saveData({ ...this.settings, ...this.sharedDevice });
    } else {
      await this.saveData(this.settings);
    }
  }
  /** Turn "separate settings on this device" on or off. Off goes back to the shared values. */
  async setDeviceOnly(on) {
    if (on === this.deviceOnly) return;
    this.deviceOnly = on;
    if (on) {
      this.sharedDevice = pickDevice(this.settings);
      this.app.saveLocalStorage(DEVICE_ONLY_KEY, true);
    } else {
      Object.assign(this.settings, this.sharedDevice);
      this.app.saveLocalStorage(DEVICE_ONLY_KEY, null);
      this.app.saveLocalStorage(DEVICE_VALUES_KEY, null);
    }
    await this.saveSettings();
    this.syncSystemLock();
  }
};
var VaultLockSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    const t = this.plugin.t;
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    containerEl.empty();
    containerEl.createEl("p", { text: t.settingsInfo, cls: "setting-item-description" });
    const pw = new import_obsidian3.Setting(containerEl).setName(t.password).setDesc(this.plugin.hasPassword ? t.passwordSet : t.passwordNotSet);
    if (this.plugin.hasPassword) {
      pw.addButton((b) => b.setButtonText(t.changePassword).onClick(() => this.openModal("change")));
      pw.addButton((b) => b.setButtonText(t.removePassword).setWarning().onClick(() => this.openModal("remove")));
    } else {
      pw.addButton((b) => b.setButtonText(t.setPassword).setCta().onClick(() => this.openModal("set")));
    }
    if (this.plugin.hasPassword) {
      new import_obsidian3.Setting(containerEl).setName(t.recoveryRow).setDesc(s.recovery ? t.recoveryOn : t.recoveryOff).addButton((b) => b.setButtonText(s.recovery ? t.renewRecovery : t.makeRecovery).onClick(() => this.openModal("recovery")));
    }
    new import_obsidian3.Setting(containerEl).setName(t.lockOnStartup).addToggle(
      (c) => c.setValue(s.lockOnStartup).onChange(async (v) => {
        s.lockOnStartup = v;
        await save();
      })
    );
    new import_obsidian3.Setting(containerEl).setName(t.idle).addDropdown((c) => {
      for (const m of IDLE_CHOICES) c.addOption(String(m), m === 0 ? t.idleOff : fmt(t.minutes, m));
      c.setValue(String(s.idleMinutes)).onChange(async (v) => {
        s.idleMinutes = Number(v);
        await save();
      });
    });
    new import_obsidian3.Setting(containerEl).setName(t.lockOnHide).setDesc(t.lockOnHideDesc).addToggle(
      (c) => c.setValue(s.lockOnHide).onChange(async (v) => {
        s.lockOnHide = v;
        await save();
      })
    );
    new import_obsidian3.Setting(containerEl).setName(t.grace).setDesc(t.graceDesc).addDropdown((c) => {
      for (const g of GRACE_CHOICES) {
        c.addOption(String(g), g === 0 ? t.immediately : g >= 60 ? fmt(t.minutes, g / 60) : fmt(t.seconds, g));
      }
      c.setValue(String(s.graceSeconds)).onChange(async (v) => {
        s.graceSeconds = Number(v);
        await save();
      });
    });
    new import_obsidian3.Setting(containerEl).setName(t.coverOnBlur).setDesc(t.coverOnBlurDesc).addToggle(
      (c) => c.setValue(s.coverOnBlur).onChange(async (v) => {
        s.coverOnBlur = v;
        await save();
      })
    );
    if (import_obsidian3.Platform.isDesktopApp) {
      new import_obsidian3.Setting(containerEl).setName(t.lockOnSystemLock).setDesc(t.lockOnSystemLockDesc).addToggle(
        (c) => c.setValue(s.lockOnSystemLock).onChange(async (v) => {
          s.lockOnSystemLock = v;
          await save();
          this.plugin.refreshSystemLock();
        })
      );
    }
    new import_obsidian3.Setting(containerEl).setName(t.deviceOnly).setDesc(t.deviceOnlyDesc).addToggle(
      (c) => c.setValue(this.plugin.deviceOnly).onChange(async (v) => {
        await this.plugin.setDeviceOnly(v);
        this.display();
      })
    );
    this.displayAppearance(containerEl, t, s, save);
    this.displayLog(containerEl, t);
  }
  displayLog(containerEl, t) {
    const s = this.plugin.settings;
    new import_obsidian3.Setting(containerEl).setName(t.logTitle).setHeading();
    const row = new import_obsidian3.Setting(containerEl).setDesc(t.logDesc);
    row.addButton(
      (b) => b.setButtonText(t.logClear).onClick(async () => {
        s.log = [];
        await this.plugin.saveSettings();
        this.display();
      })
    );
    if (s.log.length === 0) {
      containerEl.createEl("p", { text: t.logEmpty, cls: "setting-item-description" });
      return;
    }
    const list = containerEl.createEl("ul", { cls: "vault-lock-log" });
    const reasons = {
      startup: t.reasonStartup,
      idle: t.reasonIdle,
      left: t.reasonLeft,
      manual: t.reasonManual,
      system: t.reasonSystem
    };
    for (const e of [...s.log].reverse()) {
      const what = e.k === "lock" ? `${t.logLocked}${e.r ? ` \xB7 ${reasons[e.r]}` : ""}` : e.k === "unlock" ? t.logUnlocked : e.k === "recover" ? t.logRecovered : t.logFailed;
      list.createEl("li", { text: `${new Date(e.t).toLocaleString()}  ${what}` });
    }
  }
  displayAppearance(containerEl, t, s, save) {
    const doc = containerEl.ownerDocument;
    const heading = (name) => new import_obsidian3.Setting(containerEl).setName(name).setHeading();
    const redraw = () => this.display();
    const toggle = (name, get, set, desc) => {
      const row = new import_obsidian3.Setting(containerEl).setName(name);
      if (desc) row.setDesc(desc);
      row.addToggle(
        (c) => c.setValue(get()).onChange(async (v) => {
          set(v);
          await save();
        })
      );
    };
    const choice = (name, values, labels, get, set, after) => {
      new import_obsidian3.Setting(containerEl).setName(name).addDropdown((c) => {
        for (const v of values) c.addOption(v, labels[v]);
        c.setValue(get()).onChange(async (v) => {
          set(oneOf(v, values, values[0]));
          await save();
          after?.();
        });
      });
    };
    const slide = (name, min, max, step2, get, set) => {
      return new import_obsidian3.Setting(containerEl).setName(name).addSlider(
        (c) => c.setLimits(min, max, step2).setValue(get()).setDynamicTooltip().onChange(async (v) => {
          set(v);
          await save();
        })
      );
    };
    const color = (name, key, fallback) => {
      const row = new import_obsidian3.Setting(containerEl).setName(name).setDesc(s[key] || t.colorAuto);
      row.addColorPicker(
        (c) => c.setValue(s[key] || fallback).onChange(async (v) => {
          s[key] = cleanHex(v);
          row.setDesc(s[key] || t.colorAuto);
          await save();
        })
      );
      row.addExtraButton(
        (b) => b.setIcon("rotate-ccw").setTooltip(t.resetColor).onClick(async () => {
          s[key] = "";
          await save();
          redraw();
        })
      );
    };
    new import_obsidian3.Setting(containerEl).setName(t.appearance).setHeading();
    new import_obsidian3.Setting(containerEl).setName(t.preview).setDesc(t.previewDesc).addButton(
      (b) => b.setButtonText(t.preview).onClick(() => {
        try {
          this.app.setting?.close?.();
        } catch {
        }
        this.plugin.previewLock();
      })
    );
    if (windowResizeSupported()) {
      new import_obsidian3.Setting(containerEl).setName(t.shrinkWindow).setDesc(t.shrinkWindowDesc).addToggle(
        (c) => c.setValue(s.shrinkOnLock).onChange(async (v) => {
          s.shrinkOnLock = v;
          syncSizeRow(v);
          await save();
        })
      );
      const sizeRow = new import_obsidian3.Setting(containerEl).setName(t.lockWindowSize).addDropdown((c) => {
        for (const name of WINDOW_SIZE_NAMES) {
          const z = WINDOW_SIZES[name];
          c.addOption(name, `${z.width} \xD7 ${z.height}`);
        }
        c.setValue(s.lockWindowSize).onChange(async (v) => {
          s.lockWindowSize = oneOf(v, WINDOW_SIZE_NAMES, "small");
          await save();
        });
      });
      const syncSizeRow = (enabled) => {
        sizeRow.setDisabled(!enabled);
        sizeRow.settingEl.toggleClass("is-disabled", !enabled);
      };
      syncSizeRow(s.shrinkOnLock);
    }
    choice(
      t.theme,
      THEMES,
      {
        default: t.themeDefault,
        win95: t.themeWin95,
        terminal: t.themeTerminal,
        "gameboy-snake": t.themeSnake,
        "neon-breakout": t.themeBreakout,
        "obsidian-runner": t.themeRunner
      },
      () => s.theme,
      (v) => s.theme = v
    );
    heading(t.secBackground);
    choice(
      t.bgKind,
      BACKGROUND_KINDS,
      { none: t.bgKindNone, image: t.bgKindImage, video: t.bgKindVideo },
      () => s.backgroundKind,
      (v) => s.backgroundKind = v,
      redraw
    );
    if (s.backgroundKind === "image") {
      const row = new import_obsidian3.Setting(containerEl).setName(t.bgImage).setDesc(t.bgImageDesc);
      if (s.hasBackground) {
        const thumb = row.controlEl.createEl("img", { cls: "vault-lock-thumb" });
        thumb.src = this.plugin.app.vault.adapter.getResourcePath(this.plugin.imagePath);
        thumb.alt = "";
      }
      row.addButton(
        (b) => b.setButtonText(t.chooseImage).onClick(async () => {
          try {
            if (!await chooseBackground(this.app, this.plugin.pluginDir, doc)) return;
            s.hasBackground = true;
            await save();
            redraw();
          } catch {
            new import_obsidian3.Notice(t.imageFailed);
          }
        })
      );
      if (s.hasBackground) {
        row.addButton(
          (b) => b.setButtonText(t.removeImage).onClick(async () => {
            await removeBackground(this.app, this.plugin.pluginDir);
            s.hasBackground = false;
            await save();
            redraw();
          })
        );
      }
    }
    if (s.backgroundKind === "video") {
      const row = new import_obsidian3.Setting(containerEl).setName(t.bgVideo).setDesc(t.bgVideoDesc);
      row.addButton(
        (b) => b.setButtonText(t.chooseVideo).onClick(async () => {
          try {
            const ext = await chooseVideo(this.app, this.plugin.pluginDir, doc);
            if (!ext) return;
            s.hasVideo = true;
            s.videoExt = ext;
            await save();
            redraw();
          } catch {
            new import_obsidian3.Notice(t.videoFailed);
          }
        })
      );
      if (s.hasVideo) {
        row.addButton(
          (b) => b.setButtonText(t.removeImage).onClick(async () => {
            await removeVideo(this.app, this.plugin.pluginDir);
            s.hasVideo = false;
            await save();
            redraw();
          })
        );
      }
    }
    if (s.backgroundKind !== "none") {
      slide(t.dim, 0, 80, 5, () => s.dim, (v) => s.dim = v);
      slide(t.blur, 0, 20, 1, () => s.blur, (v) => s.blur = v);
    }
    choice(
      t.animation,
      ANIMATIONS,
      {
        none: t.animNone,
        aurora: t.animAurora,
        fireflies: t.animFireflies,
        snow: t.animSnow,
        glow: t.animGlow,
        trail: t.animTrail,
        orbs: t.animOrbs
      },
      () => s.animation,
      (v) => s.animation = v
    );
    heading(t.secText);
    color(t.textColor, "textColor", "#ffffff");
    color(t.accentColor, "accentColor", "#7c5cd6");
    slide(t.clockSize, 60, 160, 5, () => s.clockScale, (v) => s.clockScale = v);
    choice(
      t.clockFont,
      FONT_STYLES,
      { auto: t.themeAuto, sans: t.fontSans, serif: t.fontSerif, mono: t.fontMono, rounded: t.fontRounded },
      () => s.clockFont,
      (v) => s.clockFont = v,
      () => syncWeightRow()
    );
    const weightRow = slide(t.clockWeight, 100, 700, 100, () => s.clockWeight, (v) => s.clockWeight = v);
    const syncWeightRow = () => {
      weightRow.setDisabled(s.clockFont === "auto");
      weightRow.settingEl.toggleClass("is-disabled", s.clockFont === "auto");
    };
    syncWeightRow();
    new import_obsidian3.Setting(containerEl).setName(t.customTitle).setDesc(t.customTitleDesc).addText(
      (c) => c.setPlaceholder(t.lockedTitle).setValue(s.customTitle).then((tc) => tc.inputEl.maxLength = 60).onChange(async (v) => {
        s.customTitle = clipChars(v.trim(), 60);
        await save();
      })
    );
    choice(
      t.showTitle,
      TITLE_MODES,
      { auto: t.titleAuto, show: t.titleShow, hide: t.titleHide },
      () => s.titleMode,
      (v) => s.titleMode = v
    );
    heading(t.secLayout);
    choice(
      t.position,
      POSITIONS,
      { top: t.posTop, center: t.posCenter, bottom: t.posBottom },
      () => s.position,
      (v) => s.position = v
    );
    choice(
      t.fieldShape,
      FIELD_SHAPES,
      { auto: t.themeAuto, rounded: t.shapeRounded, pill: t.shapePill, square: t.shapeSquare },
      () => s.fieldShape,
      (v) => s.fieldShape = v
    );
    toggle(t.showIcon, () => s.showIcon, (v) => s.showIcon = v);
    toggle(t.hoverReveal, () => s.hoverReveal, (v) => s.hoverReveal = v, t.hoverRevealDesc);
    heading(t.secWidgets);
    toggle(t.showClock, () => s.showClock, (v) => s.showClock = v);
    toggle(t.showSeconds, () => s.showSeconds, (v) => s.showSeconds = v);
    toggle(t.showDate, () => s.showDate, (v) => s.showDate = v);
    choice(
      t.clockFormat,
      CLOCK_FORMATS,
      { auto: t.fmtAuto, "24": t.fmt24, "12": t.fmt12 },
      () => s.clockFormat,
      (v) => s.clockFormat = v
    );
    toggle(t.showTodos, () => s.showTodos, (v) => s.showTodos = v, t.showTodosDesc);
    new import_obsidian3.Setting(containerEl).setName(t.resetAppearance).setDesc(t.resetAppearanceDesc).addButton(
      (b) => b.setButtonText(t.resetAppearanceBtn).setWarning().onClick(async () => {
        for (const key of APPEARANCE_KEYS) s[key] = DEFAULTS[key];
        await save();
        redraw();
      })
    );
  }
  openModal(mode) {
    new PasswordModal(this.app, this.plugin, mode, () => this.display()).open();
  }
};
var PasswordModal = class extends import_obsidian3.Modal {
  constructor(app, plugin, mode, onDone) {
    super(app);
    this.plugin = plugin;
    this.mode = mode;
    this.onDone = onDone;
    this.current = "";
    this.next = "";
    this.confirm = "";
    this.submitting = false;
  }
  onOpen() {
    this.plugin.passwordModal = this;
    const t = this.plugin.t;
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(
      { set: t.modalSet, change: t.modalChange, remove: t.modalRemove, reset: t.modalReset, recovery: t.modalRecovery }[this.mode]
    );
    if (this.mode === "reset") contentEl.createEl("p", { text: t.resetIntro, cls: "setting-item-description" });
    const field = (name, set) => new import_obsidian3.Setting(contentEl).setName(name).addText((c) => {
      c.inputEl.type = "password";
      c.inputEl.autocomplete = "off";
      c.onChange(set);
    });
    if (this.mode !== "set" && this.mode !== "reset") field(t.current, (v) => this.current = v);
    if (this.mode !== "remove" && this.mode !== "recovery") {
      field(t.newPw, (v) => this.next = v);
      field(t.confirmPw, (v) => this.confirm = v);
    }
    new import_obsidian3.Setting(contentEl).addButton((b) => b.setButtonText(t.cancel).onClick(() => this.close())).addButton((b) => b.setButtonText(t.save).setCta().onClick(() => void this.submit()));
    this.scope.register([], "Enter", () => {
      void this.submit();
      return false;
    });
  }
  onClose() {
    if (this.plugin.passwordModal === this) this.plugin.passwordModal = null;
    this.contentEl.empty();
  }
  /** Enter mashed twice must not run two checks at once (each wrong one would count as a failure). */
  async submit() {
    if (this.submitting) return;
    this.submitting = true;
    try {
      await this.run();
    } finally {
      this.submitting = false;
    }
  }
  async run() {
    const t = this.plugin.t;
    if (this.plugin.isLockActive) {
      this.close();
      return;
    }
    if (!cryptoAvailable()) {
      new import_obsidian3.Notice(t.cryptoError);
      return;
    }
    if (this.mode !== "set" && this.mode !== "reset") {
      const res = await this.plugin.attemptUnlock(this.current);
      if (!res.ok) {
        new import_obsidian3.Notice(res.message);
        return;
      }
    }
    if (this.plugin.isLockActive) return this.close();
    let newKey = null;
    if (this.mode === "remove") {
      this.plugin.settings.credential = null;
      this.plugin.settings.recovery = null;
      await this.plugin.saveSettings();
      new import_obsidian3.Notice(t.removed);
    } else if (this.mode === "recovery") {
      newKey = await this.plugin.issueRecoveryKey();
      if (!newKey) return this.close();
    } else {
      if (charCount(this.next.normalize("NFKC")) < MIN_PASSWORD_LENGTH) {
        new import_obsidian3.Notice(fmt(t.tooShort, MIN_PASSWORD_LENGTH));
        return;
      }
      if (this.next !== this.confirm) {
        new import_obsidian3.Notice(t.mismatch);
        return;
      }
      const credential = await createCredential(this.next);
      if (this.plugin.isLockActive) return this.close();
      this.plugin.settings.credential = credential;
      this.plugin.settings.failCount = 0;
      this.plugin.settings.retryAt = 0;
      await this.plugin.saveSettings();
      new import_obsidian3.Notice(t.saved);
      if (this.mode === "set" || this.mode === "reset") {
        newKey = await this.plugin.issueRecoveryKey();
        if (!newKey) return this.close();
      }
    }
    this.close();
    this.onDone();
    if (newKey) new RecoveryKeyModal(this.app, this.plugin, newKey).open();
  }
};
var RecoveryKeyModal = class extends import_obsidian3.Modal {
  constructor(app, plugin, key) {
    super(app);
    this.plugin = plugin;
    this.key = key;
  }
  onOpen() {
    this.plugin.passwordModal = this;
    const t = this.plugin.t;
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(t.recoveryKeyTitle);
    contentEl.createEl("p", { text: t.recoveryKeyIntro });
    contentEl.createEl("code", { text: this.key ?? "", cls: "vault-lock-recovery-key" });
    new import_obsidian3.Setting(contentEl).addButton(
      (b) => b.setButtonText(t.copyKey).onClick(async () => {
        try {
          await navigator.clipboard.writeText(this.key ?? "");
          new import_obsidian3.Notice(t.copied);
        } catch {
        }
      })
    ).addButton((b) => b.setButtonText(t.keySaved).setCta().onClick(() => this.close()));
  }
  onClose() {
    if (this.plugin.passwordModal === this) this.plugin.passwordModal = null;
    this.key = null;
    this.contentEl.empty();
  }
};
