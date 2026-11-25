import { setIcon } from "obsidian";
import { palette, resolveColor, themeAccent } from "./color";
import { PointerFx, type FxTheme, type PointerFxKind } from "./pointerfx";
import { digitSvg } from "./segments";
import { fmt, type Strings } from "./i18n";

export type UnlockResult = { ok: true } | { ok: false; message: string; retryAt?: number };

export type AnimationKind = "none" | "aurora" | "fireflies" | "snow" | "glow" | "trail" | "orbs";
export type Theme = "default" | "retro" | "cartoon";
export type Position = "top" | "center" | "bottom";
export type FontStyle = "auto" | "sans" | "serif" | "mono" | "rounded"; // auto = the theme decides
export type FieldShape = "auto" | "rounded" | "pill" | "square"; // auto = the theme decides
export type ClockFormat = "auto" | "24" | "12";
export type TitleMode = "auto" | "show" | "hide"; // "Locked" text; auto = hidden over a photo

export interface Todo {
	id: string;
	text: string;
	done: boolean;
}

export const MAX_TODOS = 10;
export const MAX_TODO_LENGTH = 80;

/** Everything cosmetic about the lock screen. Re-read on every show, so settings apply on the next lock. */
export interface Appearance {
	imageUrl: string | null; // local app:// resource URL only, never a remote URL
	videoUrl: string | null; // same: a local file in the plugin folder
	dim: number; // 0-80 (%)
	blur: number; // 0-20 (px)
	animation: AnimationKind;
	showClock: boolean;
	showSeconds: boolean;
	showDate: boolean;
	clockFormat: ClockFormat;
	showTodos: boolean;
	hoverReveal: boolean; // hide the password field until hover / key press / tap
	theme: Theme;
	titleMode: TitleMode;
	customTitle: string; // replaces the default "Locked" text when non-empty
	showIcon: boolean;
	position: Position;
	fieldShape: FieldShape;
	clockScale: number; // 60-160 (%)
	clockFont: FontStyle;
	clockWeight: number; // 100-700
	textColor: string; // "" = automatic, else #rrggbb
	accentColor: string; // "" = theme accent, else #rrggbb
	locale: string; // BCP-47 tag for Intl (e.g. "ko", "zh-TW")
}

export interface LockScreenHooks {
	/** Verify a password. Rate limiting lives in the caller. */
	submit(password: string): Promise<UnlockResult>;
	/** Epoch ms until which attempts are refused (0 = no wait). */
	getRetryAt(): number;
	/** Every document that shows vault content (main window + popout windows). */
	getDocuments(): Document[];
	getAppearance(): Appearance;
	getTodos(): Todo[];
	setTodos(todos: Todo[]): void;
	/** The lock screen is showing (true) / gone (false). Used to shrink and restore the app window. */
	onWindow(active: boolean): void;
	onUnlocked(): void;
}

type Mode = "off" | "cover" | "locked" | "preview";

const FONT_STACKS: Record<Exclude<FontStyle, "auto">, string> = {
	sans: 'var(--font-interface, system-ui, sans-serif)',
	serif: '"New York", "Iowan Old Style", Georgia, "Noto Serif KR", "Noto Serif CJK KR", serif',
	mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "D2Coding", monospace',
	rounded: 'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", Nunito, Quicksand, system-ui, sans-serif',
};

const UNLOCK_MS = 520; // padlock opens (360 ms), then the screen fades (260 ms, overlapping)

const POINTER_KINDS: AnimationKind[] = ["glow", "trail", "orbs"];
const FX_COLORS: Record<Exclude<Theme, "default">, string[]> = {
	retro: ["#ff3df2", "#20e6ff", "#ffe94a", "#7cff4f"],
	cartoon: ["#ffd93b", "#ff4d4d", "#2f9bff", "#ffffff"],
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const rnd = (min: number, max: number) => min + Math.random() * (max - min);

function newId(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** One overlay per window document. */
class OverlayView {
	readonly root: HTMLElement;
	readonly input: HTMLInputElement;
	private readonly button: HTMLButtonElement;
	private readonly message: HTMLElement;
	private readonly bg: HTMLElement;
	private readonly anim: HTMLElement;
	private readonly stage: HTMLElement;
	private readonly clockEl: HTMLElement;
	private readonly timeEl: HTMLElement;
	private readonly dateEl: HTMLElement;
	private readonly todosEl: HTMLElement;
	private readonly todoList: HTMLElement;
	private readonly hint: HTMLElement;
	private readonly inerted = new Set<Element>();
	private readonly observer: MutationObserver;
	private readonly onViewport: (() => void) | null;
	private readonly win: Window;
	private readonly titleEl: HTMLElement;
	private readonly iconEl: HTMLElement;
	private readonly slotObserver: ResizeObserver | null;
	private deniedTimer = 0;
	private fx: PointerFx | null = null;
	private theme: Theme = "default";
	private lastParts = "";
	private readonly onVis: () => void;
	private imageUrl: string | null = null;
	private imageLoaded = false;
	private imageAutoDim = 0; // legibility floor derived from the photo's brightness
	private video: HTMLVideoElement | null = null;
	private videoUrl: string | null = null;
	private videoLoaded = false;
	private videoAutoDim = 0;
	private userDim = 0.35;
	private timeFmt: Intl.DateTimeFormat | null = null;
	private dateFmt: Intl.DateTimeFormat | null = null;
	private lastTime = "";
	private lastDate = "";

	constructor(
		readonly doc: Document,
		private readonly t: Strings,
		private readonly handlers: {
			submit: (pw: string) => void;
			closePreview: () => void;
			addTodo: (text: string) => void;
			toggleTodo: (id: string) => void;
			deleteTodo: (id: string) => void;
		},
	) {
		this.win = doc.defaultView ?? window;
		const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
			const e = doc.createElement(tag);
			e.className = cls;
			return e;
		};

		const root = (this.root = el("div", "vault-lock-overlay"));
		root.setAttribute("role", "dialog");
		root.setAttribute("aria-modal", "true");
		root.setAttribute("aria-label", t.lockedTitle);
		root.tabIndex = -1;

		this.bg = el("div", "vault-lock-bg");
		this.anim = el("div", "vault-lock-anim");
		this.anim.setAttribute("aria-hidden", "true");
		this.bg.setAttribute("aria-hidden", "true");

		const stage = (this.stage = el("div", "vault-lock-stage"));

		// clock
		this.clockEl = el("div", "vault-lock-clock");
		this.timeEl = el("div", "vault-lock-time");
		this.dateEl = el("div", "vault-lock-date");
		this.clockEl.append(this.timeEl, this.dateEl);

		// lock card
		const card = el("div", "vault-lock-card");
		const icon = (this.iconEl = el("div", "vault-lock-icon"));
		setIcon(icon, "lock");
		const title = (this.titleEl = el("div", "vault-lock-title"));
		title.textContent = t.lockedTitle;

		const form = el("form", "vault-lock-form");
		form.noValidate = true;
		const input = (this.input = el("input", "vault-lock-input"));
		input.type = "password";
		input.placeholder = t.placeholder;
		input.autocomplete = "off";
		input.autocapitalize = "off";
		input.spellcheck = false;
		input.setAttribute("aria-label", t.placeholder);
		const button = (this.button = el("button", "vault-lock-button mod-cta"));
		button.type = "submit";
		button.textContent = t.unlock;
		// Shown by the retro/cartoon themes in place of the hidden field ("hover reveal"); decorative only.
		const revealHint = el("div", "vault-lock-reveal-hint");
		revealHint.setAttribute("aria-hidden", "true");
		// The animated text sits in an inner span: a CSS animation on `opacity` would override the rule that hides the hint.
		const revealText = el("span", "vault-lock-reveal-text");
		revealText.textContent = t.pressAnyKey;
		revealHint.append(revealText);
		form.append(input, button, revealHint);
		form.addEventListener("submit", (e) => {
			e.preventDefault();
			handlers.submit(input.value);
		});

		const message = (this.message = el("div", "vault-lock-message"));
		message.setAttribute("aria-live", "polite");
		this.hint = el("div", "vault-lock-hint");
		this.hint.textContent = t.previewClose;
		card.append(icon, title, form, message, this.hint);

		// to-do panel (static structure; only the list is re-rendered)
		this.todosEl = el("div", "vault-lock-todos");
		this.todoList = el("div", "vault-lock-todo-list");
		const addForm = el("form", "vault-lock-todo-add");
		addForm.noValidate = true;
		const addInput = el("input", "vault-lock-todo-input");
		addInput.type = "text";
		addInput.maxLength = MAX_TODO_LENGTH;
		addInput.placeholder = t.todoPlaceholder;
		addInput.autocomplete = "off";
		addInput.setAttribute("aria-label", t.todoPlaceholder);
		const addBtn = el("button", "vault-lock-todo-btn");
		addBtn.type = "submit";
		addBtn.setAttribute("aria-label", t.todoAdd);
		setIcon(addBtn, "plus");
		addForm.append(addInput, addBtn);
		addForm.addEventListener("submit", (e) => {
			e.preventDefault();
			const text = addInput.value.trim();
			if (!text) return;
			addInput.value = "";
			handlers.addTodo(text);
		});
		this.todosEl.append(this.todoList, addForm);

		stage.append(this.clockEl, card, this.todosEl);
		root.append(this.bg, this.anim, stage);

		// Keep keystrokes from reaching Obsidian's hotkey handling while locked.
		root.addEventListener("keydown", (e) => {
			if (e.key === "Escape" && root.classList.contains("is-preview")) handlers.closePreview();
			e.stopPropagation();
			// Hidden password field: the first printable key moves focus into it, and the browser then
			// types that very key into the field (focus changes during keydown still receive the input).
			if (
				root.classList.contains("hover-reveal") &&
				!root.classList.contains("is-preview") &&
				!root.classList.contains("is-cover") &&
				doc.activeElement !== input &&
				e.key.length === 1 &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.altKey
			) {
				input.focus({ preventScroll: true });
			}
		});
		// Touch has no hover: tapping the lock area focuses the (hidden) field, which reveals it and opens the keyboard.
		card.addEventListener("pointerdown", (e) => {
			if (e.pointerType !== "touch" || !root.classList.contains("hover-reveal")) return;
			if (!(e.target as Element).closest(".vault-lock-form")) input.focus({ preventScroll: true });
		});
		// Preview mode: click on the backdrop (not on the to-do panel) closes it.
		root.addEventListener("click", (e) => {
			if (!root.classList.contains("is-preview")) return;
			// composedPath() is fixed when the click starts. Using e.target.closest() would misfire when a
			// handler (e.g. delete) re-renders the list and detaches the clicked button before this runs.
			if (e.composedPath().includes(this.todosEl)) return;
			handlers.closePreview();
		});

		// Mobile keyboards shrink the visual viewport; keep the stage centered above it.
		const vv = this.win.visualViewport;
		if (vv) {
			this.onViewport = () => {
				root.style.top = `${vv.offsetTop}px`;
				root.style.height = `${vv.height}px`;
			};
			vv.addEventListener("resize", this.onViewport);
			vv.addEventListener("scroll", this.onViewport);
		} else {
			this.onViewport = null;
		}

		// The height of the field slot drives the "centred when hidden, glide up when revealed" layout (CSS var).
		const RO = (this.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		this.slotObserver = RO ? new RO(() => root.style.setProperty("--vl-slot-h", `${form.offsetHeight}px`)) : null;
		this.slotObserver?.observe(form);

		// Do not keep decoding a background video while the window is hidden (battery on laptops and phones).
		this.onVis = () => {
			const v = this.video;
			if (!v) return;
			if (doc.hidden) v.pause();
			else if (!this.reducedMotion()) void v.play().catch(() => undefined);
		};
		doc.addEventListener("visibilitychange", this.onVis);

		// While active: anything new added next to our overlay (modals, notices, menus)
		// becomes inert, and removing the overlay (devtools) re-attaches it.
		this.observer = new MutationObserver(() => this.enforce());
	}

	attach(): void {
		const body = this.doc.body;
		if (!this.root.isConnected) body.append(this.root);
		this.enforce();
		this.observer.observe(body, { childList: true });
		this.onViewport?.();
	}

	private enforce(): void {
		const body = this.doc.body;
		if (!this.root.isConnected) body.append(this.root);
		for (const child of Array.from(body.children)) {
			if (child === this.root || this.inerted.has(child)) continue;
			if ((child as HTMLElement).inert) continue; // was already inert; leave it alone
			(child as HTMLElement).inert = true;
			this.inerted.add(child);
		}
	}

	/** Success feedback: the padlock opens and the text says so; the caller removes the overlay shortly after. */
	setUnlocking(): void {
		this.root.classList.add("is-unlocking");
		this.input.disabled = true;
		this.button.disabled = true;
		setIcon(this.iconEl, "lock-open");
		if (!this.iconEl.querySelector("svg")) setIcon(this.iconEl, "unlock"); // older icon set
		this.titleEl.textContent = this.t.unlocked;
		this.button.textContent = "✓"; // not "checking…" any more; the label is restored by detach() -> setBusy(false)
	}

	/** Wrong password: the card shakes once. */
	setDenied(): void {
		const r = this.root;
		r.classList.remove("is-denied");
		void r.offsetWidth; // restart the animation if it is still running
		r.classList.add("is-denied");
		this.win.clearTimeout(this.deniedTimer);
		this.deniedTimer = this.win.setTimeout(() => r.classList.remove("is-denied"), 500);
	}

	private reducedMotion(): boolean {
		try {
			return this.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
		} catch {
			return false;
		}
	}

	detach(): void {
		this.win.clearTimeout(this.deniedTimer);
		this.root.classList.remove("is-denied", "is-unlocking");
		if (this.iconEl.querySelector("svg") && this.root.isConnected) setIcon(this.iconEl, "lock"); // back to the closed padlock
		this.fx?.destroy();
		this.fx = null;
		this.clearVideo(); // free the decoder while nothing is shown; re-created on the next show
		this.observer.disconnect();
		for (const el of this.inerted) (el as HTMLElement).inert = false;
		this.inerted.clear();
		this.root.remove();
		this.root.style.removeProperty("top");
		this.root.style.removeProperty("height");
		this.input.value = "";
		this.setBusy(false);
		this.setMessage("");
	}

	destroy(): void {
		this.detach();
		this.slotObserver?.disconnect();
		this.doc.removeEventListener("visibilitychange", this.onVis);
		const vv = this.win.visualViewport;
		if (vv && this.onViewport) {
			vv.removeEventListener("resize", this.onViewport);
			vv.removeEventListener("scroll", this.onViewport);
		}
	}

	setMode(mode: Mode): void {
		const cover = mode === "cover";
		const preview = mode === "preview";
		this.root.classList.toggle("is-cover", cover);
		this.root.classList.toggle("is-preview", preview);
		this.input.disabled = cover || preview;
		this.button.disabled = cover || preview;
	}

	/** Apply the cosmetic settings: background, animation, text, clock, layout and widgets. */
	applyAppearance(a: Appearance, todos: Todo[]): void {
		this.setImage(a.imageUrl);
		this.setVideo(a.videoUrl);

		const r = this.root;
		this.theme = a.theme;
		r.classList.toggle("vl-theme-retro", a.theme === "retro");
		r.classList.toggle("vl-theme-cartoon", a.theme === "cartoon");
		r.classList.toggle("hover-reveal", a.hoverReveal);
		r.classList.toggle("title-auto", a.titleMode === "auto");
		r.classList.toggle("title-hide", a.titleMode === "hide");
		r.classList.toggle("custom-title", a.customTitle !== "");
		r.classList.toggle("no-icon", !a.showIcon);
		r.classList.toggle("pos-top", a.position === "top");
		r.classList.toggle("pos-bottom", a.position === "bottom");
		r.classList.toggle("shape-round", a.fieldShape === "rounded");
		r.classList.toggle("shape-pill", a.fieldShape === "pill");
		r.classList.toggle("shape-square", a.fieldShape === "square");
		this.titleEl.textContent = a.customTitle || this.t.lockedTitle; // textContent only: never parsed as HTML

		// Public CSS variables (also documented for Obsidian CSS snippets). Unset = automatic.
		const setVar = (name: string, value: string) =>
			value ? r.style.setProperty(name, value) : r.style.removeProperty(name);
		setVar("--vl-text", a.textColor);
		setVar("--vl-accent", a.accentColor);
		r.style.setProperty("--vl-clock-scale", String(clamp(a.clockScale, 60, 160) / 100));
		// "auto" font: leave the variables unset so the theme's own typography applies
		if (a.clockFont === "auto") {
			r.style.removeProperty("--vl-clock-weight");
			r.style.removeProperty("--vl-clock-font");
		} else {
			r.style.setProperty("--vl-clock-weight", String(clamp(a.clockWeight, 100, 700)));
			r.style.setProperty("--vl-clock-font", FONT_STACKS[a.clockFont]);
		}
		r.style.setProperty("--vl-blur", `${clamp(a.blur, 0, 20)}px`);
		this.userDim = clamp(a.dim, 0, 80) / 100;
		this.updateMedia();

		this.buildAnimation(a);

		// clock
		this.clockEl.classList.toggle("is-off", !a.showClock);
		this.dateEl.classList.toggle("is-off", !a.showDate);
		const hourCycle = a.clockFormat === "24" ? "h23" : a.clockFormat === "12" ? "h12" : undefined;
		const timeOpts: Intl.DateTimeFormatOptions = {
			hour: a.clockFormat === "24" ? "2-digit" : "numeric",
			minute: "2-digit",
			second: a.showSeconds ? "2-digit" : undefined,
			hourCycle,
		};
		const dateOpts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
		try {
			this.timeFmt = new Intl.DateTimeFormat(a.locale || undefined, timeOpts);
			this.dateFmt = new Intl.DateTimeFormat(a.locale || undefined, dateOpts);
		} catch {
			this.timeFmt = new Intl.DateTimeFormat(undefined, timeOpts);
			this.dateFmt = new Intl.DateTimeFormat(undefined, dateOpts);
		}
		this.lastTime = this.lastDate = this.lastParts = "";
		this.updateClock(new Date());

		// to-dos
		this.todosEl.classList.toggle("is-off", !a.showTodos);
		this.stage.classList.toggle("has-todos", a.showTodos);
		this.renderTodos(todos);
	}

	private setImage(url: string | null): void {
		if (url === this.imageUrl) return;
		this.imageUrl = url;
		this.imageLoaded = false;
		this.imageAutoDim = 0;
		this.bg.style.removeProperty("background-image");
		this.updateMedia();
		if (!url) return;
		// Only switch to the light-on-dark "has-image" style once the picture really loaded.
		const probe = this.doc.createElement("img");
		probe.onload = () => {
			if (this.imageUrl !== url) return;
			this.imageAutoDim = this.legibilityDim(probe);
			this.bg.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
			this.imageLoaded = true;
			this.updateMedia();
		};
		probe.src = url;
	}

	private setVideo(url: string | null): void {
		const reduced = this.reducedMotion();
		if (url === this.videoUrl && this.video) {
			if (!reduced) void this.video.play().catch(() => undefined);
			return;
		}
		this.clearVideo();
		this.videoUrl = url;
		if (!url) {
			this.updateMedia();
			return;
		}
		const v = this.doc.createElement("video");
		v.className = "vault-lock-video";
		v.muted = true; // required for autoplay; the lock screen never plays sound
		v.loop = true;
		v.playsInline = true;
		v.autoplay = !reduced; // reduced motion: show the first frame, do not play
		v.preload = "auto";
		v.controls = false;
		v.disablePictureInPicture = true;
		v.setAttribute("aria-hidden", "true");
		v.addEventListener("loadeddata", () => {
			if (this.videoUrl !== url) return;
			this.videoAutoDim = this.legibilityDim(v);
			this.videoLoaded = true;
			this.updateMedia();
			if (!reduced) void v.play().catch(() => undefined);
		});
		v.src = url;
		this.bg.prepend(v);
		this.video = v;
	}

	private clearVideo(): void {
		if (this.video) {
			this.video.pause();
			this.video.removeAttribute("src");
			this.video.load();
			this.video.remove();
			this.video = null;
		}
		this.videoUrl = null;
		this.videoLoaded = false;
		this.videoAutoDim = 0;
		this.updateMedia();
	}

	private updateMedia(): void {
		this.root.classList.toggle("has-image", this.imageLoaded || this.videoLoaded);
		this.root.classList.toggle("has-video", this.videoLoaded);
		const floor = Math.max(this.imageLoaded ? this.imageAutoDim : 0, this.videoLoaded ? this.videoAutoDim : 0);
		this.root.style.setProperty("--vl-dim", String(Math.max(this.userDim, floor)));
	}

	/** White text needs the dimmed picture to stay below ~45% brightness; bump dim up for bright media. */
	private legibilityDim(src: CanvasImageSource): number {
		try {
			const size = 24;
			const canvas = this.doc.createElement("canvas");
			canvas.width = canvas.height = size;
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) return 0;
			ctx.drawImage(src, 0, 0, size, size);
			const px = ctx.getImageData(0, 0, size, size).data;
			let sum = 0;
			for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
			const luma = sum / (size * size * 255);
			return luma > 0.45 ? Math.min(0.8, 1 - 0.45 / luma) : 0;
		} catch {
			return 0; // canvas unreadable: fall back to the user's setting
		}
	}

	/** Build the decorative animation. Transform/opacity only; counts scale with the screen area. */
	private buildAnimation(a: Appearance): void {
		this.fx?.destroy();
		this.fx = null;
		this.anim.className = `vault-lock-anim is-${a.animation}`;
		this.anim.replaceChildren();
		if (a.animation === "none") return;

		const base = (a.accentColor && resolveColor(this.doc, a.accentColor)) || themeAccent(this.doc);
		const colors = palette(base);

		// Pointer-following effects: one canvas, drawn in the active theme's style; skipped for reduced motion.
		if (POINTER_KINDS.includes(a.animation)) {
			if (!this.reducedMotion()) {
				const palette4 = a.theme === "default" ? [...colors, colors[0]] : FX_COLORS[a.theme];
				this.fx = new PointerFx(this.doc, this.win, this.anim, a.animation as PointerFxKind, a.theme as FxTheme, palette4);
			}
			return;
		}
		colors.forEach((c, i) => this.anim.style.setProperty(`--vl-c${i + 1}`, c));
		const area = this.win.innerWidth * this.win.innerHeight;
		const add = (tag: "b" | "i", vars: Record<string, string>) => {
			const e = this.doc.createElement(tag);
			for (const [k, v] of Object.entries(vars)) e.style.setProperty(k, v);
			this.anim.append(e);
		};
		const f = (n: number) => n.toFixed(1);

		if (a.animation === "aurora") {
			for (let i = 0; i < 4; i++) {
				add("b", {
					"--c": colors[i % 3],
					"--x": `${f(rnd(5, 95))}%`,
					"--y": `${f(rnd(5, 95))}%`,
					"--s": `${f(rnd(60, 90))}vmax`,
					"--dx": `${f(rnd(-24, 24))}vmax`,
					"--dy": `${f(rnd(-18, 18))}vmax`,
					"--d": `${f(rnd(22, 38))}s`,
					"--delay": `-${f(rnd(0, 30))}s`,
				});
			}
		} else if (a.animation === "fireflies") {
			const n = clamp(Math.round(area / 52000), 10, 30);
			for (let i = 0; i < n; i++) {
				const s = rnd(3, 7);
				add("i", {
					"--c": colors[i % 3],
					"--x": `${f(rnd(2, 98))}%`,
					"--y": `${f(rnd(4, 96))}%`,
					"--s": `${f(s)}px`,
					"--x1": `${f(rnd(-16, 16))}vmin`,
					"--y1": `${f(rnd(-16, 16))}vmin`,
					"--x2": `${f(rnd(-20, 20))}vmin`,
					"--y2": `${f(rnd(-20, 20))}vmin`,
					"--x3": `${f(rnd(-16, 16))}vmin`,
					"--y3": `${f(rnd(-16, 16))}vmin`,
					"--d": `${f(rnd(18, 34))}s`,
					"--p": `${f(rnd(2.8, 6))}s`,
					"--delay": `-${f(rnd(0, 30))}s`,
				});
			}
		} else if (a.animation === "snow") {
			const n = clamp(Math.round(area / 36000), 14, 48);
			for (let i = 0; i < n; i++) {
				add("i", {
					"--x": `${f(rnd(0, 100))}%`,
					"--s": `${f(rnd(2, 6))}px`,
					"--o": f(rnd(0.35, 0.9)),
					"--sway": `${f(rnd(-40, 40))}px`,
					"--d": `${f(rnd(9, 20))}s`,
					"--delay": `-${f(rnd(0, 20))}s`,
				});
			}
		}
	}

	updateClock(now: Date): void {
		if (!this.timeFmt || !this.dateFmt) return;
		const time = this.timeFmt.format(now);
		if (time !== this.lastTime) {
			this.lastTime = time;
			if (this.theme === "retro") this.renderSegmentClock(now);
			else this.timeEl.textContent = time;
		}
		const date = this.dateFmt.format(now);
		if (date !== this.lastDate) {
			this.lastDate = date;
			this.dateEl.textContent = date;
		}
	}

	/** Retro theme: digits as seven-segment SVGs, the colon blinks, am/pm (any language) stays small text. */
	private renderSegmentClock(now: Date): void {
		const parts = this.timeFmt?.formatToParts(now) ?? [];
		const key = parts.map((p) => p.type + p.value).join("|");
		if (key === this.lastParts) return;
		this.lastParts = key;
		const doc = this.doc;
		const nodes: Node[] = [];
		for (const part of parts) {
			if (part.type === "hour" || part.type === "minute" || part.type === "second") {
				for (const ch of part.value) nodes.push(digitSvg(doc, ch));
			} else if (part.type === "dayPeriod") {
				const span = doc.createElement("span");
				span.className = "vault-lock-period";
				span.textContent = part.value;
				nodes.push(span);
			} else if (part.type === "literal" && part.value.includes(":")) {
				const colon = doc.createElement("span");
				colon.className = "vault-lock-colon";
				colon.setAttribute("aria-hidden", "true");
				nodes.push(colon);
			}
		}
		this.timeEl.replaceChildren(...nodes);
		this.timeEl.setAttribute("aria-label", this.lastTime); // screen readers read the real time
		this.timeEl.setAttribute("role", "text");
	}

	renderTodos(todos: Todo[]): void {
		const doc = this.doc;
		const rows = todos.map((todo) => {
			const row = doc.createElement("div");
			row.className = "vault-lock-todo" + (todo.done ? " is-done" : "");
			const label = doc.createElement("label");
			label.className = "vault-lock-todo-label";
			const box = doc.createElement("input");
			box.type = "checkbox";
			box.checked = todo.done;
			box.addEventListener("change", () => this.handlers.toggleTodo(todo.id));
			const text = doc.createElement("span");
			text.textContent = todo.text; // textContent only: user text is never parsed as HTML
			label.append(box, text);
			const del = doc.createElement("button");
			del.type = "button";
			del.className = "vault-lock-todo-btn";
			del.setAttribute("aria-label", this.t.todoDelete);
			setIcon(del, "x");
			del.addEventListener("click", () => this.handlers.deleteTodo(todo.id));
			row.append(label, del);
			return row;
		});
		this.todoList.replaceChildren(...rows);
		const addForm = this.todosEl.querySelector<HTMLElement>(".vault-lock-todo-add");
		addForm?.classList.toggle("is-off", todos.length >= MAX_TODOS);
	}

	setMessage(text: string): void {
		this.message.textContent = text;
		this.root.classList.toggle("has-message", text !== ""); // keeps a hidden field visible while a message shows
	}

	setBusy(busy: boolean): void {
		this.root.classList.toggle("is-busy", busy);
		this.input.disabled = busy;
		this.button.disabled = busy;
		this.button.textContent = busy ? this.t.checking : this.t.unlock;
	}

	focus(): void {
		this.input.focus({ preventScroll: true });
	}

	focusRoot(): void {
		this.root.focus({ preventScroll: true });
	}
}

export class LockScreen {
	private mode: Mode = "off";
	private views = new Map<Document, OverlayView>();
	private countdown: number | null = null;
	private clockTimer: number | null = null;
	private busy = false;
	private unlockTimer = 0;

	constructor(
		private readonly t: Strings,
		private readonly hooks: LockScreenHooks,
	) {}

	get isLocked(): boolean {
		return this.mode === "locked";
	}

	get isCovering(): boolean {
		return this.mode === "cover";
	}

	get isPreviewing(): boolean {
		return this.mode === "preview";
	}

	/** Hide content immediately without asking for a password (grace period running). */
	cover(): void {
		if (this.mode === "locked") return;
		this.mode = "cover";
		this.render();
	}

	lock(): void {
		this.mode = "locked";
		this.notifyWindow(true);
		this.render();
		this.startCountdown();
		// With a hidden password field, focus the overlay (not the field) so it is not revealed unasked.
		const preferInput = !this.hooks.getAppearance().hoverReveal;
		window.setTimeout(() => this.focusActive(preferInput), 50);
	}

	/** Show the lock screen without locking, so appearance settings can be judged. Click/Esc closes it. */
	preview(): void {
		if (this.mode === "locked") return;
		this.mode = "preview";
		this.notifyWindow(true);
		this.render();
		window.setTimeout(() => {
			if (this.mode !== "preview") return;
			for (const v of this.views.values()) if (v.doc.hasFocus()) v.focusRoot();
		}, 50);
	}

	release(): void {
		window.clearTimeout(this.unlockTimer);
		this.mode = "off";
		this.stopCountdown();
		this.stopClock();
		for (const view of this.views.values()) view.detach();
		this.notifyWindow(false);
	}

	destroy(): void {
		window.clearTimeout(this.unlockTimer);
		const wasShowing = this.mode !== "off";
		this.mode = "off";
		if (wasShowing) this.notifyWindow(false);
		this.stopCountdown();
		this.stopClock();
		for (const view of this.views.values()) view.destroy();
		this.views.clear();
	}

	/**
	 * Window shrinking is cosmetic. If it throws, the lock screen must still appear (fail closed),
	 * so errors from this hook are swallowed.
	 */
	private notifyWindow(active: boolean): void {
		try {
			this.hooks.onWindow(active);
		} catch {
			/* cosmetic only */
		}
	}

	/** Call when a popout window opens/closes while locked. */
	refresh(): void {
		if (this.mode !== "off") this.render();
	}

	private render(): void {
		const docs = new Set(this.hooks.getDocuments());
		for (const [doc, view] of this.views) {
			if (!docs.has(doc)) {
				view.destroy();
				this.views.delete(doc);
			}
		}
		const appearance = this.hooks.getAppearance();
		const todos = this.hooks.getTodos();
		for (const doc of docs) {
			let view = this.views.get(doc);
			if (!view) {
				view = new OverlayView(doc, this.t, {
					submit: (pw) => void this.handleSubmit(pw),
					closePreview: () => {
						if (this.mode === "preview") this.release();
					},
					addTodo: (text) => this.editTodos((list) => {
						if (list.length < MAX_TODOS) list.push({ id: newId(), text: text.slice(0, MAX_TODO_LENGTH), done: false });
					}),
					toggleTodo: (id) => this.editTodos((list) => {
						const item = list.find((x) => x.id === id);
						if (item) item.done = !item.done;
					}),
					deleteTodo: (id) => this.editTodos((list) => {
						const i = list.findIndex((x) => x.id === id);
						if (i >= 0) list.splice(i, 1);
					}),
				});
				this.views.set(doc, view);
			}
			view.applyAppearance(appearance, todos);
			view.attach();
			view.setMode(this.mode);
		}
		this.startClock();
	}

	private editTodos(change: (list: Todo[]) => void): void {
		const list = this.hooks.getTodos().map((x) => ({ ...x }));
		change(list);
		this.hooks.setTodos(list);
		this.eachView((v) => v.renderTodos(list));
	}

	private startClock(): void {
		if (this.clockTimer !== null) return;
		this.clockTimer = window.setInterval(() => {
			const now = new Date();
			this.eachView((v) => v.updateClock(now));
		}, 1000);
	}

	private stopClock(): void {
		if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
		this.clockTimer = null;
	}

	private focusActive(preferInput = true): void {
		if (this.mode !== "locked") return;
		let target: OverlayView | undefined;
		for (const view of this.views.values()) {
			if (view.doc.hasFocus()) target = view;
		}
		const view = target ?? this.views.values().next().value;
		if (preferInput) view?.focus();
		else view?.focusRoot();
	}

	private async handleSubmit(password: string): Promise<void> {
		if (this.busy || this.mode !== "locked") return;
		this.busy = true;
		this.eachView((v) => v.setBusy(true));
		let result: UnlockResult;
		try {
			result = await this.hooks.submit(password);
		} catch {
			result = { ok: false, message: this.t.cryptoError };
		}
		if (result.ok) {
			this.stopCountdown();
			this.eachView((v) => v.setUnlocking());
			// let the padlock open before the overlay goes away; reduced motion skips the wait
			const wait = this.prefersReducedMotion() ? 0 : UNLOCK_MS;
			this.unlockTimer = window.setTimeout(() => {
				this.busy = false;
				this.release();
				this.hooks.onUnlocked();
			}, wait);
			return;
		}
		this.busy = false;
		this.eachView((v) => {
			v.setBusy(false);
			v.input.value = "";
			v.setMessage(result.message);
			v.setDenied();
		});
		this.startCountdown();
		this.focusActive();
	}

	/** While the caller refuses attempts, show a live "try again in Ns" and disable input. */
	private startCountdown(): void {
		this.stopCountdown();
		const tick = () => {
			const left = Math.ceil((this.hooks.getRetryAt() - Date.now()) / 1000);
			if (left > 0) {
				this.eachView((v) => {
					v.setMessage(fmt(this.t.wait, left));
					v.input.disabled = true;
				});
				return;
			}
			this.stopCountdown();
			this.eachView((v) => {
				v.input.disabled = false;
				v.setMessage("");
			});
			this.focusActive();
		};
		if (this.hooks.getRetryAt() > Date.now()) {
			tick();
			this.countdown = window.setInterval(tick, 1000);
		}
	}

	private stopCountdown(): void {
		if (this.countdown !== null) window.clearInterval(this.countdown);
		this.countdown = null;
	}

	private prefersReducedMotion(): boolean {
		try {
			return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		} catch {
			return false;
		}
	}

	private eachView(fn: (v: OverlayView) => void): void {
		for (const v of this.views.values()) fn(v);
	}
}
