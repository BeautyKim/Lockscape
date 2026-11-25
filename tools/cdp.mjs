// usage: node cdp.mjs <port> eval '<js expr>' | shot <file.png> [w h]
import fs from "node:fs";
const [port, cmd, arg, w, h] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const want = process.env.TITLE;
const page = want ? list.find((t) => t.type === "page" && t.title.includes(want)) : list.find((t) => t.type === "page" && t.url.startsWith("app://obsidian.md"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
if (cmd === "eval") {
  const r = await send("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r, null, 2));
} else if (cmd === "move") {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: +arg, y: +w });
  console.log("moved", arg, w);
} else if (cmd === "path") {
  // path "x,y;x,y;..." with delay ms between mouse moves (arg2 = w holds the delay)
  const pts = arg.split(";").map((p) => p.split(",").map(Number));
  for (const [x, y] of pts) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await new Promise((r) => setTimeout(r, +w || 16)); }
  console.log("path done", pts.length);
} else if (cmd === "key") {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: arg, text: arg });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: arg });
  console.log("typed", arg);
} else if (cmd === "shot") {
  if (w && h) { await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 2, mobile: false }); await new Promise((r) => setTimeout(r, 600)); }
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(arg, Buffer.from(r.result.data, "base64"));
  if (w && h) await send("Emulation.clearDeviceMetricsOverride");
  console.log("saved", arg);
}
ws.close(); process.exit(0);
