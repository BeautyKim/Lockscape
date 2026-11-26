import { LockScreen } from "../../src/lockscreen";
import { getStrings } from "../../src/i18n";

const q = new URLSearchParams(location.search);
const lang = q.get("lang") ?? "ko";
const theme = q.get("theme") ?? "light";
const state = q.get("state") ?? "locked"; // locked | error | wait | cover | preview
document.body.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
document.documentElement.lang = lang;

const app = document.createElement("div");
app.className = "app-container";
app.innerHTML = "<h1>SECRET NOTE TITLE</h1>" + "<p>confidential content line</p>".repeat(30);
document.body.append(app);

let todos = q.get("todos") === "1" ? [
  { id: "1", text: q.get("long") === "1" ? "A very long to-do item that keeps going to test wrapping inside the panel without breaking layout at all" : "Review quarterly report", done: false },
  { id: "2", text: "Email design team", done: true },
  { id: "3", text: "회의록 정리", done: false },
] : [];
// todos=N (2 or more) fills the list with N items
if (Number(q.get("todos")) > 1) todos = Array.from({ length: Number(q.get("todos")) }, (_, i) => ({ id: String(i), text: `할 일 ${i + 1}`, done: i % 4 === 1 }));
const retryAt = state === "wait" ? Date.now() + 90_000 : 0;
const ls = new LockScreen(getStrings(lang), {
  submit: async () => ({ ok: false, message: getStrings(lang).wrong }),
  getRetryAt: () => retryAt,
  getDocuments: () => [document],
  getAppearance: () => ({
    theme: (q.get("vl") ?? "default") as any,
    highScores: { snake: Number(q.get("hs") ?? 0), breakout: Number(q.get("hs") ?? 0), runner: Number(q.get("hs") ?? 0) },
    imageUrl: q.get("image") ? `img-${q.get("image")}.jpg` : null,
    videoUrl: q.get("video") ? `${q.get("video")}.mp4` : null,
    dim: Number(q.get("dim") ?? 35), blur: Number(q.get("blur") ?? 0),
    animation: (q.get("anim") ?? "none") as any,
    showClock: q.get("clock") !== "0", showSeconds: q.get("sec") === "1", showDate: q.get("date") !== "0",
    clockFormat: (q.get("fmt") ?? "auto") as any, showTodos: q.get("todos") === "empty" || Number(q.get("todos")) > 0, hoverReveal: q.get("reveal") === "1",
    titleMode: (q.get("title") ?? "auto") as any, customTitle: q.get("custom") ?? "", showIcon: q.get("icon") !== "0",
    position: (q.get("pos") ?? "center") as any, fieldShape: (q.get("shape") ?? "auto") as any,
    clockScale: Number(q.get("scale") ?? 100), clockFont: (q.get("font") ?? "auto") as any, clockWeight: Number(q.get("weight") ?? 300),
    textColor: q.get("text") ? "#" + q.get("text") : "", accentColor: q.get("accent") ? "#" + q.get("accent") : "",
    locale: lang,
    hasRecovery: q.get("recovery") === "1",
  }),
  getTodos: () => todos,
  setTodos: (t) => { todos = t; },
  onWindow() {},
  onUnlocked() {},
  onHighScore(game, score) { (window as any).__scores = { ...((window as any).__scores ?? {}), [game]: score }; },
  onLock() {},
  keymap: { pushScope() {}, popScope() {} },
});
if (state === "cover") ls.cover(); else if (state === "preview") ls.preview(); else ls.lock();
if (state === "error") {
  document.querySelector<HTMLInputElement>(".vault-lock-input")!.value = "x";
  document.querySelector<HTMLFormElement>(".vault-lock-form")!.requestSubmit();
}
(window as any).__ls = ls;
