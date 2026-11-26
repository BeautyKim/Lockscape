// A one-button runner in the spirit of the offline browser dinosaur: a small folder-headed pixel character runs
// along a flat ground and jumps spikes and locked folders. Rules are plain data + functions (no DOM) so they can
// be tested; RunnerGame at the bottom turns them into a Game for the host.

import { PAUSED_LINES, type Game } from "./game";
import { bitmapSize, drawBitmap, type Bitmap } from "./pixels";

export type Status = "idle" | "running" | "over";
export type Rng = () => number;
export type ObstacleKind = "spikes" | "folder";

export interface Obstacle {
	x: number; // left edge
	kind: ObstacleKind;
	count: number; // spikes come in groups of 1-3
	w: number;
	h: number;
}

export interface Cloud {
	x: number;
	y: number;
}

export interface RunnerState {
	status: Status;
	y: number; // height above the ground, px (0 = running)
	vy: number; // upwards is positive
	speed: number; // px/s
	dist: number; // px run so far
	t: number; // seconds into the round (legs)
	untilNext: number; // px of running left before the next obstacle appears
	obstacles: Obstacle[];
	clouds: Cloud[];
}

// ---- sprites ----------------------------------------------------------------------------------
// g folder tab / shade, f folder face, p paper, k eyes, s body, l legs, o lock outline, y lock body, c cloud

const HEAD: Bitmap = [
	".gggggg.......",
	".gggggg.......",
	".pppppppppppp.",
	".ffffffffffff.",
	".ffkffffffkff.",
	".ffffffffffff.",
	".gggggggggggg.",
];
const BODY: Bitmap = [
	"....ssssss....",
	"...ssssssss...",
	"..ssssssssss..",
	"...ssssssss...",
	"...ssssssss...",
];
export const RUN_A: Bitmap = [...HEAD, ...BODY, "...ll....ll...", "...ll....ll...", "...ll.........", "..lll........."];
export const RUN_B: Bitmap = [...HEAD, ...BODY, "...ll....ll...", "...ll....ll...", ".........ll...", ".........lll.."];
export const JUMP: Bitmap = [...HEAD, ...BODY, "...ll....ll...", "...ll....ll...", "..lll....lll..", ".............."];

export const SPIKE: Bitmap = ["...s...", "...s...", "..sss..", "..sss..", ".sssss.", ".sssss.", "sssssss", "sssssss"];
export const LOCKED_FOLDER: Bitmap = [
	".gggg.......",
	"ffffffffffff",
	"ffffooooffff",
	"ffffoffoffff",
	"fffoooooofff",
	"fffoyyyyofff",
	"fffoyyyyofff",
	"fffoooooofff",
	"ffffffffffff",
	"gggggggggggg",
];
export const CLOUD: Bitmap = [
	"......ccc...........",
	"....ccccccc...ccc...",
	"..ccccccccccccccccc.",
	"ccccccccccccccccccc.",
	".cccccccccccccccccc.",
];

export const PALETTE = {
	g: "#9ca3af",
	f: "#e5e7eb",
	p: "#ffffff",
	k: "#1f2937",
	s: "#6b7280",
	l: "#e0925c",
	o: "#1f2937",
	y: "#d9ad5f",
	c: "#62636a",
} as const;
const SPIKE_PALETTE = { s: "#b4b9c2" } as const;

// ---- rules ------------------------------------------------------------------------------------

export const W = 320;
export const H = 160;
export const GROUND_Y = 130;
export const S = 2; // sprite scale
export const CHAR_X = 36;
export const CHAR_W = bitmapSize(RUN_A).w * S; // 28
export const CHAR_H = bitmapSize(RUN_A).h * S; // 32
export const GRAVITY = 1650;
export const JUMP_V = 440;
export const START_SPEED = 150;
export const MAX_SPEED = 340;
export const ACCEL = 5; // px/s per second

const CLOUD_TOP = 22; // clouds stay in this band: above the jump and clear of the messages
const CLOUD_SPAN = 24;

/** The character's collision box is smaller than its sprite: a graze is not a hit. */
const HIT = { left: 6, right: 6, top: 5 };
const OBSTACLE_INSET = 3;

export function newGame(rng: Rng): RunnerState {
	return {
		status: "idle",
		y: 0,
		vy: 0,
		speed: START_SPEED,
		dist: 0,
		t: 0,
		untilNext: 240,
		obstacles: [],
		clouds: [0, 1, 2].map((i) => ({ x: 20 + i * 115 + rng() * 40, y: CLOUD_TOP + rng() * CLOUD_SPAN })),
	};
}

export function start(s: RunnerState): void {
	if (s.status === "idle") s.status = "running";
}

export const onGround = (s: RunnerState) => s.y === 0;

export function jump(s: RunnerState): void {
	if (s.status !== "running" || !onGround(s)) return;
	s.vy = JUMP_V;
}

export const scoreOf = (s: RunnerState) => Math.floor(s.dist / 10);

/** Px between one obstacle and the next. Always more than a jump covers plus a moment to react. */
export function gapFor(speed: number, rng: Rng): number {
	return 0.7 * speed + 80 + rng() * 160;
}

export function spawnObstacle(rng: Rng): Obstacle {
	if (rng() < 0.35) {
		const b = bitmapSize(LOCKED_FOLDER);
		return { x: W + 4, kind: "folder", count: 1, w: b.w * S, h: b.h * S };
	}
	const count = 1 + Math.min(2, Math.floor(rng() * 3));
	const b = bitmapSize(SPIKE);
	return { x: W + 4, kind: "spikes", count, w: b.w * S * count, h: b.h * S };
}

/** The character's box and an obstacle's box overlap. */
export function hits(s: RunnerState, o: Obstacle): boolean {
	const cl = CHAR_X + HIT.left;
	const cr = CHAR_X + CHAR_W - HIT.right;
	const cb = GROUND_Y - s.y; // feet
	const ct = cb - CHAR_H + HIT.top;
	const ol = o.x + OBSTACLE_INSET;
	const or = o.x + o.w - OBSTACLE_INSET;
	const ot = GROUND_Y - o.h + 2;
	return cr > ol && cl < or && cb > ot && ct < GROUND_Y;
}

export function tick(s: RunnerState, dt: number, rng: Rng): void {
	if (s.status !== "running") return;
	s.t += dt;
	s.speed = Math.min(MAX_SPEED, START_SPEED + ACCEL * s.t);
	const run = s.speed * dt;
	s.dist += run;

	// the jump
	if (s.y > 0 || s.vy > 0) {
		s.vy -= GRAVITY * dt;
		s.y += s.vy * dt;
		if (s.y <= 0) {
			s.y = 0;
			s.vy = 0;
		}
	}

	// obstacles scroll left and new ones arrive on the right
	for (const o of s.obstacles) o.x -= run;
	s.obstacles = s.obstacles.filter((o) => o.x + o.w > 0);
	s.untilNext -= run;
	if (s.untilNext <= 0) {
		const o = spawnObstacle(rng);
		s.obstacles.push(o);
		s.untilNext = o.w + gapFor(s.speed, rng);
	}

	// clouds drift slower than the ground
	for (const c of s.clouds) {
		c.x -= run * 0.2;
		if (c.x < -CLOUD[0].length * S) {
			c.x = W + rng() * 60;
			c.y = CLOUD_TOP + rng() * CLOUD_SPAN;
		}
	}

	if (s.obstacles.some((o) => hits(s, o))) s.status = "over";
}

// ---- the Game for the host --------------------------------------------------------------------

const BG = "#2a2a2d";
const GROUND = "#6b7280";
const TEXT = "#d1d5db";
const TEXT_DIM = "#8b9099";
const FONT = "bold 11px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const pad5 = (n: number) => String(Math.min(n, 99999)).padStart(5, "0");

/** A stable pseudo-random number for a tile of ground, so the specks scroll without flickering. */
function hash(n: number): number {
	return Math.imul(n ^ 0x9e3779b9, 2654435761) >>> 0;
}

export class RunnerGame implements Game {
	readonly id = "runner" as const;
	readonly width = W;
	readonly height = H;
	private s: RunnerState;
	private best = 0;

	constructor(private readonly rng: Rng = Math.random) {
		this.s = newGame(rng);
	}

	get running(): boolean {
		return this.s.status === "running";
	}
	get score(): number {
		return scoreOf(this.s);
	}
	setHighScore(score: number): void {
		this.best = score;
	}
	reset(): void {
		this.s = newGame(this.rng);
	}
	update(dt: number): void {
		tick(this.s, dt, this.rng);
	}

	key(code: string, down: boolean): boolean {
		if (code !== "Space" && code !== "ArrowUp" && code !== "KeyW") return false;
		if (down) this.primary();
		return true;
	}

	pointerDown(): boolean {
		this.primary();
		return true;
	}

	/** Space, Up or a tap: start, jump, or start over. */
	private primary(): void {
		if (this.s.status === "over") this.s = newGame(this.rng);
		if (this.s.status === "idle") start(this.s);
		jump(this.s);
	}

	draw(ctx: CanvasRenderingContext2D, paused: boolean): void {
		const s = this.s;
		ctx.fillStyle = BG;
		ctx.fillRect(0, 0, W, H);

		for (const c of s.clouds) drawBitmap(ctx, CLOUD, PALETTE, c.x, c.y, S);

		// ground: a line and a few specks that scroll with the run
		ctx.fillStyle = GROUND;
		ctx.fillRect(0, GROUND_Y, W, 1);
		const off = Math.floor(s.dist);
		for (let x = -(off % 8); x < W; x += 8) {
			const h = hash(Math.floor((x + off) / 8));
			if (h % 3 !== 0) continue;
			ctx.fillRect(x, GROUND_Y + 5 + ((h >>> 8) % 3) * 6, 2 + ((h >>> 4) % 5), 1);
		}

		for (const o of s.obstacles) {
			if (o.kind === "folder") drawBitmap(ctx, LOCKED_FOLDER, PALETTE, o.x, GROUND_Y - o.h, S);
			else for (let i = 0; i < o.count; i++) drawBitmap(ctx, SPIKE, SPIKE_PALETTE, o.x + i * SPIKE[0].length * S, GROUND_Y - o.h, S);
		}

		// the character: legs alternate while running, one pose in the air
		const frame = s.y > 0 ? JUMP : Math.floor(s.t / 0.09) % 2 === 0 ? RUN_A : RUN_B;
		drawBitmap(ctx, s.status === "over" ? JUMP : frame, PALETTE, CHAR_X, GROUND_Y - s.y - CHAR_H, S);

		// score, the browser way: HI <best> <now>
		ctx.font = FONT;
		ctx.textBaseline = "middle";
		ctx.textAlign = "right";
		ctx.fillStyle = TEXT;
		ctx.fillText(pad5(this.score), W - 8, 12);
		ctx.fillStyle = TEXT_DIM;
		ctx.fillText(`HI ${pad5(Math.max(this.best, this.score))}`, W - 8 - 5 * 7 - 10, 12);

		const msg = paused ? PAUSED_LINES : s.status === "idle" ? ["PRESS SPACE", "OR UP ARROW"] : s.status === "over" ? ["GAME OVER", "SPACE TO RETRY"] : null;
		if (msg) {
			ctx.textAlign = "center";
			ctx.fillStyle = TEXT;
			ctx.font = "bold 12px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
			ctx.fillText(msg[0], W / 2, 70);
			ctx.fillStyle = TEXT_DIM;
			ctx.font = "10px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
			ctx.fillText(msg[1], W / 2, 86);
		}
	}
}
