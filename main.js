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
    input.style.display = "none";
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
  await removeVideo(app, pluginDir);
  await app.vault.adapter.writeBinary(videoPath(pluginDir, ext), await file.arrayBuffer());
  return ext;
}
async function removeVideo(app, pluginDir) {
  for (const ext of VIDEO_EXTS) {
    const path = videoPath(pluginDir, ext);
    if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
  }
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
  const hash = await derive(password, salt, ITERATIONS);
  return { v: 1, salt: toB64(salt), iter: ITERATIONS, hash: toB64(hash) };
}
async function verifyPassword(password, cred) {
  const hash = await derive(password, fromB64(cred.salt), cred.iter);
  return equalConstantTime(hash, fromB64(cred.hash));
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
  themeRetro: "Retro game",
  themeCartoon: "Cartoon (classic comics)",
  themeAuto: "Theme default",
  animGlow: "Cursor spotlight",
  animTrail: "Cursor trail",
  animOrbs: "Chasing orbs",
  pressAnyKey: "Press any key or tap",
  unlocked: "Unlocked"
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
  themeRetro: "\uB808\uD2B8\uB85C \uAC8C\uC784",
  themeCartoon: "\uCE74\uD230 (\uC61B\uB0A0 \uBBF8\uAD6D \uB9CC\uD654)",
  themeAuto: "\uD14C\uB9C8 \uAE30\uBCF8",
  animGlow: "\uB9C8\uC6B0\uC2A4 \uC870\uBA85",
  animTrail: "\uB9C8\uC6B0\uC2A4 \uADA4\uC801",
  animOrbs: "\uB530\uB77C\uC624\uB294 \uAD6C\uC2AC",
  pressAnyKey: "\uC544\uBB34 \uD0A4\uB098 \uB204\uB974\uAC70\uB098 \uD130\uCE58\uD558\uC138\uC694",
  unlocked: "\uC7A0\uAE08 \uD574\uC81C\uB428"
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
  themeRetro: "\u30EC\u30C8\u30ED\u30B2\u30FC\u30E0",
  themeCartoon: "\u30AB\u30FC\u30C8\u30A5\u30FC\u30F3(\u30A2\u30E1\u30B3\u30DF)",
  themeAuto: "\u30C6\u30FC\u30DE\u306E\u65E2\u5B9A",
  animGlow: "\u30AB\u30FC\u30BD\u30EB\u306E\u30B9\u30DD\u30C3\u30C8\u30E9\u30A4\u30C8",
  animTrail: "\u30AB\u30FC\u30BD\u30EB\u306E\u8ECC\u8DE1",
  animOrbs: "\u8FFD\u3044\u304B\u3051\u308B\u7403",
  pressAnyKey: "\u30AD\u30FC\u3092\u62BC\u3059\u304B\u30BF\u30C3\u30D7\u3057\u3066\u304F\u3060\u3055\u3044",
  unlocked: "\u30ED\u30C3\u30AF\u89E3\u9664\u3057\u307E\u3057\u305F"
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
  themeRetro: "\u590D\u53E4\u6E38\u620F",
  themeCartoon: "\u5361\u901A(\u7F8E\u5F0F\u6F2B\u753B)",
  themeAuto: "\u4E3B\u9898\u9ED8\u8BA4",
  animGlow: "\u9F20\u6807\u805A\u5149\u706F",
  animTrail: "\u9F20\u6807\u8F68\u8FF9",
  animOrbs: "\u8FFD\u968F\u5149\u7403",
  pressAnyKey: "\u6309\u4EFB\u610F\u952E\u6216\u70B9\u6309",
  unlocked: "\u5DF2\u89E3\u9501"
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
  themeRetro: "\u5FA9\u53E4\u904A\u6232",
  themeCartoon: "\u5361\u901A(\u7F8E\u5F0F\u6F2B\u756B)",
  themeAuto: "\u4E3B\u984C\u9810\u8A2D",
  animGlow: "\u6ED1\u9F20\u805A\u5149\u71C8",
  animTrail: "\u6ED1\u9F20\u8ECC\u8DE1",
  animOrbs: "\u8FFD\u96A8\u5149\u7403",
  pressAnyKey: "\u6309\u4EFB\u610F\u9375\u6216\u9EDE\u4E00\u4E0B",
  unlocked: "\u5DF2\u89E3\u9396"
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
  themeRetro: "Videojuego retro",
  themeCartoon: "Dibujos animados (c\xF3mic cl\xE1sico)",
  themeAuto: "Predeterminada del tema",
  animGlow: "Foco que sigue al cursor",
  animTrail: "Estela del cursor",
  animOrbs: "Esferas perseguidoras",
  pressAnyKey: "Pulsa una tecla o toca",
  unlocked: "Desbloqueado"
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
  themeRetro: "Jeu r\xE9tro",
  themeCartoon: "Dessin anim\xE9 (comics d'\xE9poque)",
  themeAuto: "D\xE9faut du th\xE8me",
  animGlow: "Projecteur qui suit le curseur",
  animTrail: "Tra\xEEn\xE9e du curseur",
  animOrbs: "Orbes poursuivants",
  pressAnyKey: "Appuyez sur une touche ou touchez",
  unlocked: "D\xE9verrouill\xE9"
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
  themeRetro: "Retro-Spiel",
  themeCartoon: "Cartoon (Comic-Stil)",
  themeAuto: "Theme-Standard",
  animGlow: "Cursor-Scheinwerfer",
  animTrail: "Cursor-Spur",
  animOrbs: "Folgende Kugeln",
  pressAnyKey: "Taste dr\xFCcken oder tippen",
  unlocked: "Entsperrt"
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
  themeRetro: "Jogo retr\xF4",
  themeCartoon: "Desenho animado (quadrinhos cl\xE1ssicos)",
  themeAuto: "Padr\xE3o do tema",
  animGlow: "Holofote do cursor",
  animTrail: "Rastro do cursor",
  animOrbs: "Esferas perseguidoras",
  pressAnyKey: "Pressione uma tecla ou toque",
  unlocked: "Desbloqueado"
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
  themeRetro: "\u0420\u0435\u0442\u0440\u043E-\u0438\u0433\u0440\u0430",
  themeCartoon: "\u041C\u0443\u043B\u044C\u0442\u0444\u0438\u043B\u044C\u043C (\u043A\u043B\u0430\u0441\u0441\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043A\u043E\u043C\u0438\u043A\u0441\u044B)",
  themeAuto: "\u0418\u0437 \u0442\u0435\u043C\u044B",
  animGlow: "\u041F\u0440\u043E\u0436\u0435\u043A\u0442\u043E\u0440 \u0437\u0430 \u043A\u0443\u0440\u0441\u043E\u0440\u043E\u043C",
  animTrail: "\u0421\u043B\u0435\u0434 \u043A\u0443\u0440\u0441\u043E\u0440\u0430",
  animOrbs: "\u041F\u0440\u0435\u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0438\u0435 \u0448\u0430\u0440\u044B",
  pressAnyKey: "\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043A\u043B\u0430\u0432\u0438\u0448\u0443 \u0438\u043B\u0438 \u043A\u043E\u0441\u043D\u0438\u0442\u0435\u0441\u044C",
  unlocked: "\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u043E"
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
  try {
    const stored = window.localStorage.getItem("language");
    if (stored) return stored;
  } catch {
  }
  return navigator.language || "en";
}
function getStrings(tag = detectTag()) {
  return LOCALES[resolveLocale(tag)];
}
function fmt(template, n) {
  return template.replace("{n}", String(n));
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
    w.setBounds(fitToDisplay(target), true);
    return saved;
  } catch {
    return existing;
  }
}
function restoreWindow(saved) {
  const w = electronWindow();
  if (!w) return;
  try {
    w.setBounds(fitToDisplay(saved.bounds), true);
    if (saved.maximized) w.maximize();
  } catch {
  }
}

// src/lockscreen.ts
var import_obsidian2 = require("obsidian");

// src/pointerfx.ts
var BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];
var PIXEL = 6;
var MAX_PARTICLES = 90;
var rnd = (a, b) => a + Math.random() * (b - a);
var PointerFx = class {
  constructor(doc, win, host, kind, theme, colors) {
    this.doc = doc;
    this.win = win;
    this.kind = kind;
    this.theme = theme;
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
    this.scale = this.theme === "retro" ? 1 / PIXEL : dpr;
    this.canvas.width = Math.max(1, Math.ceil(this.w * this.scale));
    this.canvas.height = Math.max(1, Math.ceil(this.h * this.scale));
    this.canvas.style.imageRendering = this.theme === "retro" ? "pixelated" : "auto";
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
        if (this.theme === "retro") p.vy += 300 * dt;
        else p.vx *= 1 - 0.8 * dt;
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
        r: this.theme === "retro" ? rnd(2, 4.5) * PIXEL : rnd(16, 36),
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
    const spacing = this.theme === "cartoon" ? 26 : this.theme === "retro" ? 14 : 9;
    const n = Math.min(6, Math.floor(dist / spacing));
    for (let i = 1; i <= n; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const f = i / n;
      const cartoon = this.theme === "cartoon";
      this.particles.push({
        x: this.last.x + dx * f,
        y: this.last.y + dy * f,
        vx: rnd(-18, 18),
        vy: this.theme === "retro" ? rnd(-30, 10) : rnd(-18, 18),
        age: 0,
        life: cartoon ? rnd(0.7, 1) : this.theme === "retro" ? rnd(0.7, 1.1) : rnd(0.8, 1.3),
        size: cartoon ? rnd(10, 19) : this.theme === "retro" ? 1 + Math.floor(Math.random() * 2) : rnd(5, 13),
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
    const k = this.theme === "retro" ? 1 : this.scale;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (this.theme === "retro") this.drawRetro(ctx, time);
    else if (this.theme === "cartoon") this.drawCartoon(ctx, time);
    else this.drawDefault(ctx, time);
  }
  color(i) {
    return this.colors[i % this.colors.length];
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
        const f = 1 - p.age / p.life;
        const r = p.size * (0.4 + f * 0.8);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, this.rgba(p.ci, 1));
        g.addColorStop(1, this.rgba(p.ci, 0));
        ctx.globalAlpha = 0.85 * f;
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
  /** Pixel style: everything on a coarse grid (the canvas itself is low-res and scaled up crisply). */
  drawRetro(ctx, time) {
    const cell = (x, y, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(Math.floor(x / PIXEL), Math.floor(y / PIXEL), 1, 1);
    };
    if (this.kind === "glow") {
      const R = Math.min(this.w, this.h) * 0.3;
      const cx = Math.floor(this.pos.x / PIXEL);
      const cy = Math.floor(this.pos.y / PIXEL);
      const rc = Math.ceil(R / PIXEL);
      const strength = this.glowAlpha;
      for (let y = -rc; y <= rc; y++) {
        for (let x = -rc; x <= rc; x++) {
          const d = Math.hypot(x, y) / rc;
          if (d >= 1) continue;
          const level = (1 - d) * strength;
          if (level > BAYER[cy + y & 3][cx + x & 3] / 16 + 0.04) {
            ctx.fillStyle = d < 0.45 ? this.color(1) : this.color(0);
            ctx.fillRect(cx + x, cy + y, 1, 1);
          }
        }
      }
    } else if (this.kind === "trail") {
      for (const p of this.particles) {
        const f = 1 - p.age / p.life;
        if (f < 0.3 && Math.floor(time * 18 + p.ci) % 2 === 0) continue;
        const s = p.size;
        ctx.fillStyle = this.color(p.ci);
        ctx.fillRect(Math.floor(p.x / PIXEL), Math.floor(p.y / PIXEL), s, s);
      }
    } else {
      for (const o of this.orbs) {
        const cx = Math.round(o.x / PIXEL);
        const cy = Math.round(o.y / PIXEL);
        const r = Math.round(o.r / PIXEL);
        for (let y = -r; y <= r; y++) {
          for (let x = -r; x <= r; x++) {
            const d = x * x + y * y;
            if (d > r * r + 1) continue;
            ctx.fillStyle = d > (r - 1) * (r - 1) ? "#0d0b1e" : this.color(o.ci);
            ctx.fillRect(cx + x, cy + y, 1, 1);
          }
        }
        cell(o.x - o.r * 0.4, o.y - o.r * 0.4, "#ffffff");
      }
    }
  }
  /** Comic style: halftone dots, outlined stars, glossy outlined balls. */
  drawCartoon(ctx, _time) {
    const ink = "#111";
    if (this.kind === "glow") {
      const R = Math.min(this.w, this.h) * 0.3;
      const step = 15;
      const x0 = Math.floor((this.pos.x - R) / step) * step;
      const y0 = Math.floor((this.pos.y - R) / step) * step;
      ctx.fillStyle = this.color(1);
      ctx.globalAlpha = 0.75 * this.glowAlpha;
      for (let y = y0; y < this.pos.y + R; y += step) {
        for (let x = x0; x < this.pos.x + R; x += step) {
          const ox = (y / step & 1) * (step / 2);
          const px = x + ox;
          const d = Math.hypot(px - this.pos.x, y - this.pos.y) / R;
          if (d >= 1) continue;
          const r = (1 - d) * (step * 0.62);
          ctx.beginPath();
          ctx.arc(px, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    } else if (this.kind === "trail") {
      for (const p of this.particles) {
        const f = 1 - p.age / p.life;
        const pop = f > 0.85 ? 0.6 + (1 - f) * 8 : 0.35 + f * 0.65;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(pop, pop);
        ctx.lineWidth = 3;
        ctx.strokeStyle = ink;
        ctx.fillStyle = this.color(p.ci);
        this.star(ctx, p.size, p.size * 0.45, 5);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    } else {
      for (const o of this.orbs) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.arc(o.x + 4, o.y + 4, o.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = ink;
        ctx.fillStyle = this.color(o.ci);
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r * 0.62, Math.PI * 1.15, Math.PI * 1.5);
        ctx.stroke();
      }
    }
  }
  star(ctx, outer, inner, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = i * Math.PI / points - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
};

// src/segments.ts
var SVG_NS = "http://www.w3.org/2000/svg";
function hbar(cx, cy, len, th) {
  const h = th / 2;
  const l = len / 2;
  return `${cx - l},${cy} ${cx - l + h},${cy - h} ${cx + l - h},${cy - h} ${cx + l},${cy} ${cx + l - h},${cy + h} ${cx - l + h},${cy + h}`;
}
function vbar(cx, cy, len, th) {
  const h = th / 2;
  const l = len / 2;
  return `${cx},${cy - l} ${cx + h},${cy - l + h} ${cx + h},${cy + l - h} ${cx},${cy + l} ${cx - h},${cy + l - h} ${cx - h},${cy - l + h}`;
}
var SEGMENTS = {
  a: hbar(30, 5, 40, 9),
  b: vbar(55, 28.5, 38, 9),
  c: vbar(55, 75.5, 38, 9),
  d: hbar(30, 99, 40, 9),
  e: vbar(5, 75.5, 38, 9),
  f: vbar(5, 28.5, 38, 9),
  g: hbar(30, 52, 40, 9)
};
var LIT = {
  "0": "abcdef",
  "1": "bc",
  "2": "abdeg",
  "3": "abcdg",
  "4": "bcfg",
  "5": "acdfg",
  "6": "acdefg",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg"
};
function digitSvg(doc, ch) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 60 104");
  svg.setAttribute("class", "vault-lock-seg");
  svg.setAttribute("aria-hidden", "true");
  const lit = LIT[ch] ?? "";
  for (const [name, points] of Object.entries(SEGMENTS)) {
    const poly = doc.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points", points);
    if (lit.includes(name)) poly.setAttribute("class", "on");
    svg.append(poly);
  }
  return svg;
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
var FX_COLORS = {
  retro: ["#ff3df2", "#20e6ff", "#ffe94a", "#7cff4f"],
  cartoon: ["#ffd93b", "#ff4d4d", "#2f9bff", "#ffffff"]
};
var clamp = (n, min, max) => Math.min(max, Math.max(min, n));
var rnd2 = (min, max) => min + Math.random() * (max - min);
function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
var OverlayView = class {
  constructor(doc, t, handlers) {
    this.doc = doc;
    this.t = t;
    this.handlers = handlers;
    this.inerted = /* @__PURE__ */ new Set();
    this.deniedTimer = 0;
    this.fx = null;
    this.theme = "default";
    this.lastParts = "";
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
    const revealHint = el("div", "vault-lock-reveal-hint");
    revealHint.setAttribute("aria-hidden", "true");
    const revealText = el("span", "vault-lock-reveal-text");
    revealText.textContent = t.pressAnyKey;
    revealHint.append(revealText);
    form.append(input, button, revealHint);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handlers.submit(input.value);
    });
    const message = this.message = el("div", "vault-lock-message");
    message.setAttribute("aria-live", "polite");
    this.hint = el("div", "vault-lock-hint");
    this.hint.textContent = t.previewClose;
    card.append(icon, title, form, message, this.hint);
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
    stage.append(this.clockEl, card, this.todosEl);
    root.append(this.bg, this.anim, stage);
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.classList.contains("is-preview")) handlers.closePreview();
      e.stopPropagation();
      if (root.classList.contains("hover-reveal") && !root.classList.contains("is-preview") && !root.classList.contains("is-cover") && doc.activeElement !== input && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        input.focus({ preventScroll: true });
      }
    });
    card.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || !root.classList.contains("hover-reveal")) return;
      if (!e.target.closest(".vault-lock-form")) input.focus({ preventScroll: true });
    });
    root.addEventListener("click", (e) => {
      if (!root.classList.contains("is-preview")) return;
      if (e.composedPath().includes(this.todosEl)) return;
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
    const body = this.doc.body;
    if (!this.root.isConnected) body.append(this.root);
    this.enforce();
    this.observer.observe(body, { childList: true });
    this.onViewport?.();
  }
  enforce() {
    const body = this.doc.body;
    if (!this.root.isConnected) body.append(this.root);
    for (const child of Array.from(body.children)) {
      if (child === this.root || this.inerted.has(child)) continue;
      if (child.inert) continue;
      child.inert = true;
      this.inerted.add(child);
    }
  }
  /** Success feedback: the padlock opens and the text says so; the caller removes the overlay shortly after. */
  setUnlocking() {
    this.root.classList.add("is-unlocking");
    this.input.disabled = true;
    this.button.disabled = true;
    (0, import_obsidian2.setIcon)(this.iconEl, "lock-open");
    if (!this.iconEl.querySelector("svg")) (0, import_obsidian2.setIcon)(this.iconEl, "unlock");
    this.titleEl.textContent = this.t.unlocked;
    this.button.textContent = "\u2713";
  }
  /** Wrong password: the card shakes once. */
  setDenied() {
    const r = this.root;
    r.classList.remove("is-denied");
    void r.offsetWidth;
    r.classList.add("is-denied");
    this.win.clearTimeout(this.deniedTimer);
    this.deniedTimer = this.win.setTimeout(() => r.classList.remove("is-denied"), 500);
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
    this.root.classList.remove("is-denied", "is-unlocking");
    if (this.iconEl.querySelector("svg") && this.root.isConnected) (0, import_obsidian2.setIcon)(this.iconEl, "lock");
    this.fx?.destroy();
    this.fx = null;
    this.clearVideo();
    this.observer.disconnect();
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
    this.doc.removeEventListener("visibilitychange", this.onVis);
    const vv = this.win.visualViewport;
    if (vv && this.onViewport) {
      vv.removeEventListener("resize", this.onViewport);
      vv.removeEventListener("scroll", this.onViewport);
    }
  }
  setMode(mode) {
    const cover = mode === "cover";
    const preview = mode === "preview";
    this.root.classList.toggle("is-cover", cover);
    this.root.classList.toggle("is-preview", preview);
    this.input.disabled = cover || preview;
    this.button.disabled = cover || preview;
  }
  /** Apply the cosmetic settings: background, animation, text, clock, layout and widgets. */
  applyAppearance(a, todos) {
    this.setImage(a.imageUrl);
    this.setVideo(a.videoUrl);
    const r = this.root;
    this.theme = a.theme;
    r.classList.toggle("vl-theme-retro", a.theme === "retro");
    r.classList.toggle("vl-theme-cartoon", a.theme === "cartoon");
    r.classList.toggle("hover-reveal", a.hoverReveal);
    r.classList.toggle("title-auto", a.titleMode === "auto");
    r.classList.toggle("title-hide", a.titleMode === "hide");
    r.classList.toggle("custom-title", a.customTitle !== "");
    r.classList.toggle("no-icon", !a.showIcon);
    r.classList.toggle("pos-top", a.position === "top");
    r.classList.toggle("pos-bottom", a.position === "bottom");
    r.classList.toggle("shape-round", a.fieldShape === "rounded");
    r.classList.toggle("shape-pill", a.fieldShape === "pill");
    r.classList.toggle("shape-square", a.fieldShape === "square");
    this.titleEl.textContent = a.customTitle || this.t.lockedTitle;
    const setVar = (name, value) => value ? r.style.setProperty(name, value) : r.style.removeProperty(name);
    setVar("--vl-text", a.textColor);
    setVar("--vl-accent", a.accentColor);
    r.style.setProperty("--vl-clock-scale", String(clamp(a.clockScale, 60, 160) / 100));
    if (a.clockFont === "auto") {
      r.style.removeProperty("--vl-clock-weight");
      r.style.removeProperty("--vl-clock-font");
    } else {
      r.style.setProperty("--vl-clock-weight", String(clamp(a.clockWeight, 100, 700)));
      r.style.setProperty("--vl-clock-font", FONT_STACKS[a.clockFont]);
    }
    r.style.setProperty("--vl-blur", `${clamp(a.blur, 0, 20)}px`);
    this.userDim = clamp(a.dim, 0, 80) / 100;
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
    this.lastTime = this.lastDate = this.lastParts = "";
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
      if (!reduced) void this.video.play().catch(() => void 0);
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
    v.autoplay = !reduced;
    v.preload = "auto";
    v.controls = false;
    v.disablePictureInPicture = true;
    v.setAttribute("aria-hidden", "true");
    v.addEventListener("loadeddata", () => {
      if (this.videoUrl !== url) return;
      this.videoAutoDim = this.legibilityDim(v);
      this.videoLoaded = true;
      this.updateMedia();
      if (!reduced) void v.play().catch(() => void 0);
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
        const palette4 = a.theme === "default" ? [...colors, colors[0]] : FX_COLORS[a.theme];
        this.fx = new PointerFx(this.doc, this.win, this.anim, a.animation, a.theme, palette4);
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
    const f = (n) => n.toFixed(1);
    if (a.animation === "aurora") {
      for (let i = 0; i < 4; i++) {
        add("b", {
          "--c": colors[i % 3],
          "--x": `${f(rnd2(5, 95))}%`,
          "--y": `${f(rnd2(5, 95))}%`,
          "--s": `${f(rnd2(60, 90))}vmax`,
          "--dx": `${f(rnd2(-24, 24))}vmax`,
          "--dy": `${f(rnd2(-18, 18))}vmax`,
          "--d": `${f(rnd2(22, 38))}s`,
          "--delay": `-${f(rnd2(0, 30))}s`
        });
      }
    } else if (a.animation === "fireflies") {
      const n = clamp(Math.round(area / 52e3), 10, 30);
      for (let i = 0; i < n; i++) {
        const s = rnd2(3, 7);
        add("i", {
          "--c": colors[i % 3],
          "--x": `${f(rnd2(2, 98))}%`,
          "--y": `${f(rnd2(4, 96))}%`,
          "--s": `${f(s)}px`,
          "--x1": `${f(rnd2(-16, 16))}vmin`,
          "--y1": `${f(rnd2(-16, 16))}vmin`,
          "--x2": `${f(rnd2(-20, 20))}vmin`,
          "--y2": `${f(rnd2(-20, 20))}vmin`,
          "--x3": `${f(rnd2(-16, 16))}vmin`,
          "--y3": `${f(rnd2(-16, 16))}vmin`,
          "--d": `${f(rnd2(18, 34))}s`,
          "--p": `${f(rnd2(2.8, 6))}s`,
          "--delay": `-${f(rnd2(0, 30))}s`
        });
      }
    } else if (a.animation === "snow") {
      const n = clamp(Math.round(area / 36e3), 14, 48);
      for (let i = 0; i < n; i++) {
        add("i", {
          "--x": `${f(rnd2(0, 100))}%`,
          "--s": `${f(rnd2(2, 6))}px`,
          "--o": f(rnd2(0.35, 0.9)),
          "--sway": `${f(rnd2(-40, 40))}px`,
          "--d": `${f(rnd2(9, 20))}s`,
          "--delay": `-${f(rnd2(0, 20))}s`
        });
      }
    }
  }
  updateClock(now) {
    if (!this.timeFmt || !this.dateFmt) return;
    const time = this.timeFmt.format(now);
    if (time !== this.lastTime) {
      this.lastTime = time;
      if (this.theme === "retro") this.renderSegmentClock(now);
      else this.timeEl.textContent = time;
    }
    const date = this.dateFmt.format(now);
    if (date !== this.lastDate) {
      this.lastDate = date;
      this.dateEl.textContent = date;
    }
  }
  /** Retro theme: digits as seven-segment SVGs, the colon blinks, am/pm (any language) stays small text. */
  renderSegmentClock(now) {
    const parts = this.timeFmt?.formatToParts(now) ?? [];
    const key = parts.map((p) => p.type + p.value).join("|");
    if (key === this.lastParts) return;
    this.lastParts = key;
    const doc = this.doc;
    const nodes = [];
    for (const part of parts) {
      if (part.type === "hour" || part.type === "minute" || part.type === "second") {
        for (const ch of part.value) nodes.push(digitSvg(doc, ch));
      } else if (part.type === "dayPeriod") {
        const span = doc.createElement("span");
        span.className = "vault-lock-period";
        span.textContent = part.value;
        nodes.push(span);
      } else if (part.type === "literal" && part.value.includes(":")) {
        const colon = doc.createElement("span");
        colon.className = "vault-lock-colon";
        colon.setAttribute("aria-hidden", "true");
        nodes.push(colon);
      }
    }
    this.timeEl.replaceChildren(...nodes);
    this.timeEl.setAttribute("aria-label", this.lastTime);
    this.timeEl.setAttribute("role", "text");
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
    this.button.textContent = busy ? this.t.checking : this.t.unlock;
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
    this.views = /* @__PURE__ */ new Map();
    this.countdown = null;
    this.clockTimer = null;
    this.busy = false;
    this.unlockTimer = 0;
  }
  get isLocked() {
    return this.mode === "locked";
  }
  get isCovering() {
    return this.mode === "cover";
  }
  get isPreviewing() {
    return this.mode === "preview";
  }
  /** Hide content immediately without asking for a password (grace period running). */
  cover() {
    if (this.mode === "locked") return;
    this.mode = "cover";
    this.render();
  }
  lock() {
    this.mode = "locked";
    this.notifyWindow(true);
    this.render();
    this.startCountdown();
    const preferInput = !this.hooks.getAppearance().hoverReveal;
    window.setTimeout(() => this.focusActive(preferInput), 50);
  }
  /** Show the lock screen without locking, so appearance settings can be judged. Click/Esc closes it. */
  preview() {
    if (this.mode === "locked") return;
    this.mode = "preview";
    this.notifyWindow(true);
    this.render();
    window.setTimeout(() => {
      if (this.mode !== "preview") return;
      for (const v of this.views.values()) if (v.doc.hasFocus()) v.focusRoot();
    }, 50);
  }
  release() {
    window.clearTimeout(this.unlockTimer);
    this.mode = "off";
    this.stopCountdown();
    this.stopClock();
    for (const view of this.views.values()) view.detach();
    this.notifyWindow(false);
  }
  destroy() {
    window.clearTimeout(this.unlockTimer);
    const wasShowing = this.mode !== "off";
    this.mode = "off";
    if (wasShowing) this.notifyWindow(false);
    this.stopCountdown();
    this.stopClock();
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
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
          submit: (pw) => void this.handleSubmit(pw),
          closePreview: () => {
            if (this.mode === "preview") this.release();
          },
          addTodo: (text) => this.editTodos((list) => {
            if (list.length < MAX_TODOS) list.push({ id: newId(), text: text.slice(0, MAX_TODO_LENGTH), done: false });
          }),
          toggleTodo: (id) => this.editTodos((list) => {
            const item = list.find((x) => x.id === id);
            if (item) item.done = !item.done;
          }),
          deleteTodo: (id) => this.editTodos((list) => {
            const i = list.findIndex((x) => x.id === id);
            if (i >= 0) list.splice(i, 1);
          })
        });
        this.views.set(doc, view);
      }
      view.applyAppearance(appearance, todos);
      view.attach();
      view.setMode(this.mode);
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
  async handleSubmit(password) {
    if (this.busy || this.mode !== "locked") return;
    this.busy = true;
    this.eachView((v) => v.setBusy(true));
    let result;
    try {
      result = await this.hooks.submit(password);
    } catch {
      result = { ok: false, message: this.t.cryptoError };
    }
    if (result.ok) {
      this.stopCountdown();
      this.eachView((v) => v.setUnlocking());
      const wait = this.prefersReducedMotion() ? 0 : UNLOCK_MS;
      this.unlockTimer = window.setTimeout(() => {
        this.busy = false;
        this.release();
        this.hooks.onUnlocked();
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
    const tick = () => {
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
      tick();
      this.countdown = window.setInterval(tick, 1e3);
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
  lockOnStartup: true,
  idleMinutes: 10,
  lockOnHide: true,
  graceSeconds: 30,
  failCount: 0,
  retryAt: 0,
  theme: "default",
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
  savedWindow: null
};
var IDLE_CHOICES = [0, 1, 5, 10, 15, 30, 60];
var GRACE_CHOICES = [0, 15, 30, 60, 300];
var THEMES = ["default", "retro", "cartoon"];
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
    const text = r.text.trim().slice(0, MAX_TODO_LENGTH);
    if (!text) continue;
    out.push({ id: r.id, text, done: r.done === true });
  }
  return out;
}
var VaultLockPlugin = class extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULTS };
    this.t = getStrings();
    this.lastActivity = Date.now();
    this.hiddenAt = null;
  }
  get hasPassword() {
    return this.settings.credential !== null;
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
    this.t = getStrings();
    this.lockScreen = new LockScreen(this.t, {
      submit: (pw) => this.attemptUnlock(pw),
      getRetryAt: () => this.settings.retryAt,
      getDocuments: () => this.collectDocuments(),
      getAppearance: () => this.appearance(),
      getTodos: () => this.settings.todos,
      setTodos: (todos) => {
        this.settings.todos = todos;
        void this.saveSettings();
      },
      onWindow: (active) => this.applyWindow(active),
      onUnlocked: () => this.markActivity()
    });
    if (this.hasPassword && this.settings.lockOnStartup) this.lockScreen.lock();
    else if (this.settings.savedWindow) this.applyWindow(false);
    this.addSettingTab(new VaultLockSettingTab(this.app, this));
    this.addCommand({ id: "lock-now", name: this.t.lockNow, callback: () => this.lockNow() });
    this.addRibbonIcon("lock", this.t.lockNow, () => this.lockNow());
    this.watchActivity(window);
    this.registerEvent(
      this.app.workspace.on("window-open", (_w, win) => {
        this.watchActivity(win);
        this.lockScreen.refresh();
      })
    );
    this.registerEvent(this.app.workspace.on("window-close", () => this.lockScreen.refresh()));
    this.registerInterval(window.setInterval(() => this.checkIdle(), 5e3));
    this.registerDomEvent(document, "visibilitychange", () => this.onVisibility());
  }
  onunload() {
    this.lockScreen?.destroy();
  }
  lockNow() {
    if (!this.hasPassword) {
      new import_obsidian3.Notice(this.t.noPassword);
      return;
    }
    this.lockScreen.lock();
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
      theme: s.theme,
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
      locale: detectTag()
    };
  }
  // ---- unlock / rate limiting ---------------------------------------------------------
  async attemptUnlock(password) {
    const now = Date.now();
    const cred = this.settings.credential;
    if (!cred) return { ok: true };
    if (now < this.settings.retryAt) {
      return { ok: false, message: fmt(this.t.wait, Math.ceil((this.settings.retryAt - now) / 1e3)), retryAt: this.settings.retryAt };
    }
    if (!cryptoAvailable()) return { ok: false, message: this.t.cryptoError };
    let ok = false;
    try {
      ok = await verifyPassword(password, cred);
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
    if (Date.now() - this.lastActivity >= idleMinutes * 6e4) this.lockScreen.lock();
  }
  onVisibility() {
    if (!this.hasPassword || !this.settings.lockOnHide) return;
    if (document.visibilityState === "hidden") {
      if (this.lockScreen.isLocked) return;
      this.hiddenAt = Date.now();
      if (this.settings.graceSeconds === 0) this.lockScreen.lock();
      else this.lockScreen.cover();
      return;
    }
    if (this.hiddenAt === null) return;
    const away = Date.now() - this.hiddenAt;
    this.hiddenAt = null;
    if (this.lockScreen.isLocked) return;
    if (away >= this.settings.graceSeconds * 1e3) this.lockScreen.lock();
    else {
      this.lockScreen.release();
      this.markActivity();
    }
  }
  collectDocuments() {
    const docs = /* @__PURE__ */ new Set([document]);
    this.app.workspace.iterateAllLeaves((leaf) => {
      const doc = leaf.view?.containerEl?.ownerDocument;
      if (doc) docs.add(doc);
    });
    return Array.from(docs);
  }
  // ---- settings I/O -------------------------------------------------------------------
  async loadSettings() {
    const raw = await this.loadData() ?? {};
    const v1 = typeof raw.settingsVersion !== "number" || raw.settingsVersion < 2;
    const legacyFont = v1 && raw.clockFont === "sans" && (raw.clockWeight === void 0 || raw.clockWeight === 300);
    const legacyShape = v1 && raw.fieldShape === "rounded";
    this.settings = {
      settingsVersion: 2,
      theme: oneOf(raw.theme, THEMES, DEFAULTS.theme),
      credential: isCredential(raw.credential) ? raw.credential : null,
      lockOnStartup: bool(raw.lockOnStartup, DEFAULTS.lockOnStartup),
      idleMinutes: num(raw.idleMinutes, DEFAULTS.idleMinutes, 0, 24 * 60),
      lockOnHide: bool(raw.lockOnHide, DEFAULTS.lockOnHide),
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
      customTitle: typeof raw.customTitle === "string" ? raw.customTitle.trim().slice(0, 60) : "",
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
      savedWindow: isSavedWindow(raw.savedWindow) ? raw.savedWindow : null
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
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
    this.displayAppearance(containerEl, t, s, save);
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
    const slide = (name, min, max, step, get, set) => {
      return new import_obsidian3.Setting(containerEl).setName(name).addSlider(
        (c) => c.setLimits(min, max, step).setValue(get()).setDynamicTooltip().onChange(async (v) => {
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
      { default: t.themeDefault, retro: t.themeRetro, cartoon: t.themeCartoon },
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
      (c) => c.setPlaceholder(t.lockedTitle).setValue(s.customTitle).onChange(async (v) => {
        s.customTitle = v.trim().slice(0, 60);
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
  }
  onOpen() {
    const t = this.plugin.t;
    const { contentEl } = this;
    contentEl.empty();
    this.setTitle(this.mode === "set" ? t.modalSet : this.mode === "change" ? t.modalChange : t.modalRemove);
    const field = (name, set) => new import_obsidian3.Setting(contentEl).setName(name).addText((c) => {
      c.inputEl.type = "password";
      c.inputEl.autocomplete = "off";
      c.onChange(set);
    });
    if (this.mode !== "set") field(t.current, (v) => this.current = v);
    if (this.mode !== "remove") {
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
    this.contentEl.empty();
  }
  async submit() {
    const t = this.plugin.t;
    if (!cryptoAvailable()) {
      new import_obsidian3.Notice(t.cryptoError);
      return;
    }
    if (this.mode !== "set") {
      const res = await this.plugin.attemptUnlock(this.current);
      if (!res.ok) {
        new import_obsidian3.Notice(res.message);
        return;
      }
    }
    if (this.mode === "remove") {
      this.plugin.settings.credential = null;
      await this.plugin.saveSettings();
      new import_obsidian3.Notice(t.removed);
    } else {
      if (this.next.length < MIN_PASSWORD_LENGTH) {
        new import_obsidian3.Notice(fmt(t.tooShort, MIN_PASSWORD_LENGTH));
        return;
      }
      if (this.next !== this.confirm) {
        new import_obsidian3.Notice(t.mismatch);
        return;
      }
      this.plugin.settings.credential = await createCredential(this.next);
      this.plugin.settings.failCount = 0;
      this.plugin.settings.retryAt = 0;
      await this.plugin.saveSettings();
      new import_obsidian3.Notice(t.saved);
    }
    this.close();
    this.onDone();
  }
};
