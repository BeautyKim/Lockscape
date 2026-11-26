// Runs one Game inside the lock screen: the canvas, the requestAnimationFrame loop, the keyboard and focus rules,
// and the cleanup. Everything that registers with the page does it through ONE AbortController, ONE frame id and
// ONE timer id, so destroy() releases all of it and nothing keeps running behind an unlocked screen.
//
// Rules (from the theme spec):
//  - a control (the password field, a button) having focus pauses the game; keys then go to the control only
//  - Tab moves the keyboard to the password field, Escape gives it back to the game
//  - the loop runs only while a round is in progress, the overlay is showing and the window is visible

import type { Game } from "./game";

export interface HostOptions {
	doc: Document;
	win: Window;
	/** Where the canvas goes. */
	mount: HTMLElement;
	/** The overlay root: keyboard events and focus changes are watched here. */
	root: HTMLElement;
	highScore: number;
	/** A round ended (or the screen went away mid-round) with a new best. */
	onHighScore(score: number): void;
	/** Tab pressed while the game has the keyboard: move focus to the password field. False if the field cannot take focus. */
	focusField(): boolean;
}

/** A control the person is using: the game must not eat its keys. */
export function isControl(el: Element | null): boolean {
	if (!el) return false;
	return ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName);
}

const MAX_DT = 0.05; // a long frame (tab switch, debugger) must not teleport the game

export class GameHost {
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D | null;
	private readonly ac = new AbortController();
	private raf = 0;
	private pauseTimer = 0;
	private last = 0;
	private active = false;
	private frozen = false;
	private paused = false;
	private wasRunning = false;
	private best: number;
	private destroyed = false;

	constructor(
		readonly game: Game,
		private readonly o: HostOptions,
	) {
		this.best = o.highScore;
		game.setHighScore(o.highScore);
		const { doc, win } = o;
		const canvas = (this.canvas = createEl("canvas"));
		canvas.className = "vault-lock-game-canvas";
		canvas.setAttribute("aria-hidden", "true");
		const dpr = Math.min(2, win.devicePixelRatio || 1);
		canvas.width = Math.round(game.width * dpr);
		canvas.height = Math.round(game.height * dpr);
		// CSS size = logical size, so one logical px is one CSS px (crisp pixel art). The stylesheet may shrink it to
		// fit a short window (see --vl-game-w / --vl-game-r in styles.css); the aspect ratio keeps it undistorted.
		canvas.style.setProperty("--vl-game-w", `${game.width}px`);
		canvas.style.setProperty("--vl-game-r", String(game.width / game.height));
		canvas.style.aspectRatio = `${game.width} / ${game.height}`;
		this.ctx = canvas.getContext("2d");
		this.ctx?.scale(dpr, dpr);
		o.mount.replaceChildren(canvas);

		const sig = { signal: this.ac.signal };
		o.root.addEventListener("keydown", (e) => this.onKey(e, true), sig);
		o.root.addEventListener("keyup", (e) => this.onKey(e, false), sig);
		o.root.addEventListener("focusin", () => this.syncPause(), sig);
		o.root.addEventListener("focusout", () => this.syncPauseSoon(), sig);
		doc.addEventListener("visibilitychange", () => this.syncPause(), sig);
		canvas.addEventListener("pointermove", (e) => this.onPointer(e), sig);
		canvas.addEventListener(
			"pointerdown",
			(e) => {
				if (!this.active) return;
				// A click on the game is "back to the game": the field loses focus, the keyboard comes here.
				o.root.focus({ preventScroll: true });
				this.reportPointer(e);
				if (game.pointerDown?.()) e.preventDefault();
				this.kick();
			},
			sig,
		);
		this.reset();
	}

	/** The overlay is showing (locked or previewing) or not. Leaving it resets the game to its start screen. */
	setActive(active: boolean): void {
		if (this.destroyed) return;
		if (active) {
			if (this.active && !this.frozen) return;
			if (this.frozen) this.reset(); // coming back after freeze(): start screen, not the old round
			this.frozen = false;
			this.active = true;
			this.syncPause();
			this.draw();
		} else if (this.active) {
			this.active = false;
			this.finishRound();
			this.stopLoop();
			this.reset();
		}
	}

	/** Stop for good without redrawing (the unlock fade): the last frame stays on screen, nothing runs or listens. */
	freeze(): void {
		if (this.destroyed || !this.active) return;
		this.active = false;
		this.frozen = true;
		this.finishRound();
		this.stopLoop();
	}

	setHighScore(score: number): void {
		this.best = Math.max(this.best, score);
		this.game.setHighScore(this.best);
		if (this.active) this.draw();
	}

	destroy(): void {
		if (this.destroyed) return;
		this.finishRound();
		this.destroyed = true;
		this.ac.abort(); // every listener registered above
		this.stopLoop();
		this.o.win.clearTimeout(this.pauseTimer);
		this.pauseTimer = 0;
		this.canvas.remove();
	}

	// ---- keyboard / focus ------------------------------------------------------------------

	private onKey(e: KeyboardEvent, down: boolean): void {
		if (!this.active || e.isComposing) return; // an IME candidate window uses Esc and the arrows itself
		const el = this.o.doc.activeElement;
		if (isControl(el)) {
			// The control owns the keyboard. Esc is the way back to the game.
			if (down && e.code === "Escape") {
				(el as HTMLElement).blur();
				this.o.root.focus({ preventScroll: true });
				e.preventDefault();
			}
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		if (down && e.code === "Tab" && !e.shiftKey) {
			if (this.o.focusField()) e.preventDefault(); // otherwise the browser tabs on as usual
			return;
		}
		if (this.paused) return;
		// Holding a key must not start or restart a round by key repeat (Space held through GAME OVER).
		if (down && e.repeat && !this.game.running) {
			if (this.game.key(e.code, false)) e.preventDefault(); // still keep the arrows and Space from scrolling
			return;
		}
		if (this.game.key(e.code, down)) e.preventDefault(); // arrows and Space must not scroll the overlay
		this.kick();
	}

	private reportPointer(e: PointerEvent): void {
		if (!this.game.pointer) return;
		const r = this.canvas.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return;
		this.game.pointer(((e.clientX - r.left) / r.width) * this.game.width, ((e.clientY - r.top) / r.height) * this.game.height);
	}

	private onPointer(e: PointerEvent): void {
		if (!this.active || this.paused || !this.game.pointer) return;
		this.reportPointer(e);
		this.kick();
	}

	/** Paused while a control has the keyboard or the window is not visible. */
	private syncPause(): void {
		if (this.destroyed) return;
		const paused = isControl(this.o.doc.activeElement) || this.o.doc.hidden;
		if (paused === this.paused) return;
		this.paused = paused;
		if (paused) {
			this.stopLoop();
			this.game.releaseKeys?.();
		}
		if (this.active) this.draw();
		if (!paused) this.kick();
	}

	/** Focus leaves one element a moment before it lands on the next: look after it has settled. */
	private syncPauseSoon(): void {
		this.o.win.clearTimeout(this.pauseTimer);
		this.pauseTimer = this.o.win.setTimeout(() => {
			this.pauseTimer = 0;
			this.syncPause();
		}, 0);
	}

	// ---- loop ------------------------------------------------------------------------------

	/** Redraw, and make sure the loop is running if the game needs time to pass. */
	private kick(): void {
		if (this.destroyed || !this.active) return;
		this.noteRoundEnd();
		this.draw();
		if (this.game.running && !this.paused && this.raf === 0) {
			this.last = 0;
			this.raf = this.o.win.requestAnimationFrame((t) => this.frame(t));
		}
	}

	private frame(t: number): void {
		this.raf = 0;
		if (this.destroyed || !this.active || this.paused) return;
		const dt = this.last === 0 ? 0 : Math.min(MAX_DT, (t - this.last) / 1000);
		this.last = t;
		this.game.update(dt);
		this.noteRoundEnd();
		this.draw();
		if (this.game.running) this.raf = this.o.win.requestAnimationFrame((n) => this.frame(n));
	}

	private stopLoop(): void {
		if (this.raf !== 0) this.o.win.cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.last = 0;
	}

	private draw(): void {
		if (!this.ctx) return;
		this.ctx.save();
		this.game.draw(this.ctx, this.paused);
		this.ctx.restore();
	}

	private reset(): void {
		this.wasRunning = false;
		this.game.reset();
		this.draw();
	}

	// ---- high score ------------------------------------------------------------------------

	/** A round just ended: report a new best. */
	private noteRoundEnd(): void {
		const running = this.game.running;
		if (this.wasRunning && !running) this.finishRound();
		this.wasRunning = running;
	}

	private finishRound(): void {
		if (this.game.score > this.best) {
			this.best = this.game.score;
			this.game.setHighScore(this.best);
			this.o.onHighScore(this.best);
		}
	}
}
