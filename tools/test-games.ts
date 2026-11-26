// Tests for the offline games: the rules of breakout and the runner, the pixel sprites, and the GameHost
// (keyboard / focus rules and cleanup) against a small fake DOM, so no browser is needed.

import * as breakout from "../src/games/breakout";
import * as runner from "../src/games/runner";
import { bitmapProblems } from "../src/games/pixels";
import { GameHost, isControl } from "../src/games/host";
import { SnakeGame } from "../src/games/snake";
import { createGame } from "../src/games";
import { GAME_IDS } from "../src/themes";
import { glyphProblems, isPixelChar, pixelWidth, runsOf } from "../src/pixeltext";
import { DESKTOP_ICONS, PALETTE as ICON_PALETTE } from "../src/desktopicons";

type Check = (name: string, ok: boolean) => void;

// ---- a tiny fake DOM -------------------------------------------------------------------------

/** An event target that counts the listeners still attached (an aborted signal or removeEventListener detaches one). */
class Target extends EventTarget {
	private entries: { type: string; fn: EventListenerOrEventListenerObject | null; signal?: AbortSignal }[] = [];
	get live(): number {
		return this.entries.length;
	}
	override addEventListener(type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions): void {
		super.addEventListener(type, fn, opts);
		const signal = typeof opts === "object" ? opts.signal : undefined;
		this.entries.push({ type, fn, signal });
		signal?.addEventListener("abort", () => void (this.entries = this.entries.filter((e) => e.signal !== signal)));
	}
	override removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions): void {
		super.removeEventListener(type, fn, opts);
		this.entries = this.entries.filter((e) => !(e.type === type && e.fn === fn));
	}
}

class FakeDoc extends Target {
	hidden = false;
	activeElement: FakeEl | null = null;
	createElement(tag: string): FakeEl {
		return new FakeEl(tag.toUpperCase(), this);
	}
}

class FakeEl extends Target {
	className = "";
	style: Record<string, unknown> = { setProperty(k: string, v: string) { this[k] = v; } };
	width = 0;
	height = 0;
	children: FakeEl[] = [];
	removed = false;
	disabled = false;
	constructor(
		readonly tagName: string,
		private readonly doc: FakeDoc,
		private readonly focusRoot?: FakeEl,
	) {
		super();
	}
	setAttribute(): void {}
	getContext(): unknown {
		return new Proxy({}, { get: () => () => undefined, set: () => true });
	}
	getBoundingClientRect() {
		return { left: 0, top: 0, width: this.width || 100, height: this.height || 100 };
	}
	replaceChildren(...c: FakeEl[]): void {
		this.children = c;
	}
	remove(): void {
		this.removed = true;
	}
	focus(): void {
		if (this.doc.activeElement === this) return;
		const was = this.doc.activeElement;
		this.doc.activeElement = this;
		if (was) this.focusRoot?.dispatchEvent(new Event("focusout"));
		this.focusRoot?.dispatchEvent(new Event("focusin"));
	}
	blur(): void {
		if (this.doc.activeElement !== this) return;
		this.doc.activeElement = null;
		this.focusRoot?.dispatchEvent(new Event("focusout"));
	}
}

class FakeWin {
	devicePixelRatio = 1;
	private nextId = 1;
	frames = new Map<number, (t: number) => void>();
	timers = new Map<number, () => void>();
	requestAnimationFrame(cb: (t: number) => void): number {
		const id = this.nextId++;
		this.frames.set(id, cb);
		return id;
	}
	cancelAnimationFrame(id: number): void {
		this.frames.delete(id);
	}
	setTimeout(cb: () => void): number {
		const id = this.nextId++;
		this.timers.set(id, cb);
		return id;
	}
	clearTimeout(id: number): void {
		this.timers.delete(id);
	}
	/** Run the animation frames that are waiting, as if the screen painted at time t. */
	paint(t: number): void {
		const due = [...this.frames];
		this.frames.clear();
		for (const [, cb] of due) cb(t);
	}
	/** Run the zero-delay timers that are waiting. */
	settle(): void {
		const due = [...this.timers];
		this.timers.clear();
		for (const [, cb] of due) cb();
	}
}

function key(type: "keydown" | "keyup", code: string, extra: Record<string, unknown> = {}): Event {
	return Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false }, extra);
}

function rig(game = new SnakeGame(() => 0), highScore = 0, focusFieldResult = true) {
	const doc = new FakeDoc();
	const win = new FakeWin();
	const root = new FakeEl("DIV", doc);
	const mount = new FakeEl("DIV", doc);
	const input = new FakeEl("INPUT", doc, root);
	const rootFocus = new FakeEl("DIV", doc, root); // stands for the overlay root having focus
	root.focus = () => rootFocus.focus();
	const saved: number[] = [];
	let focusFieldCalls = 0;
	const host = new GameHost(game, {
		doc: doc as unknown as Document,
		win: win as unknown as Window,
		mount: mount as unknown as HTMLElement,
		root: root as unknown as HTMLElement,
		highScore,
		onHighScore: (s) => void saved.push(s),
		focusField: () => {
			focusFieldCalls++;
			if (focusFieldResult) input.focus();
			return focusFieldResult;
		},
	});
	const canvas = mount.children[0];
	return { doc, win, root, mount, input, rootFocus, host, game, saved, canvas, calls: () => focusFieldCalls };
}

export function runGameTests(check: Check): void {
	const rng0 = () => 0;

	// ---- sprites -----------------------------------------------------------------------------
	const sprites: [string, readonly string[]][] = [
		["RUN_A", runner.RUN_A],
		["RUN_B", runner.RUN_B],
		["JUMP", runner.JUMP],
		["SPIKE", runner.SPIKE],
		["LOCKED_FOLDER", runner.LOCKED_FOLDER],
		["CLOUD", runner.CLOUD],
	];
	for (const [name, rows] of sprites) check(`runner sprite ${name}: even rows, known colours`, bitmapProblems(rows, { ...runner.PALETTE, s: "#fff" }).length === 0);
	check("runner: the three character poses are the same size", [runner.RUN_B, runner.JUMP].every((p) => p.length === runner.RUN_A.length && p[0].length === runner.RUN_A[0].length));
	check("runner: bitmapProblems catches a ragged row and an unknown colour", bitmapProblems(["ab", "a"], { a: "#000" }).length === 2);

	// ---- pixel clock digits (Windows 95) -------------------------------------------------------
	check("pixeltext: every digit and the colon is 7 rows of equal width", glyphProblems().length === 0 && "0123456789:".split("").every(isPixelChar));
	check("pixeltext: only digits and colons are drawn", !isPixelChar("오") && !isPixelChar("P") && !isPixelChar(" "));
	check("pixeltext: Korean time splits into text and pixels", JSON.stringify(runsOf("오후 4:33")) === JSON.stringify([{ pixel: false, text: "오후 " }, { pixel: true, text: "4:33" }]));
	check("pixeltext: English time splits the other way round", JSON.stringify(runsOf("4:33 PM")) === JSON.stringify([{ pixel: true, text: "4:33" }, { pixel: false, text: " PM" }]));
	check("pixeltext: 24h time with seconds is one pixel run", JSON.stringify(runsOf("16:33:05")) === JSON.stringify([{ pixel: true, text: "16:33:05" }]) && runsOf("").length === 0);
	check("pixeltext: width = glyphs + one column between", pixelWidth("4:33") === 5 + 1 + 5 + 5 + 3 && pixelWidth("") === 0);

	// ---- Windows 95 desktop icons --------------------------------------------------------------
	check("desktop icons: My Computer, My Documents, Internet and Recycle Bin", DESKTOP_ICONS.map((i) => i.label).join() === "My Computer,My Documents,Internet,Recycle Bin");
	check("desktop icons: every bitmap is 16x16 with known colours", DESKTOP_ICONS.every((i) => i.rows.length === 16 && bitmapProblems(i.rows, ICON_PALETTE).length === 0 && i.rows.every((r) => r.length === 16)));
	check("desktop icons: ids are unique and every icon draws something", new Set(DESKTOP_ICONS.map((i) => i.id)).size === DESKTOP_ICONS.length && DESKTOP_ICONS.every((i) => i.rows.some((r) => /[^.]/.test(r))));

	// ---- the game factory --------------------------------------------------------------------
	for (const id of GAME_IDS) {
		const g = createGame(id);
		check(`createGame(${id}): matching id, a size, starts idle`, g.id === id && g.width > 0 && g.height > 0 && !g.running && g.score === 0);
	}

	// ---- breakout rules ----------------------------------------------------------------------
	{
		const b = breakout.makeBricks();
		check("breakout: a full wall of 8 x 5 bricks", b.length === breakout.COLS * breakout.ROWS);
		check("breakout: every brick is inside the field and none overlap", b.every((k) => k.x >= 0 && k.x + breakout.BRICK_W <= breakout.W && k.y > breakout.HUD) && new Set(b.map((k) => `${k.x},${k.y}`)).size === b.length);

		const s = breakout.newGame();
		check("breakout: starts ready with the ball on the paddle and 3 lives", s.status === "ready" && s.lives === 3 && s.ball.y === s.paddle.y - s.ball.r && s.ball.x === s.paddle.x);
		breakout.movePaddleTo(s, 9999);
		check("breakout: the paddle stays inside the field", s.paddle.x === breakout.W - s.paddle.w / 2);
		breakout.movePaddleTo(s, -50);
		check("breakout: ... on the left too, and the waiting ball rides along", s.paddle.x === s.paddle.w / 2 && s.ball.x === s.paddle.x);

		const l = breakout.newGame();
		breakout.launch(l, rng0);
		check("breakout: launch sends the ball up at the level's speed", l.status === "running" && l.ball.vy < 0 && Math.abs(Math.hypot(l.ball.vx, l.ball.vy) - breakout.ballSpeed(1)) < 1e-9);
		const keep = { ...l.ball };
		breakout.launch(l, rng0);
		check("breakout: launching twice does nothing", l.ball.vx === keep.vx && l.ball.vy === keep.vy);

		const w = breakout.newGame();
		w.status = "running";
		Object.assign(w.ball, { x: 3, y: 150, vx: -100, vy: -60 });
		breakout.tick(w, 0.05, 0);
		check("breakout: the side wall turns the ball back", w.ball.vx > 0 && w.ball.x >= w.ball.r);

		const c = breakout.newGame();
		c.status = "running";
		Object.assign(c.ball, { x: 140, y: breakout.HUD + 6, vx: 0, vy: -200 });
		c.bricks = c.bricks.slice(0, 0).concat([{ x: 0, y: 200, row: 0 }]); // out of the way
		breakout.tick(c, 0.05, 0);
		check("breakout: the ceiling turns the ball back", c.ball.vy > 0 && c.ball.y >= breakout.HUD + c.ball.r);

		// a paddle hit: the centre sends the ball straight up, the right edge sideways to the right
		const hit = (offsetPx: number) => {
			const p = breakout.newGame();
			p.status = "running";
			p.paddle.x = 140;
			Object.assign(p.ball, { x: 140 + offsetPx, y: p.paddle.y - 8, vx: 0, vy: 200 });
			p.bricks = [{ x: 0, y: 40, row: 0 }];
			breakout.tick(p, 0.05, 0);
			return p;
		};
		const centre = hit(0);
		const right = hit(24);
		const left = hit(-24);
		check("breakout: a centre hit leans a little, so a rally cannot go straight up and down forever", Math.abs(centre.ball.vx) > 20 && Math.abs(centre.ball.vx) < 50 && centre.ball.vy < -190);
		check("breakout: a right-edge hit goes right, a left-edge hit goes left", right.ball.vx > 50 && left.ball.vx < -50 && right.ball.vy < 0 && left.ball.vy < 0);
		check("breakout: a paddle hit keeps the ball's speed", Math.abs(Math.hypot(right.ball.vx, right.ball.vy) - 200) < 1e-6);

		// a brick from below: gone, +10, and the ball turns back down
		const br = breakout.newGame();
		br.status = "running";
		const k = br.bricks[br.bricks.length - 1]; // bottom row
		Object.assign(br.ball, { x: k.x + 10, y: k.y + breakout.BRICK_H + 10, vx: 0, vy: -150 });
		breakout.tick(br, 0.1, 0);
		check("breakout: a brick breaks, scores 10 and turns the ball down", !br.bricks.includes(k) && br.score === 10 && br.ball.vy > 0);

		// the fastest frame the host allows must not let the ball through a row of bricks
		const fast = breakout.newGame();
		fast.status = "running";
		Object.assign(fast.ball, { x: fast.bricks[3].x + 10, y: 250, vx: 0, vy: -breakout.ballSpeed(10) });
		const before = fast.bricks.length;
		for (let i = 0; i < 12 && fast.bricks.length === before; i++) breakout.tick(fast, 0.05, 0);
		check("breakout: a fast ball never tunnels through a brick", fast.bricks.length === before - 1 && fast.ball.y > breakout.HUD);

		// missing the ball
		const m = breakout.newGame();
		m.status = "running";
		Object.assign(m.ball, { x: 20, y: breakout.H - 3, vx: 0, vy: 150 });
		m.paddle.x = 250;
		breakout.tick(m, 0.2, 0);
		check("breakout: missing the ball costs a life and serves again", m.lives === 2 && m.status === "ready" && m.ball.y === m.paddle.y - m.ball.r);
		for (let i = 0; i < 2; i++) {
			m.status = "running";
			Object.assign(m.ball, { x: 20, y: breakout.H - 3, vx: 0, vy: 150 });
			breakout.tick(m, 0.2, 0);
		}
		check("breakout: the last life ends the game", m.lives === 0 && m.status === "over");
		const frozen = JSON.stringify(m);
		breakout.tick(m, 1, 1);
		check("breakout: nothing moves after game over", JSON.stringify(m) === frozen);

		// clearing the wall
		const n = breakout.newGame();
		n.status = "running";
		n.bricks = [{ x: 100, y: 60, row: 0 }];
		Object.assign(n.ball, { x: 110, y: 60 + breakout.BRICK_H + 6, vx: 0, vy: -150 });
		breakout.tick(n, 0.1, 0);
		check("breakout: clearing the wall starts the next level, faster, with a full wall", n.level === 2 && n.status === "ready" && n.bricks.length === 40 && breakout.ballSpeed(2) > breakout.ballSpeed(1));
		check("breakout: ball speed is capped", breakout.ballSpeed(1000) === 330);

		// held keys move the paddle while the ball is still on it
		const g = new breakout.BreakoutGame(rng0);
		check("breakout game: idle until a key or the pointer moves", !g.running);
		g.key("ArrowRight", true);
		check("breakout game: a held key makes the loop run so the paddle glides", g.running);
		const x0 = 140;
		g.update(0.1);
		check("breakout game: ... and moves it", g.running && g.score === 0);
		g.releaseKeys();
		check("breakout game: releaseKeys drops every held key", !g.running);
		g.key("Space", true);
		check("breakout game: Space launches", g.running);
		void x0;
	}

	// ---- runner rules ------------------------------------------------------------------------
	{
		const s = runner.newGame(rng0);
		check("runner: starts idle on the ground", s.status === "idle" && runner.onGround(s) && s.obstacles.length === 0);
		runner.jump(s);
		check("runner: cannot jump before the round starts", s.vy === 0);
		runner.start(s);
		runner.jump(s);
		check("runner: jump sets an upward speed", s.vy === runner.JUMP_V);

		// the apex and the landing, by running the physics in small steps
		let apex = 0;
		let frames = 0;
		s.obstacles = [];
		s.untilNext = 1e9;
		do {
			runner.tick(s, 1 / 60, rng0);
			apex = Math.max(apex, s.y);
			frames++;
		} while (s.y > 0 && frames < 200);
		check("runner: a jump peaks at ~55 px and lands in about half a second", apex > 50 && apex < 62 && frames > 28 && frames < 36 && runner.onGround(s));
		check("runner: the jump clears the tallest obstacle with room to spare", apex > runner.LOCKED_FOLDER.length * runner.S * 2);
		check("runner: the character stays small against the canvas (a fifth) with room above a jump", runner.CHAR_H / runner.H <= 0.2 && (runner.GROUND_Y - runner.CHAR_H - apex) / runner.H > 0.25);

		const j = runner.newGame(rng0);
		runner.start(j);
		runner.jump(j);
		runner.tick(j, 1 / 60, rng0);
		const vy = j.vy;
		runner.jump(j);
		check("runner: no double jump in the air", j.vy === vy);

		// obstacles
		const hitS = runner.newGame(rng0);
		hitS.status = "running";
		hitS.untilNext = 1e9;
		hitS.obstacles = [{ x: runner.CHAR_X + 6, kind: "spikes", count: 1, w: 14, h: 16 }];
		check("runner: running into a spike is a hit", runner.hits(hitS, hitS.obstacles[0]));
		hitS.y = 40;
		check("runner: ... but not while high above it", !runner.hits(hitS, hitS.obstacles[0]));
		const far: runner.Obstacle = { x: 250, kind: "folder", count: 1, w: 24, h: 20 };
		hitS.y = 0;
		check("runner: a far obstacle is not a hit", !runner.hits(hitS, far));
		const behind: runner.Obstacle = { x: runner.CHAR_X - 30, kind: "spikes", count: 1, w: 14, h: 16 };
		check("runner: one that has passed is not a hit", !runner.hits(hitS, behind));
		runner.tick(hitS, 0.01, rng0);
		check("runner: a hit ends the round", hitS.status === "over");
		const dist = hitS.dist;
		runner.tick(hitS, 1, rng0);
		check("runner: nothing moves after the hit", hitS.dist === dist);

		check("runner: speed rises with time and is capped", (() => {
			const r = runner.newGame(rng0);
			r.status = "running";
			r.untilNext = 1e12;
			runner.tick(r, 10, rng0);
			const mid = r.speed;
			runner.tick(r, 500, rng0);
			return mid > runner.START_SPEED && r.speed === runner.MAX_SPEED;
		})());
		check("runner: score is distance / 10", runner.scoreOf({ ...s, dist: 1234 }) === 123);

		// spawning: obstacles come in, scroll off, and the gap always leaves room to land and jump again
		const sp = runner.newGame(rng0);
		sp.status = "running";
		sp.y = 1000; // untouchable, to watch spawning only
		let spawned = 0;
		let last = -1;
		for (let i = 0; i < 1800 && spawned < 6; i++) {
			runner.tick(sp, 1 / 60, rng0);
			sp.y = 1000;
			sp.status = "running";
			if (sp.obstacles.length > 0 && sp.obstacles[sp.obstacles.length - 1].x > runner.W - 5 && sp.obstacles.length !== last) spawned++;
			last = sp.obstacles.length;
		}
		check("runner: obstacles keep arriving", spawned >= 4);
		for (const speed of [runner.START_SPEED, runner.MAX_SPEED]) {
			const airMax = 2 * (runner.JUMP_V / runner.GRAVITY) * speed; // distance covered by one jump
			check(`runner: at ${speed} px/s the smallest gap is not shorter than a jump's reach`, runner.gapFor(speed, rng0) > airMax * 0.5 + 40);
		}
		const kinds = new Set<string>();
		for (let i = 0; i < 50; i++) kinds.add(runner.spawnObstacle(() => (i % 10) / 10 + 0.01).kind);
		check("runner: both spikes and locked folders appear", kinds.has("spikes") && kinds.has("folder"));
		check("runner: spike groups are 1 to 3", [0, 0.4, 0.5, 0.9, 0.99].every((r) => { const c = runner.spawnObstacle(() => r === 0 ? 0.9 : r).count; return c >= 1 && c <= 3; }));

		// the Game wrapper
		const g = new runner.RunnerGame(rng0);
		check("runner game: Space starts and jumps", (g.key("Space", true), g.running));
		g.reset();
		check("runner game: only Space, Up and W are used", g.key("ArrowLeft", true) === false && g.key("ArrowUp", true) === true && g.key("KeyW", false) === true);
		check("runner game: a tap starts", (g.reset(), g.pointerDown(), g.running));
	}

	// ---- host: keyboard and focus rules ------------------------------------------------------
	{
		check("isControl: input, button, textarea, select", ["INPUT", "BUTTON", "TEXTAREA", "SELECT"].every((t) => isControl({ tagName: t } as Element)) && !isControl({ tagName: "DIV" } as Element) && !isControl(null));

		const r = rig();
		const keys: string[] = [];
		const orig = r.game.key.bind(r.game);
		r.game.key = (code, down) => (keys.push(`${code}:${down}`), orig(code, down));
		r.rootFocus.focus();
		check("host: not active yet, so keys are ignored", (r.root.dispatchEvent(key("keydown", "ArrowRight")), keys.length === 0));
		r.host.setActive(true);
		const ev = key("keydown", "ArrowRight");
		r.root.dispatchEvent(ev);
		check("host: an arrow reaches the game and is kept from scrolling the page", keys.join() === "ArrowRight:true" && ev.defaultPrevented);
		check("host: a running round asks for animation frames", r.win.frames.size === 1);
		r.win.paint(1000);
		r.win.paint(1016);
		check("host: the loop keeps going while the round runs", r.win.frames.size === 1 && r.game.running);

		// the password field takes the keyboard: PAUSED, loop stops, keys are not passed on
		keys.length = 0;
		r.input.focus();
		check("host: focusing the field stops the loop at once", r.win.frames.size === 0);
		const typed = key("keydown", "ArrowLeft");
		r.root.dispatchEvent(typed);
		const space = key("keydown", "Space");
		r.root.dispatchEvent(space);
		check("host: arrows and Space typed in the field never reach the game", keys.length === 0 && !typed.defaultPrevented && !space.defaultPrevented);

		// Escape gives the keyboard back
		const esc = key("keydown", "Escape");
		r.root.dispatchEvent(esc);
		check("host: Esc in the field blurs it, hands focus back and resumes the game", r.doc.activeElement === r.rootFocus && esc.defaultPrevented && r.win.frames.size === 1);
		keys.length = 0;
		r.root.dispatchEvent(key("keydown", "ArrowUp"));
		check("host: after Esc the arrows steer the game again", keys.join() === "ArrowUp:true");

		// Tab goes to the field
		const tab = key("keydown", "Tab");
		r.root.dispatchEvent(tab);
		check("host: Tab from the game moves focus to the password field", r.calls() === 1 && r.doc.activeElement === r.input && tab.defaultPrevented && r.win.frames.size === 0);
		r.root.dispatchEvent(key("keydown", "Escape"));

		// Tab when the field cannot take focus (preview, wait): the browser keeps its own Tab
		const r2 = rig(new SnakeGame(rng0), 0, false);
		r2.host.setActive(true);
		r2.rootFocus.focus();
		const tab2 = key("keydown", "Tab");
		r2.root.dispatchEvent(tab2);
		check("host: Tab is left alone when the field cannot take focus", r2.calls() === 1 && !tab2.defaultPrevented);
		r2.host.destroy();

		// modifier keys and IME composition belong to somebody else
		const r3 = rig();
		const k3: string[] = [];
		const o3 = r3.game.key.bind(r3.game);
		r3.game.key = (c, d) => (k3.push(c), o3(c, d));
		r3.host.setActive(true);
		r3.rootFocus.focus();
		r3.root.dispatchEvent(key("keydown", "ArrowRight", { metaKey: true }));
		r3.root.dispatchEvent(key("keydown", "ArrowRight", { ctrlKey: true }));
		r3.root.dispatchEvent(key("keydown", "ArrowRight", { isComposing: true }));
		check("host: Cmd/Ctrl combinations and IME keys are not game input", k3.length === 0);

		// key repeat must not start a round (hold Space through GAME OVER)
		r3.root.dispatchEvent(key("keydown", "Space", { repeat: true }));
		check("host: a repeated key does not start a round that is not running", !r3.game.running);
		r3.root.dispatchEvent(key("keydown", "Space"));
		check("host: the first press does", r3.game.running);
		r3.host.destroy();

		// the window being hidden pauses too
		const r4 = rig();
		r4.host.setActive(true);
		r4.rootFocus.focus();
		r4.root.dispatchEvent(key("keydown", "ArrowRight"));
		r4.doc.hidden = true;
		r4.doc.dispatchEvent(new Event("visibilitychange"));
		check("host: a hidden window stops the loop", r4.win.frames.size === 0);
		r4.doc.hidden = false;
		r4.doc.dispatchEvent(new Event("visibilitychange"));
		check("host: and coming back resumes it", r4.win.frames.size === 1);
		r4.host.destroy();

		// a click on the game takes the keyboard back from the field
		const r5 = rig();
		r5.host.setActive(true);
		r5.input.focus();
		r5.canvas.dispatchEvent(new Event("pointerdown", { cancelable: true }));
		check("host: clicking the game takes the keyboard from the field and starts it", r5.doc.activeElement === r5.rootFocus && r5.game.running);
		r5.host.destroy();
	}

	// ---- host: high score --------------------------------------------------------------------
	{
		const r = rig(new SnakeGame(rng0), 2);
		r.host.setActive(true);
		r.rootFocus.focus();
		r.root.dispatchEvent(key("keydown", "ArrowRight")); // start
		// feed it: the snake eats three apples by stepping the real rules, then hits the wall
		const g = r.game as SnakeGame;
		(g as unknown as { s: { score: number } }).s.score = 5;
		for (let i = 0; i < 400 && g.running; i++) r.win.paint(1000 + i * 40); // runs into the wall
		check("host: a round that ends with a new best reports it once", g.running === false && r.saved.length === 1 && r.saved[0] >= 5);

		const low = rig(new SnakeGame(rng0), 50);
		low.host.setActive(true);
		low.rootFocus.focus();
		low.root.dispatchEvent(key("keydown", "ArrowRight"));
		for (let i = 0; i < 400 && low.game.running; i++) low.win.paint(1000 + i * 40);
		check("host: a worse score than the best is not reported", low.saved.length === 0);

		// leaving mid-round with a new best still saves it
		const mid = rig(new SnakeGame(rng0), 0);
		mid.host.setActive(true);
		mid.rootFocus.focus();
		mid.root.dispatchEvent(key("keydown", "ArrowRight"));
		(mid.game as unknown as { s: { score: number } }).s.score = 7;
		mid.host.setActive(false);
		check("host: leaving mid-round saves a new best and resets the game", mid.saved.join() === "7" && mid.game.score === 0 && !mid.game.running && mid.win.frames.size === 0);
	}

	// ---- host: freeze (the unlock fade) ------------------------------------------------------
	{
		const r = rig();
		r.host.setActive(true);
		r.rootFocus.focus();
		r.root.dispatchEvent(key("keydown", "ArrowRight"));
		r.host.freeze();
		const k: string[] = [];
		const o = r.game.key.bind(r.game);
		r.game.key = (c, d) => (k.push(c), o(c, d));
		r.root.dispatchEvent(key("keydown", "ArrowLeft"));
		r.win.paint(5000);
		check("host: frozen means no loop, no input, but the canvas stays for the fade", r.win.frames.size === 0 && k.length === 0 && !r.canvas.removed);
		r.host.setActive(true);
		check("host: showing again after a freeze starts from the start screen", !r.game.running && r.game.score === 0);
		r.host.destroy();
	}

	// ---- host: cleanup -----------------------------------------------------------------------
	{
		const r = rig();
		const targets = [r.root, r.doc, r.canvas];
		check("host: registers its listeners", targets.every((t) => t.live > 0));
		r.host.setActive(true);
		r.rootFocus.focus();
		r.root.dispatchEvent(key("keydown", "ArrowRight"));
		r.input.focus(); // arms the zero-delay timer of focusout/focusin handling
		r.rootFocus.focus();
		r.root.dispatchEvent(key("keydown", "ArrowRight"));
		check("host: a frame and a timer are pending before destroy", r.win.frames.size === 1 && r.win.timers.size >= 1);
		r.host.destroy();
		check("host.destroy: every listener on root, document and canvas is gone", targets.every((t) => t.live === 0));
		check("host.destroy: no animation frame and no timer is left", r.win.frames.size === 0 && r.win.timers.size === 0);
		check("host.destroy: the canvas leaves the page", r.canvas.removed);
		const k: string[] = [];
		const o = r.game.key.bind(r.game);
		r.game.key = (c, d) => (k.push(c), o(c, d));
		r.root.dispatchEvent(key("keydown", "ArrowRight"));
		r.input.focus();
		r.win.settle();
		r.win.paint(9000);
		check("host.destroy: events afterwards do nothing and schedule nothing", k.length === 0 && r.win.frames.size === 0 && r.win.timers.size === 0);
		r.host.destroy();
		check("host.destroy: calling it twice is harmless", true);

		// the same for every game: create, run a moment, destroy, nothing left behind
		for (const id of GAME_IDS) {
			const q = rig(createGame(id));
			q.host.setActive(true);
			q.rootFocus.focus();
			for (const c of ["Space", "ArrowRight", "ArrowUp"]) q.root.dispatchEvent(key("keydown", c));
			q.win.paint(100);
			q.win.paint(116);
			q.host.destroy();
			check(`host.destroy (${id}): nothing left behind`, [q.root, q.doc, q.canvas].every((t) => t.live === 0) && q.win.frames.size === 0 && q.win.timers.size === 0);
		}
	}
}
