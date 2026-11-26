// Motion graphics that follow the mouse / finger on the lock screen. One <canvas>, drawn with
// requestAnimationFrame only while something is moving; stopped when the window is hidden.

import { resolveColor, type RGB } from "./color";

export type PointerFxKind = "glow" | "trail" | "orbs";

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
		this.scale = dpr;
		this.canvas.width = Math.max(1, Math.ceil(this.w * this.scale));
		this.canvas.height = Math.max(1, Math.ceil(this.h * this.scale));
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
				p.vx *= 1 - 0.8 * dt;
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
				r: rnd(16, 36),
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
		const spacing = 9;
		const n = Math.min(6, Math.floor(dist / spacing));
		for (let i = 1; i <= n; i++) {
			if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
			const f = i / n;
			this.particles.push({
				x: this.last.x + dx * f,
				y: this.last.y + dy * f,
				vx: rnd(-18, 18),
				vy: rnd(-18, 18),
				age: 0,
				life: rnd(0.8, 1.3),
				size: rnd(5, 13),
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
		ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0); // draw in CSS px; the transform scales up for high-DPI screens
		this.drawDefault(ctx, time);
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
}
