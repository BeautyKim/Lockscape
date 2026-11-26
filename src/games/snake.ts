// Snake in the four greens of a handheld LCD. The rules are plain data + functions (no DOM) so they can be tested;
// SnakeGame at the bottom turns them into a Game for the host.

import { PAUSED_LINES, type Game } from "./game";

export type Dir = "up" | "down" | "left" | "right";
export interface Pt {
	x: number;
	y: number;
}
export type Status = "idle" | "running" | "over" | "won";

export interface SnakeState {
	cols: number;
	rows: number;
	snake: Pt[]; // head first
	dir: Dir; // direction of the last step
	queue: Dir[]; // turns waiting for their step (a quick U-turn needs two)
	food: Pt | null;
	score: number;
	status: Status;
	acc: number; // seconds since the last step
}

export type Rng = () => number;

const DELTA: Record<Dir, Pt> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
const MAX_QUEUE = 2;

export function newGame(cols: number, rows: number, rng: Rng): SnakeState {
	const y = Math.floor(rows / 2);
	const x = Math.floor(cols / 2);
	const s: SnakeState = {
		cols,
		rows,
		snake: [
			{ x, y },
			{ x: x - 1, y },
			{ x: x - 2, y },
		],
		dir: "right",
		queue: [],
		food: null,
		score: 0,
		status: "idle",
		acc: 0,
	};
	s.food = placeFood(s, rng);
	return s;
}

export function start(s: SnakeState): void {
	if (s.status === "idle") s.status = "running";
}

/** Steps per second: starts calm and speeds up with every apple, up to a cap. */
export function speedFor(score: number): number {
	return Math.min(14, 7 + score * 0.3);
}

/** Queue a turn. A reversal (straight back into the neck) and a repeat of the last turn are ignored. */
export function turn(s: SnakeState, d: Dir): void {
	if (s.status !== "running") return;
	const last = s.queue.length > 0 ? s.queue[s.queue.length - 1] : s.dir;
	if (d === last || d === OPPOSITE[last]) return;
	if (s.queue.length < MAX_QUEUE) s.queue.push(d);
}

const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;
const onSnake = (s: SnakeState, p: Pt) => s.snake.some((q) => same(q, p));

/** A random empty cell, or null when the snake fills the board. */
export function placeFood(s: SnakeState, rng: Rng): Pt | null {
	const free: Pt[] = [];
	for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) if (!onSnake(s, { x, y })) free.push({ x, y });
	if (free.length === 0) return null;
	return free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
}

export type StepResult = "moved" | "ate" | "died" | "won";

/** One step of the snake. The tail moves away on the same step, so following your own tail is not a crash. */
export function step(s: SnakeState, rng: Rng): StepResult {
	if (s.status !== "running") return "moved";
	const next = s.queue.shift();
	if (next) s.dir = next;
	const d = DELTA[s.dir];
	const head = { x: s.snake[0].x + d.x, y: s.snake[0].y + d.y };
	if (head.x < 0 || head.y < 0 || head.x >= s.cols || head.y >= s.rows) return die(s);
	const eating = s.food !== null && same(head, s.food);
	const body = eating ? s.snake : s.snake.slice(0, -1); // the tail cell is free unless we grow
	if (body.some((q) => same(q, head))) return die(s);
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

function die(s: SnakeState): StepResult {
	s.status = "over";
	return "died";
}

/** Advance by dt seconds, taking as many steps as that time holds. */
export function tick(s: SnakeState, dt: number, rng: Rng): void {
	if (s.status !== "running") return;
	s.acc += dt;
	const interval = 1 / speedFor(s.score);
	while (s.acc >= interval && s.status === "running") {
		s.acc -= interval;
		step(s, rng);
	}
}

// ---- the Game for the host --------------------------------------------------------------------

export const LCD = { darkest: "#0F380F", dark: "#306230", light: "#8BAC0F", lightest: "#9BBC0F" } as const;

const COLS = 18;
const ROWS = 18;
const CELL = 12;
const WALL = 1; // wall ring, in cells
const HUD = 26;
const W = (COLS + 2 * WALL) * CELL;
const H = HUD + (ROWS + 2 * WALL) * CELL;

const KEYS: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

const pad2 = (n: number) => String(Math.min(n, 99)).padStart(2, "0");

export class SnakeGame implements Game {
	readonly id = "snake" as const;
	readonly width = W;
	readonly height = H;
	private s: SnakeState;
	private best = 0;
	private ptr: Pt | null = null; // where the last touch or click landed, in canvas px

	constructor(private readonly rng: Rng = Math.random) {
		this.s = newGame(COLS, ROWS, rng);
	}

	get running(): boolean {
		return this.s.status === "running";
	}
	get score(): number {
		return this.s.score;
	}
	setHighScore(score: number): void {
		this.best = score;
	}
	reset(): void {
		this.s = newGame(COLS, ROWS, this.rng);
	}
	update(dt: number): void {
		tick(this.s, dt, this.rng);
	}

	key(code: string, down: boolean): boolean {
		if (!down) return code in KEYS || code === "Space";
		const dir = KEYS[code];
		if (dir) {
			if (this.s.status === "idle") start(this.s); // an arrow also starts a round
			turn(this.s, dir);
			return true;
		}
		if (code === "Space") {
			if (this.s.status === "idle") start(this.s);
			else if (this.s.status === "over" || this.s.status === "won") {
				this.s = newGame(COLS, ROWS, this.rng);
				start(this.s);
			}
			return true;
		}
		return false;
	}

	pointer(x: number, y: number): void {
		this.ptr = { x, y };
	}

	/** Start or restart with a tap; while running, a tap steers toward the tapped side of the head (no keys on a phone). */
	pointerDown(): boolean {
		const s = this.s;
		if (s.status === "idle") start(s);
		else if (s.status === "over" || s.status === "won") {
			this.s = newGame(COLS, ROWS, this.rng);
			start(this.s);
		} else if (s.status === "running" && this.ptr) {
			const hx = WALL * CELL + s.snake[0].x * CELL + CELL / 2;
			const hy = HUD + WALL * CELL + s.snake[0].y * CELL + CELL / 2;
			const dx = this.ptr.x - hx;
			const dy = this.ptr.y - hy;
			turn(s, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
		}
		return true;
	}

	draw(ctx: CanvasRenderingContext2D, paused: boolean): void {
		const s = this.s;
		ctx.fillStyle = LCD.lightest;
		ctx.fillRect(0, 0, W, H);

		// HUD
		ctx.fillStyle = LCD.darkest;
		ctx.font = "bold 11px 'Courier New', ui-monospace, monospace";
		ctx.textBaseline = "middle";
		ctx.textAlign = "left";
		ctx.fillText(`SCORE ${pad2(s.score)}`, 6, HUD / 2);
		ctx.textAlign = "right";
		ctx.fillText(`HI-SCORE ${pad2(Math.max(this.best, s.score))}`, W - 6, HUD / 2);

		// wall ring: a brick pattern
		const top = HUD;
		for (let y = 0; y < ROWS + 2 * WALL; y++) {
			for (let x = 0; x < COLS + 2 * WALL; x++) {
				if (x >= WALL && x < COLS + WALL && y >= WALL && y < ROWS + WALL) continue;
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

		// field
		const fx = WALL * CELL;
		const fy = top + WALL * CELL;
		ctx.fillStyle = LCD.light;
		ctx.fillRect(fx, fy, COLS * CELL, ROWS * CELL);

		// food: a small apple
		if (s.food) {
			const cx = fx + s.food.x * CELL + CELL / 2;
			const cy = fy + s.food.y * CELL + CELL / 2 + 1;
			ctx.fillStyle = LCD.darkest;
			ctx.beginPath();
			ctx.arc(cx, cy, CELL / 2 - 2, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = LCD.dark;
			ctx.fillRect(cx, cy - CELL / 2 + 0, 2, 3); // stem
		}

		// snake
		s.snake.forEach((p, i) => {
			ctx.fillStyle = i === 0 ? LCD.darkest : LCD.dark;
			ctx.fillRect(fx + p.x * CELL + 1, fy + p.y * CELL + 1, CELL - 2, CELL - 2);
		});
		const h = s.snake[0];
		ctx.fillStyle = LCD.lightest; // eye
		ctx.fillRect(fx + h.x * CELL + CELL - 5, fy + h.y * CELL + 3, 2, 2);

		// messages
		const msg = paused ? PAUSED_LINES : s.status === "idle" ? ["PRESS SPACE", "OR AN ARROW"] : s.status === "over" ? ["GAME OVER", "SPACE TO RETRY"] : s.status === "won" ? ["YOU WIN", "SPACE TO PLAY"] : [];
		if (msg.length > 0) {
			const bw = 150;
			const bh = 18 + msg.length * 14;
			const bx = (W - bw) / 2;
			const by = fy + (ROWS * CELL - bh) / 2;
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
				ctx.fillText(line, W / 2, by + 16 + i * 14);
			});
		}
	}
}
