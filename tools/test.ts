import { createCredential, verifyPassword, isCredential, generateRecoveryKey, normalizeRecoveryKey, looksLikeRecoveryKey, createRecoveryCredential, verifyRecoveryKey, RECOVERY_KEY_LENGTH } from "../src/crypto";
import { LOCALES, resolveLocale, getStrings, fmt } from "../src/i18n";
import en from "../src/i18n/en";
import { charCount, clipChars } from "../src/text";
import { LOCK_CLOSED, LOCK_OPEN } from "../src/pixelicons";
import * as snake from "../src/games/snake";
import { runGameTests } from "./test-games";
import { contrastRatio, inkFor } from "../src/color";
import { LOG_LIMIT, appendLog, mergeLogs, parseLog } from "../src/activitylog";
import { DEVICE_KEYS, applyDevice, pickDevice } from "../src/devicesettings";
import { THEMES, THEME_TEXT, emptyHighScores, gameOf, mergeHighScores, parseHighScores, parseTheme } from "../src/themes";

let fail = 0;
const check = (name: string, ok: boolean) => { console.log((ok ? "PASS " : "FAIL ") + name); if (!ok) fail++; };

(async () => {
  const t0 = Date.now();
  const cred = await createCredential("correct horse battery");
  console.log("hash time ms:", Date.now() - t0);
  check("credential shape valid", isCredential(cred));
  check("correct password verifies", await verifyPassword("correct horse battery", cred));
  check("wrong password rejected", !(await verifyPassword("wrong", cred)));
  check("a 4-character password hashes and verifies", await verifyPassword("1357", await createCredential("1357")));
  check("salt differs per credential", (await createCredential("x" + "y".repeat(8))).salt !== cred.salt);
  // Korean: NFC vs NFD (macOS vs Windows input) must match
  const ko = "비밀번호테스트1234";
  const kc = await createCredential(ko.normalize("NFC"));
  check("Korean NFD == NFC", await verifyPassword(ko.normalize("NFD"), kc));
  check("tampered iter rejected", !isCredential({ ...cred, iter: 1 }));
  check("tampered iter too large rejected", !isCredential({ ...cred, iter: 1e12 }));
  check("garbage rejected", !isCredential("x") && !isCredential(null) && !isCredential({}));

  // recovery key
  {
    const k = generateRecoveryKey();
    check("recovery key: six groups of four from the safe alphabet", /^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/.test(k));
    check("recovery key: 24 symbols after normalising", normalizeRecoveryKey(k).length === RECOVERY_KEY_LENGTH && looksLikeRecoveryKey(k));
    check("recovery key: keys differ and use the whole alphabet", (() => { const seen = new Set<string>(); for (let i = 0; i < 400; i++) for (const c of normalizeRecoveryKey(generateRecoveryKey())) seen.add(c); return generateRecoveryKey() !== generateRecoveryKey() && seen.size === 32; })());
    const rc = await createRecoveryCredential(k);
    check("recovery key: credential shape valid", isCredential(rc));
    check("recovery key: verifies as shown", await verifyRecoveryKey(k, rc));
    check("recovery key: lower case, spaces and no dashes verify too", await verifyRecoveryKey(k.toLowerCase().replace(/-/g, " "), rc) && await verifyRecoveryKey(k.replace(/-/g, ""), rc));
    check("recovery key: a wrong key, a short key and the password are rejected", !(await verifyRecoveryKey("AAAA-AAAA-AAAA-AAAA-AAAA-AAAA", rc)) && !(await verifyRecoveryKey(k.slice(0, 20), rc)) && !(await verifyRecoveryKey("correct horse battery", rc)));
    check("recovery key: misread characters are mapped (O to 0, I and L to 1)", normalizeRecoveryKey("oOiIlL") === "001111");
    check("recovery key: it does not unlock as a password hash of itself with other text", !(await verifyPassword(k + "x", rc)));
  }

  // text length: code points, never half an emoji
  check("charCount counts an emoji as one", charCount("😀😀😀😀") === 4 && "😀😀😀😀".length === 8);
  check("charCount: 7 Korean syllables are 7 characters", charCount("가나다라마바사".normalize("NFKC")) === 7);
  check("clipChars leaves a short string alone", clipChars("abc", 5) === "abc");
  check("clipChars cuts ASCII at the limit", clipChars("abcdef", 4) === "abcd");
  check("clipChars never splits a surrogate pair", clipChars("a😀b😀c", 3) === "a😀b" && !/[\uD800-\uDBFF]$/.test(clipChars("😀😀😀", 2)));
  check("clipChars: 60 emoji stay 60 characters", charCount(clipChars("😀".repeat(100), 60)) === 60);

  // themes
  check("six themes", THEMES.length === 6 && THEMES[0] === "default");
  check("parseTheme keeps a known theme", parseTheme("win95") === "win95" && parseTheme("folder-runner") === "folder-runner");
  check("parseTheme moves the old runner id to the new one", parseTheme("obsidian-runner") === "folder-runner");
  check("parseTheme: retro/cartoon from older versions become default", parseTheme("retro") === "default" && parseTheme("cartoon") === "default");
  check("parseTheme: junk becomes default", parseTheme(undefined) === "default" && parseTheme(7) === "default" && parseTheme({}) === "default" && parseTheme("__proto__") === "default");
  check("three game themes", THEMES.filter((t) => gameOf(t) !== null).length === 3 && gameOf("gameboy-snake") === "snake" && gameOf("neon-breakout") === "breakout" && gameOf("folder-runner") === "runner" && gameOf("terminal") === null);
  check("every theme has a text spec", THEMES.every((t) => t in THEME_TEXT));
  check("parseHighScores: valid", JSON.stringify(parseHighScores({ snake: 12, breakout: 340, runner: 5 })) === JSON.stringify({ snake: 12, breakout: 340, runner: 5 }));
  check("parseHighScores: negative, NaN, strings, floats, huge", JSON.stringify(parseHighScores({ snake: -5, breakout: "9", runner: 1e12 })) === JSON.stringify({ snake: 0, breakout: 0, runner: 999999 }) && parseHighScores({ snake: NaN }).snake === 0 && parseHighScores({ snake: 7.9 }).snake === 7);
  check("parseHighScores: not an object", JSON.stringify(parseHighScores(null)) === JSON.stringify(emptyHighScores()) && JSON.stringify(parseHighScores("x")) === JSON.stringify(emptyHighScores()) && JSON.stringify(parseHighScores([1, 2])) === JSON.stringify(emptyHighScores()));
  check("mergeHighScores takes the better score per game", JSON.stringify(mergeHighScores({ snake: 5, breakout: 90, runner: 0 }, { snake: 9, breakout: 10, runner: 3 })) === JSON.stringify({ snake: 9, breakout: 90, runner: 3 }));
  // pixel padlock bitmaps
  const widths = (rows: readonly string[]) => new Set(rows.map((r) => r.length));
  check("padlock bitmaps: every row the same width", widths(LOCK_CLOSED).size === 1 && widths(LOCK_OPEN).size === 1 && [...widths(LOCK_CLOSED)][0] === [...widths(LOCK_OPEN)][0]);
  check("padlock bitmaps: same height, only known characters", LOCK_CLOSED.length === LOCK_OPEN.length && [...LOCK_CLOSED, ...LOCK_OPEN].every((r) => /^[.osfk]+$/.test(r)));

  // snake rules
  {
    const rng0 = () => 0;
    const mk = (cols: number, rows: number, body: [number, number][], dir: snake.Dir, food: [number, number] | null): snake.SnakeState => {
      const st = snake.newGame(cols, rows, rng0);
      st.snake = body.map(([x, y]) => ({ x, y }));
      st.dir = dir;
      st.food = food ? { x: food[0], y: food[1] } : null;
      st.status = "running";
      return st;
    };
    const g = snake.newGame(18, 18, rng0);
    check("snake: starts idle, 3 long, heading right", g.status === "idle" && g.snake.length === 3 && g.dir === "right" && g.snake[0].x > g.snake[1].x && g.snake[0].y === g.snake[1].y);
    check("snake: first food is not on the snake", g.food !== null && !g.snake.some((p) => p.x === g.food!.x && p.y === g.food!.y));
    check("snake: nothing moves before the round starts", snake.step(g, rng0) === "moved" && g.snake[0].x === 9);
    snake.start(g);
    check("snake: start() begins the round", g.status === "running");
    const head0 = { ...g.snake[0] };
    snake.step(g, rng0);
    check("snake: a step moves the head one cell and keeps the length", g.snake[0].x === head0.x + 1 && g.snake.length === 3);
    const t = mk(10, 10, [[5, 5], [4, 5], [3, 5]], "right", [0, 0]);
    snake.turn(t, "left");
    check("snake: turning straight back is ignored", t.queue.length === 0);
    snake.turn(t, "right");
    check("snake: repeating the current direction is ignored", t.queue.length === 0);
    snake.turn(t, "up");
    snake.turn(t, "left");
    snake.turn(t, "down");
    check("snake: a quick U-turn takes two queued turns, the queue holds two", JSON.stringify(t.queue) === JSON.stringify(["up", "left"]));
    snake.step(t, rng0);
    snake.step(t, rng0);
    check("snake: the queued turns are used one per step", t.dir === "left" && t.snake[0].x === 4 && t.snake[0].y === 4 && t.status === "running");
    const e = mk(10, 10, [[5, 5], [4, 5], [3, 5]], "right", [6, 5]);
    const r = snake.step(e, rng0);
    check("snake: eating grows the snake, scores, and puts new food on a free cell", r === "ate" && e.snake.length === 4 && e.score === 1 && e.food !== null && !e.snake.some((p) => p.x === e.food!.x && p.y === e.food!.y));
    const w = mk(10, 10, [[9, 5], [8, 5], [7, 5]], "right", [0, 0]);
    check("snake: the wall ends the round", snake.step(w, rng0) === "died" && w.status === "over");
    const wt = mk(10, 10, [[0, 0], [1, 0], [2, 0]], "left", [5, 5]);
    check("snake: every wall counts (left edge)", snake.step(wt, rng0) === "died");
    // a coil: the head runs into its own body
    const c = mk(10, 10, [[5, 5], [5, 6], [4, 6], [4, 5], [4, 4], [5, 4]], "up", [0, 0]);
    snake.turn(c, "left");
    check("snake: running into its own body ends the round", snake.step(c, rng0) === "died");
    // 2x2 loop: the head follows into the cell the tail is leaving
    const f = mk(10, 10, [[5, 5], [5, 6], [4, 6], [4, 5]], "up", [0, 0]);
    snake.turn(f, "left");
    check("snake: moving into the cell the tail leaves is not a crash", snake.step(f, rng0) === "moved" && f.status === "running");
    const full = mk(2, 2, [[0, 0], [0, 1], [1, 1]], "up", [1, 0]);
    snake.turn(full, "right");
    check("snake: filling the board wins", snake.step(full, rng0) === "won" && full.status === "won" && full.food === null);
    check("snake: placeFood on a full board is null", snake.placeFood(mk(2, 2, [[0, 0], [1, 0], [0, 1], [1, 1]], "up", null), rng0) === null);
    const tk = mk(10, 10, [[5, 5], [4, 5], [3, 5]], "right", [0, 0]);
    snake.tick(tk, 1 / snake.speedFor(0) + 0.001, rng0);
    check("snake: tick takes one step per interval", tk.snake[0].x === 6);
    snake.tick(tk, 3 / snake.speedFor(0) + 0.001, rng0);
    check("snake: a long frame takes several steps, not one", tk.snake[0].x === 9 || tk.status === "over");
    const over = mk(10, 10, [[9, 5], [8, 5], [7, 5]], "right", [0, 0]);
    snake.tick(over, 5, rng0);
    check("snake: tick stops after the crash", over.status === "over" && over.snake[0].x === 9);
    check("snake: speed rises with the score and is capped", snake.speedFor(0) === 7 && snake.speedFor(5) > snake.speedFor(1) && snake.speedFor(500) === 14);
    const rngSeq = (() => { let i = 0; return () => [0.1, 0.9, 0.5][i++ % 3]; })();
    const a = snake.newGame(18, 18, rngSeq), b = snake.newGame(18, 18, (() => { let i = 0; return () => [0.1, 0.9, 0.5][i++ % 3]; })());
    check("snake: the same random numbers give the same food", JSON.stringify(a.food) === JSON.stringify(b.food));
  }

  // activity log: only well-formed entries survive, capped, merged without duplicates
  check("log: garbage is dropped", parseLog("x").length === 0 && parseLog([null, 3, { t: "1", k: "lock" }, { t: 1, k: "boom" }, { t: -5, k: "fail" }, { t: NaN, k: "fail" }]).length === 0);
  check("log: valid entries kept, unknown reason dropped", (() => { const l = parseLog([{ t: 5, k: "lock", r: "idle" }, { t: 6, k: "lock", r: "evil" }, { t: 7, k: "unlock", r: "idle" }]); return l.length === 3 && l[0].r === "idle" && l[1].r === undefined && l[2].r === undefined; })());
  check("log: append and parse cap at the limit, newest kept", (() => { let l = [] as ReturnType<typeof parseLog>; for (let i = 0; i < LOG_LIMIT + 7; i++) l = appendLog(l, { t: i, k: "fail" }); const p = parseLog(l.concat([{ t: 999, k: "fail" }])); return l.length === LOG_LIMIT && l[0].t === 7 && p.length === LOG_LIMIT && p[p.length - 1].t === 999; })());
  check("log: merge sorts by time and drops exact duplicates", (() => { const m = mergeLogs([{ t: 3, k: "fail" }, { t: 1, k: "lock", r: "idle" }], [{ t: 3, k: "fail" }, { t: 2, k: "unlock" }]); return m.map((e) => e.t).join() === "1,2,3"; })());

  check("log: the recover kind is kept", parseLog([{ t: 5, k: "recover" }]).length === 1);

  // per-device settings: only the listed keys move, and only from a well-formed object
  check("device: pickDevice copies exactly the device keys", (() => { const p = pickDevice({ idleMinutes: 5, theme: "win95", lockOnHide: false }); return Object.keys(p).sort().join() === [...DEVICE_KEYS].sort().join() && p.idleMinutes === 5 && p.theme === undefined; })());
  check("device: applyDevice overlays device keys only", (() => { const o = applyDevice({ idleMinutes: 10, theme: "default" }, { idleMinutes: 1, theme: "evil", credential: "x" }); return o.idleMinutes === 1 && o.theme === "default" && !("credential" in o); })());
  check("device: applyDevice ignores non-objects", applyDevice({ idleMinutes: 10 }, null).idleMinutes === 10 && applyDevice({ idleMinutes: 10 }, "x").idleMinutes === 10);

  runGameTests(check);

  // readable text on a chosen accent colour
  check("inkFor: white on the default purple and on dark colours", inkFor([139, 92, 246]) === "#ffffff" && inkFor([0, 0, 0]) === "#ffffff" && inkFor([20, 40, 120]) === "#ffffff");
  check("inkFor: near-black on bright colours (neon green, yellow, white)", inkFor([0, 255, 102]) === "#111111" && inkFor([255, 230, 0]) === "#111111" && inkFor([255, 255, 255]) === "#111111");
  check("inkFor: over the colour cube the ink reaches 4.5:1 on 96%+ of colours and never drops under 4.2:1", (() => { let worst = 99, under = 0, n = 0; for (let r = 0; r <= 255; r += 5) for (let g = 0; g <= 255; g += 5) for (let b = 0; b <= 255; b += 5) { const c: [number, number, number] = [r, g, b]; const ink: [number, number, number] = inkFor(c) === "#ffffff" ? [255, 255, 255] : [17, 17, 17]; const v = contrastRatio(ink, c); worst = Math.min(worst, v); if (v < 4.5) under++; n++; } return worst >= 4.19 && under / n < 0.04; })() && Math.abs(contrastRatio([255, 255, 255], [0, 0, 0]) - 21) < 1e-9);

  // i18n
  const cases: [string, string][] = [["ko","ko"],["ko_KR","ko"],["en-US","en"],["ja","ja"],["zh","zh"],["zh-CN","zh"],["zh-TW","zh-tw"],["zh-Hant-HK","zh-tw"],["pt-BR","pt"],["pt","pt"],["es-MX","es"],["fr-CA","fr"],["de-AT","de"],["ru","ru"],["ar","en"],["",  "en"]];
  for (const [i, o] of cases) check(`resolveLocale(${JSON.stringify(i)}) = ${o}`, resolveLocale(i) === o);
  const keys = Object.keys(en).sort().join();
  for (const [code, s] of Object.entries(LOCALES)) {
    check(`${code}: all keys, none empty`, Object.keys(s).sort().join() === keys && Object.values(s).every(v => typeof v === "string" && v.length > 0));
  }
  for (const k of ["wait","minutes","seconds","tooShort"] as const)
    for (const [code, s] of Object.entries(LOCALES)) check(`${code}.${k} has {n}`, s[k].includes("{n}"));
  check("fmt", fmt(getStrings("ko").wait, 7) === "7초 후에 다시 시도하세요.");
  console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
  process.exit(fail ? 1 : 0);
})();
