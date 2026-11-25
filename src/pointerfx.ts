// Motion graphics that follow the mouse / finger on the lock screen. One <canvas>, drawn with
// requestAnimationFrame only while something is moving; stopped when the window is hidden.
// Each visual theme draws the same three effects in its own style.

import { resolveColor, type RGB } from "./color";

export type PointerFxKind = "glow" | "trail" | "orbs";
export type FxTheme = "default" | "retro" | "cartoon";

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	age: number;
	life: number;
	size: number;
	rot: number;
	vr: number;
	ci: number;
}

interface Orb {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	ci: number;
	k: number; // spring stiffness: how eagerly it chases
	ang: number;
	rad: number; // distance from the pointer it orbits at
	w: number; // angular speed
}

const BAYER = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
];
const PIXEL = 6; // retro: one canvas cell = 6 CSS px
const MAX_PARTICLES = 90;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class PointerFx {
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D | null;
	private readonly particles: Particle[] = [];
	private readonly orbs: Orb[] = [];
	private raf = 0;
	private lastT = 0;
	private w = 0; // CSS px
	private h = 0;
	private scale = 1; // canvas px per CSS px
	private pos = { x: 0, y: 0 };
	private target = { x: 0, y: 0 };
	private last = { x: 0, y: 0 };
	private lastMove = 0;
	private active = false; // pointer has been seen at least once
	private destroyed = false;
	private readonly onMove: (e: PointerEvent) => void;
	private readonly onVis: () => void;
	private readonly onResize: () => void;
	private readonly rgb: RGB[];

	constructor(
		private readonly doc: Document,
		private readonly win: Window,
		host: HTMLElement,
		private readonly kind: PointerFxKind,
		private readonly theme: FxTheme,
		private readonly colors: string[],
	) {
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
		this.onVis = () => (doc.hidden ? this.stopLoop() : this.kick());
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

	destroy(): void {
		this.destroyed = true;
		this.stopLoop();
		this.doc.removeEventListener("pointermove", this.onMove);
		this.doc.removeEventListener("pointerdown", this.onMove);
		this.doc.removeEventListener("visibilitychange", this.onVis);
		this.win.removeEventListener("resize", this.onResize);
		this.canvas.remove();
	}

	// ---- loop ---------------------------------------------------------------------------------

	private kick(): void {
		if (this.destroyed || this.raf || this.doc.hidden) return;
		this.lastT = performance.now();
		this.raf = this.win.requestAnimationFrame(this.frame);
	}

	private stopLoop(): void {
		if (this.raf) this.win.cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	private readonly frame = (t: number): void => {
		this.raf = 0;
		if (this.destroyed) return;
		const dt = Math.min(0.05, Math.max(0.001, (t - this.lastT) / 1000));
		this.lastT = t;
		this.update(dt, t / 1000);
		this.draw(t / 1000);
		if (this.needsFrame()) this.raf = this.win.requestAnimationFrame(this.frame);
	};

	private needsFrame(): boolean {
		const recently = performance.now() - this.lastMove < 2500;
		if (this.kind === "orbs") return true; // orbs keep drifting on their own
		if (this.kind === "trail") return this.particles.length > 0 || recently;
		const dx = this.target.x - this.pos.x;
		const dy = this.target.y - this.pos.y;
		return recently || dx * dx + dy * dy > 1 || this.glowAlpha > 0.01;
	}

	private resize(): void {
		this.w = this.win.innerWidth;
		this.h = this.win.innerHeight;
		const dpr = Math.min(2, this.win.devicePixelRatio || 1);
		this.scale = this.theme === "retro" ? 1 / PIXEL : dpr;
		this.canvas.width = Math.max(1, Math.ceil(this.w * this.scale));
		this.canvas.height = Math.max(1, Math.ceil(this.h * this.scale));
		this.canvas.style.imageRendering = this.theme === "retro" ? "pixelated" : "auto";
		this.draw(performance.now() / 1000);
	}

	// ---- simulation ---------------------------------------------------------------------------

	private glowAlpha = 0;

	private update(dt: number, time: number): void {
		const recently = performance.now() - this.lastMove < 2500;

		// smoothed position (glow) / eased target for the others
		const ease = 1 - Math.pow(0.0008, dt);
		this.pos.x += (this.target.x - this.pos.x) * ease;
		this.pos.y += (this.target.y - this.pos.y) * ease;
		this.glowAlpha += ((recently ? 1 : 0) - this.glowAlpha) * Math.min(1, dt * 2.2);

		if (this.kind === "trail") {
			for (const p of this.particles) {
				p.age += dt;
				p.x += p.vx * dt;
				p.y += p.vy * dt;
				p.rot += p.vr * dt;
				if (this.theme === "retro") p.vy += 300 * dt; // falling pixels
				else p.vx *= 1 - 0.8 * dt;
			}
			for (let i = this.particles.length - 1; i >= 0; i--) if (this.particles[i].age >= this.particles[i].life) this.particles.splice(i, 1);
		}

		if (this.kind === "orbs") {
			const cx = this.w / 2;
			const cy = this.h / 2;
			for (const o of this.orbs) {
				o.ang += o.w * dt;
				// chase the pointer while it is around, otherwise wander on a slow lissajous path
				const tx = recently || this.active
					? this.target.x + Math.cos(o.ang) * o.rad
					: cx + Math.cos(time * 0.3 + o.ci) * this.w * 0.28;
				const ty = recently || this.active
					? this.target.y + Math.sin(o.ang) * o.rad
					: cy + Math.sin(time * 0.37 + o.ci * 1.7) * this.h * 0.22;
				o.vx += (tx - o.x) * o.k;
				o.vy += (ty - o.y) * o.k;
				o.vx *= 0.88;
				o.vy *= 0.88;
				o.x += o.vx;
				o.y += o.vy;
			}
		}
	}

	private makeOrbs(): void {
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
				ang: (i / n) * Math.PI * 2,
				rad: 40 + i * 18,
				w: (i % 2 ? 1 : -1) * rnd(0.7, 1.6),
			});
		}
	}

	private spawnAlongPath(x: number, y: number): void {
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
				life: cartoon ? rnd(0.7, 1.0) : this.theme === "retro" ? rnd(0.7, 1.1) : rnd(0.8, 1.3),
				size: cartoon ? rnd(10, 19) : this.theme === "retro" ? 1 + Math.floor(Math.random() * 2) : rnd(5, 13),
				rot: rnd(0, Math.PI * 2),
				vr: rnd(-3, 3),
				ci: Math.floor(Math.random() * this.colors.length),
			});
		}
	}

	// ---- drawing ------------------------------------------------------------------------------

	private draw(time: number): void {
		const ctx = this.ctx;
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		// Retro draws in grid cells (it divides coordinates by PIXEL itself), so its transform is the identity;
		// the other themes draw in CSS px and let the transform scale up for high-DPI screens.
		const k = this.theme === "retro" ? 1 : this.scale;
		ctx.setTransform(k, 0, 0, k, 0, 0);

		if (this.theme === "retro") this.drawRetro(ctx, time);
		else if (this.theme === "cartoon") this.drawCartoon(ctx, time);
		else this.drawDefault(ctx, time);
	}

	private color(i: number): string {
		return this.colors[i % this.colors.length];
	}

	/** Same colour at a given alpha. Gradients must fade to this, not to "transparent" (transparent black),
	 *  or the browser interpolates through grey and leaves a dark rim. */
	private rgba(i: number, a: number): string {
		const c = this.rgb[i % this.rgb.length];
		return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
	}

	private drawDefault(ctx: CanvasRenderingContext2D, _time: number): void {
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
	private drawRetro(ctx: CanvasRenderingContext2D, time: number): void {
		const cell = (x: number, y: number, c: string) => {
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
					// ordered dithering: a cell lights up when its intensity beats the Bayer threshold
					if (level > BAYER[(cy + y) & 3][(cx + x) & 3] / 16 + 0.04) {
						ctx.fillStyle = d < 0.45 ? this.color(1) : this.color(0);
						ctx.fillRect(cx + x, cy + y, 1, 1);
					}
				}
			}
		} else if (this.kind === "trail") {
			for (const p of this.particles) {
				const f = 1 - p.age / p.life;
				if (f < 0.3 && Math.floor(time * 18 + p.ci) % 2 === 0) continue; // blink out like a sprite
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
						ctx.fillStyle = d > (r - 1) * (r - 1) ? "#0d0b1e" : this.color(o.ci); // 1-cell outline
						ctx.fillRect(cx + x, cy + y, 1, 1);
					}
				}
				cell(o.x - o.r * 0.4, o.y - o.r * 0.4, "#ffffff"); // highlight pixel
			}
		}
	}

	/** Comic style: halftone dots, outlined stars, glossy outlined balls. */
	private drawCartoon(ctx: CanvasRenderingContext2D, _time: number): void {
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
					const ox = ((y / step) & 1) * (step / 2); // offset every other row like a real halftone screen
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
				const pop = f > 0.85 ? 0.6 + (1 - f) * 8 : 0.35 + f * 0.65; // quick overshoot then shrink
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
				ctx.strokeStyle = "rgba(255,255,255,0.9)"; // gloss highlight
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.arc(o.x, o.y, o.r * 0.62, Math.PI * 1.15, Math.PI * 1.5);
				ctx.stroke();
			}
		}
	}

	private star(ctx: CanvasRenderingContext2D, outer: number, inner: number, points: number): void {
		ctx.beginPath();
		for (let i = 0; i < points * 2; i++) {
			const r = i % 2 === 0 ? outer : inner;
			const a = (i * Math.PI) / points - Math.PI / 2;
			const x = Math.cos(a) * r;
			const y = Math.sin(a) * r;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
	}
}
