// Breakout drawn as thin neon wireframes. The rules are plain data + functions (no DOM) so they can be tested;
// BreakoutGame at the bottom turns them into a Game for the host.

import { PAUSED_LINES, type Game } from "./game";

export type Status = "ready" | "running" | "over";
export type Rng = () => number;

export interface Brick {
	x: number;
	y: number;
	row: number;
}

export interface BreakoutState {
	paddle: { x: number; y: number; w: number; h: number }; // x = centre
	ball: { x: number; y: number; vx: number; vy: number; r: number };
	bricks: Brick[]; // the ones still standing
	lives: number;
	level: number;
	score: number;
	status: Status;
}

// layout, in logical px
export const W = 280;
export const H = 320;
export const HUD = 24; // the field starts below the score line
export const COLS = 8;
export const ROWS = 5;
export const BRICK_W = 29;
export const BRICK_H = 11;
export const BRICK_GAP = 4;
const BRICK_TOP = HUD + 18;
const BRICK_LEFT = (W - (COLS * BRICK_W + (COLS - 1) * BRICK_GAP)) / 2;
export const PADDLE_W = 52;
export const PADDLE_H = 6;
const PADDLE_Y = H - 28;
const PADDLE_SPEED = 340; // px/s with the arrow keys
const BALL_R = 4;
const MAX_ANGLE = (62 * Math.PI) / 180; // the steepest a paddle hit can send the ball, from straight up
const MIN_ANGLE = (9 * Math.PI) / 180; // a dead-centre hit still leans a little, or the ball would rally straight up and down forever
const START_LIVES = 3;
export const POINTS = 10;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function ballSpeed(level: number): number {
	return Math.min(330, 200 + (level - 1) * 20);
}

export function makeBricks(): Brick[] {
	const out: Brick[] = [];
	for (let row = 0; row < ROWS; row++)
		for (let col = 0; col < COLS; col++) out.push({ x: BRICK_LEFT + col * (BRICK_W + BRICK_GAP), y: BRICK_TOP + row * (BRICK_H + BRICK_GAP), row });
	return out;
}

export function newGame(): BreakoutState {
	const s: BreakoutState = {
		paddle: { x: W / 2, y: PADDLE_Y, w: PADDLE_W, h: PADDLE_H },
		ball: { x: W / 2, y: PADDLE_Y - BALL_R, vx: 0, vy: 0, r: BALL_R },
		bricks: makeBricks(),
		lives: START_LIVES,
		level: 1,
		score: 0,
		status: "ready",
	};
	return s;
}

/** The ball rides on the paddle until it is launched. */
function stick(s: BreakoutState): void {
	s.ball.x = s.paddle.x;
	s.ball.y = s.paddle.y - s.ball.r;
	s.ball.vx = s.ball.vy = 0;
}

export function movePaddleTo(s: BreakoutState, x: number): void {
	s.paddle.x = clamp(x, s.paddle.w / 2, W - s.paddle.w / 2);
	if (s.status === "ready") stick(s);
}

/** Send the ball up from the paddle at a slightly random angle. */
export function launch(s: BreakoutState, rng: Rng): void {
	if (s.status !== "ready") return;
	const angle = (rng() - 0.5) * 0.7; // about +-20 degrees from straight up
	const speed = ballSpeed(s.level);
	s.ball.vx = speed * Math.sin(angle);
	s.ball.vy = -speed * Math.cos(angle);
	s.status = "running";
}

/** Circle against a rectangle: is the closest point of the rectangle within the radius? */
export function circleHitsRect(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number): boolean {
	const nx = clamp(cx, rx, rx + rw);
	const ny = clamp(cy, ry, ry + rh);
	const dx = cx - nx;
	const dy = cy - ny;
	return dx * dx + dy * dy <= r * r;
}

function loseLife(s: BreakoutState): void {
	s.lives -= 1;
	if (s.lives <= 0) {
		s.lives = 0;
		s.status = "over";
		return;
	}
	s.status = "ready";
	stick(s);
}

function nextLevel(s: BreakoutState): void {
	s.level += 1;
	s.bricks = makeBricks();
	s.status = "ready";
	stick(s);
}

/** One small move of the ball (about 2 px), so a fast ball can never jump over a brick or the paddle. */
function stepBall(s: BreakoutState, dt: number): void {
	const b = s.ball;
	const prevX = b.x;
	const prevY = b.y;
	b.x += b.vx * dt;
	b.y += b.vy * dt;

	// walls and ceiling
	if (b.x - b.r < 0) {
		b.x = b.r;
		b.vx = Math.abs(b.vx);
	} else if (b.x + b.r > W) {
		b.x = W - b.r;
		b.vx = -Math.abs(b.vx);
	}
	if (b.y - b.r < HUD) {
		b.y = HUD + b.r;
		b.vy = Math.abs(b.vy);
	}

	// paddle: only from above, so a ball that slipped past cannot be rescued from the side
	const p = s.paddle;
	if (b.vy > 0 && prevY + b.r <= p.y + 2 && b.y + b.r >= p.y && b.x >= p.x - p.w / 2 - b.r && b.x <= p.x + p.w / 2 + b.r) {
		const offset = clamp((b.x - p.x) / (p.w / 2 + b.r), -1, 1); // -1 left edge .. 1 right edge
		const speed = Math.hypot(b.vx, b.vy);
		let angle = offset * MAX_ANGLE;
		if (Math.abs(angle) < MIN_ANGLE) angle = (offset < 0 || (offset === 0 && b.vx < 0) ? -1 : 1) * MIN_ANGLE; // keep the way it was heading when dead centre
		b.vx = speed * Math.sin(angle);
		b.vy = -speed * Math.cos(angle);
		b.y = p.y - b.r;
	}

	// bricks: one per small move
	for (let i = 0; i < s.bricks.length; i++) {
		const k = s.bricks[i];
		if (!circleHitsRect(b.x, b.y, b.r, k.x, k.y, BRICK_W, BRICK_H)) continue;
		s.bricks.splice(i, 1);
		s.score += POINTS;
		// came in from the side (centre was left or right of the brick) or from above / below
		if (prevX < k.x || prevX > k.x + BRICK_W) b.vx = -b.vx;
		else b.vy = -b.vy;
		break;
	}

	// keep the ball from settling into a flat, endless sideways bounce
	const speed = Math.hypot(b.vx, b.vy);
	const minVy = speed * 0.2;
	if (speed > 0 && Math.abs(b.vy) < minVy) {
		b.vy = (b.vy < 0 ? -1 : 1) * minVy;
		b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(speed * speed - minVy * minVy);
	}

	if (s.bricks.length === 0) nextLevel(s);
	else if (b.y - b.r > H) loseLife(s);
}

/** Advance by dt seconds. Held keys move the paddle (dir -1 left, 1 right, 0 none). */
export function tick(s: BreakoutState, dt: number, dir: -1 | 0 | 1): void {
	if (s.status === "over") return;
	if (dir !== 0) movePaddleTo(s, s.paddle.x + dir * PADDLE_SPEED * dt);
	if (s.status !== "running") return;
	const dist = Math.hypot(s.ball.vx, s.ball.vy) * dt;
	const n = Math.max(1, Math.ceil(dist / 2));
	for (let i = 0; i < n && s.status === "running"; i++) stepBall(s, dt / n);
}

// ---- the Game for the host --------------------------------------------------------------------

export const NEON = {
	bg: "#070816",
	frame: "#312e6b",
	cyan: "#5ad2e6",
	magenta: "#d46ee6",
	purple: "#9d8cf0",
	text: "#b8c4e6",
	dim: "#4b4f86",
} as const;

const ROW_COLORS = [NEON.magenta, NEON.purple, NEON.cyan, NEON.purple, NEON.magenta];
const FONT = "10px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const pad4 = (n: number) => String(Math.min(n, 999999)).padStart(4, "0");

export class BreakoutGame implements Game {
	readonly id = "breakout" as const;
	readonly width = W;
	readonly height = H;
	private s: BreakoutState = newGame();
	private best = 0;
	private left = false;
	private right = false;

	constructor(private readonly rng: Rng = Math.random) {}

	private get dir(): -1 | 0 | 1 {
		return this.left === this.right ? 0 : this.left ? -1 : 1;
	}

	/** Also true while only the paddle is being moved by a held key, so it glides instead of stepping. */
	get running(): boolean {
		return this.s.status === "running" || (this.s.status === "ready" && this.dir !== 0);
	}
	get score(): number {
		return this.s.score;
	}
	setHighScore(score: number): void {
		this.best = score;
	}
	reset(): void {
		this.s = newGame();
		this.releaseKeys();
	}
	releaseKeys(): void {
		this.left = this.right = false;
	}
	update(dt: number): void {
		tick(this.s, dt, this.dir);
	}

	key(code: string, down: boolean): boolean {
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

	pointer(x: number): void {
		if (this.s.status !== "over") movePaddleTo(this.s, x);
	}

	pointerDown(): boolean {
		this.primary();
		return true;
	}

	/** Space or a click: launch the ball, or start over after the last life. */
	private primary(): void {
		if (this.s.status === "ready") launch(this.s, this.rng);
		else if (this.s.status === "over") {
			this.s = newGame();
			this.releaseKeys();
		}
	}

	draw(ctx: CanvasRenderingContext2D, paused: boolean): void {
		const s = this.s;
		ctx.fillStyle = NEON.bg;
		ctx.fillRect(0, 0, W, H);

		// field frame
		ctx.lineWidth = 1;
		ctx.strokeStyle = NEON.frame;
		ctx.strokeRect(0.5, HUD + 0.5, W - 1, H - HUD - 1);

		// HUD: score, lives, best
		ctx.font = FONT;
		ctx.textBaseline = "middle";
		ctx.fillStyle = NEON.text;
		ctx.textAlign = "left";
		ctx.fillText(`SCORE ${pad4(s.score)}`, 6, HUD / 2);
		ctx.textAlign = "right";
		ctx.fillText(`HI ${pad4(Math.max(this.best, s.score))}`, W - 6, HUD / 2);
		for (let i = 0; i < START_LIVES; i++) {
			ctx.strokeStyle = i < s.lives ? NEON.magenta : NEON.dim;
			ctx.beginPath();
			ctx.arc(W / 2 - 12 + i * 12, HUD / 2, 3, 0, Math.PI * 2);
			ctx.stroke();
		}

		// bricks: one pixel outlines
		for (const k of s.bricks) {
			ctx.strokeStyle = ROW_COLORS[k.row % ROW_COLORS.length];
			ctx.strokeRect(Math.round(k.x) + 0.5, Math.round(k.y) + 0.5, BRICK_W - 1, BRICK_H - 1);
		}

		// paddle and ball
		ctx.strokeStyle = NEON.cyan;
		ctx.strokeRect(Math.round(s.paddle.x - s.paddle.w / 2) + 0.5, s.paddle.y + 0.5, s.paddle.w - 1, s.paddle.h - 1);
		ctx.strokeStyle = NEON.cyan;
		ctx.beginPath();
		ctx.arc(s.ball.x, s.ball.y, s.ball.r - 0.5, 0, Math.PI * 2);
		ctx.stroke();

		// messages
		const msg = paused ? PAUSED_LINES : s.status === "ready" ? ["CLICK OR SPACE", "MOUSE OR ARROWS MOVE"] : s.status === "over" ? ["GAME OVER", "SPACE TO RETRY"] : null;
		if (msg) {
			const bw = 160;
			const bh = 40;
			const bx = Math.round((W - bw) / 2);
			const by = Math.round(H * 0.58);
			ctx.fillStyle = NEON.bg;
			ctx.fillRect(bx, by, bw, bh);
			ctx.strokeStyle = NEON.purple;
			ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
			ctx.textAlign = "center";
			ctx.fillStyle = NEON.cyan;
			ctx.fillText(msg[0], W / 2, by + 14);
			ctx.fillStyle = NEON.text;
			ctx.fillText(msg[1], W / 2, by + 28);
		}
	}
}
