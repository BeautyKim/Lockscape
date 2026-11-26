import { Scope, setIcon, type Keymap } from "obsidian";
import { inkFor, palette, resolveColor, themeAccent } from "./color";
import { PointerFx, type PointerFxKind } from "./pointerfx";
import { pixelLock, type PixelPalette } from "./pixelicons";
import { buildDesktop } from "./desktopicons";
import { pixelSvg, runsOf } from "./pixeltext";
import { GameHost, createGame } from "./games";
import { THEME_TEXT, gameOf, type GameId, type HighScores, type Theme } from "./themes";
import { fmt, type Strings } from "./i18n";
import { clipChars } from "./text";

export type UnlockResult = { ok: true } | { ok: false; message: string; retryAt?: number };

export type AnimationKind = "none" | "aurora" | "fireflies" | "snow" | "glow" | "trail" | "orbs";
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
	highScores: HighScores; // best score of each offline game theme
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
	hasRecovery: boolean; // a recovery key exists: show "forgot your password?"
}

/** What the typed text is: the password, or the recovery key. */
export type SubmitKind = "password" | "recovery";

export interface LockScreenHooks {
	/** Verify a password. Rate limiting lives in the caller. */
	submit(password: string, kind: SubmitKind): Promise<UnlockResult>;
	/** Epoch ms until which attempts are refused (0 = no wait). */
	getRetryAt(): number;
	/** Every document that shows vault content (main window + popout windows). */
	getDocuments(): Document[];
	getAppearance(): Appearance;
	getTodos(): Todo[];
	setTodos(todos: Todo[]): void;
	/** The lock screen is showing (true) / gone (false). Used to shrink and restore the app window. */
	onWindow(active: boolean): void;
	onUnlocked(kind: SubmitKind): void;
	/** A game round ended with a new best. The caller keeps it (data.json). */
	onHighScore(game: GameId, score: number): void;
	/** The lock engaged. The caller closes anything the owner left open (e.g. the password dialog). */
	onLock(): void;
	/** Obsidian's keymap. The overlay pushes its own scope here so hotkeys do not fire behind the lock. */
	keymap: Keymap;
}

type Mode = "off" | "cover" | "locked" | "preview";

const FONT_STACKS: Record<Exclude<FontStyle, "auto">, string> = {
	sans: 'var(--font-interface, system-ui, sans-serif)',
	serif: '"New York", "Iowan Old Style", Georgia, "Noto Serif KR", "Noto Serif CJK KR", serif',
	mono: '"SF Mono", Menlo, Consolas, "D2Coding", monospace',
	rounded: '"SF Pro Rounded", "Hiragino Maru Gothic ProN", Nunito, Quicksand, system-ui, sans-serif',
};

const UNLOCK_MS = 520; // padlock opens (360 ms), then the screen fades (260 ms, overlapping)

const POINTER_KINDS: AnimationKind[] = ["glow", "trail", "orbs"];

/** A text field the person is typing in (e.g. the to-do input): printable keys belong to it, not to the hidden password field. */
function isFormControl(el: Element | null): boolean {
	if (!el) return false;
	if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
	return el.tagName === "INPUT" && !["checkbox", "radio", "button", "submit"].includes((el as HTMLInputElement).type);
}

/** Themes that draw their padlock as pixel art instead of the icon set's line icon. */
const PIXEL_LOCKS: Partial<Record<Theme, PixelPalette>> = {
	win95: { o: "#000000", s: "#808080", f: "#c0c0c0", k: "#000000" },
	"folder-runner": { o: "#d1d5db", s: "#6b7280", f: "#f3f4f6", k: "#374151" },
	"gameboy-snake": { o: "#9bbc0f", s: "#5f7f1a", f: "#8bac0f", k: "#1b3220" },
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const rnd = (min: number, max: number) => min + Math.random() * (max - min);

/** "wed nov 25 16:30": the fake "last login" line of the terminal theme. English and lower case on purpose. */
function loginStamp(d: Date): string {
	const wd = d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
	const mon = d.toLocaleDateString("en-US", { month: "short" }).toLowerCase();
	const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	return `${wd} ${mon} ${d.getDate()} ${hm}`;
}

function newId(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** One overlay per window document. */
/** The part of the card that the sliding to-do panel never covers while the password field is hidden. */
const REVEAL_HOVER_ZONE = 64;

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
	private readonly keyScope: Scope;
	private readonly onWinFocus: () => void;
	private scopePushed = false;
	private deniedTimer = 0;
	private fx: PointerFx | null = null;
	private theme: Theme = "default";
	private unlockLabel = "";
	private recoveryOn = false;
	private forgotBtn!: HTMLButtonElement;
	private baseTitle = "";
	private unlockedTitle = "";
	private readonly chromeTitleEl: HTMLElement;
	private readonly loginEl: HTMLElement; // terminal theme: "last login: ..." line
	/** Where a theme's offline game draws (empty and hidden for the other themes). */
	readonly gameEl: HTMLElement;
	/** Windows 95 wallpaper icons (decoration). Empty and hidden in every other theme. */
	private readonly desktopEl: HTMLElement;
	private host: GameHost | null = null; // the running offline game of a game theme, if any
	private gameId: GameId | null = null;
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
			submit: (pw: string, kind: SubmitKind) => void;
			closePreview: () => void;
			highScore: (game: GameId, score: number) => void;
			addTodo: (text: string) => void;
			toggleTodo: (id: string) => void;
			deleteTodo: (id: string) => void;
		},
		private readonly keymap: Keymap,
	) {
		this.win = doc.defaultView ?? window;
		const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] => {
			const e = createEl(tag);
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
		this.unlockLabel = t.unlock;
		this.baseTitle = t.lockedTitle;
		this.unlockedTitle = t.unlocked;
		// "$ password:" shown only by the terminal theme, in front of the field; decorative.
		const prompt = el("span", "vault-lock-prompt");
		prompt.setAttribute("aria-hidden", "true");
		prompt.textContent = "$ password:";
		form.append(prompt, input, button);
		form.addEventListener("submit", (e) => {
			e.preventDefault();
			handlers.submit(input.value, this.recoveryOn ? "recovery" : "password");
		});

		const message = (this.message = el("div", "vault-lock-message"));
		message.setAttribute("aria-live", "polite");
		this.hint = el("div", "vault-lock-hint");
		this.hint.textContent = t.previewClose;
		const forgot = (this.forgotBtn = el("button", "vault-lock-forgot"));
		forgot.type = "button";
		forgot.textContent = t.forgot;
		forgot.addEventListener("click", () => {
			this.setRecovery(!this.recoveryOn);
			input.value = "";
			this.syncTyped();
			input.focus({ preventScroll: true });
		});
		card.append(icon, title, form, forgot, message, this.hint);

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

		// Window chrome of the Windows 95 / terminal / default themes: three dots, a title, three window buttons.
		// All decorative (the grip strip on top moves the window); each theme shows only the parts it needs.
		const chrome = el("div", "vault-lock-chrome");
		chrome.setAttribute("aria-hidden", "true");
		const dots = el("span", "vl-dots");
		for (let n = 0; n < 3; n++) dots.append(el("i", "vl-dot"));
		const chromeTitle = (this.chromeTitleEl = el("span", "vl-chrome-title"));
		const winBtns = el("span", "vl-winbtns");
		for (const k of ["min", "max", "close"]) winBtns.append(el("i", `vl-winbtn vl-wb-${k}`));
		chrome.append(dots, chromeTitle, winBtns);

		// Terminal theme: a few lines of fake log above the prompt.
		const log = el("div", "vault-lock-log");
		log.setAttribute("aria-hidden", "true");
		this.loginEl = el("div", "vl-log-line");
		const l2 = el("div", "vl-log-line");
		l2.textContent = "[vault] status: locked";
		const l3 = el("div", "vl-log-line");
		l3.textContent = "[system] lockscape ready";
		log.append(this.loginEl, l2, l3);

		this.gameEl = el("div", "vault-lock-game");

		const hint = el("div", "vault-lock-cover-hint");
		hint.textContent = t.hideHint;
		stage.append(chrome, this.clockEl, log, this.gameEl, card, hint, this.todosEl);
		// The overlay covers Obsidian's own title bar, which is what drags a frameless window. A transparent strip of the
		// same height gives the grip back (only where the window is frameless; see styles.css), so the shrunk lock window can be moved.
		const drag = el("div", "vault-lock-drag");
		drag.setAttribute("aria-hidden", "true");
		this.desktopEl = el("div", "vault-lock-desktop");
		this.desktopEl.setAttribute("aria-hidden", "true");
		root.append(this.bg, this.anim, this.desktopEl, stage, drag);

		// Keep keystrokes from reaching Obsidian's hotkey handling while locked.
		root.addEventListener("keydown", (e) => {
			if (root.classList.contains("is-manual") ? ["Escape", "Enter", " "].includes(e.key) : e.key === "Escape" && root.classList.contains("is-preview")) handlers.closePreview();
			e.stopPropagation();
			// Hidden password field: the first printable key moves focus into it, and the browser then
			// types that very key into the field (focus changes during keydown still receive the input).
			if (
				root.classList.contains("hover-reveal") &&
				!root.classList.contains("is-preview") &&
				!root.classList.contains("is-cover") &&
				doc.activeElement !== input &&
				!isFormControl(doc.activeElement) &&
				e.key.length === 1 &&
				!e.ctrlKey &&
				!e.metaKey &&
				!e.altKey
			) {
				input.focus({ preventScroll: true });
			}
		});
		// Obsidian reads hotkeys in a capture listener on `window`, so it runs before any handler on this overlay
		// (stopPropagation above is too late). Pushing our own scope with no parent makes it the only one consulted:
		// every key aimed outside the overlay is swallowed (new note, command palette, keys of an open dialog),
		// while typing into the overlay's own fields passes through untouched.
		this.keyScope = new Scope();
		this.keyScope.register(null, null, (e) => {
			if (this.root.contains(e.target as Node | null)) return undefined;
			this.root.focus({ preventScroll: true }); // focus had left the overlay; the next key lands inside again
			return false;
		});
		// Tab past the last control lands on the (inert) page behind: bring focus back right away.
		root.addEventListener("focusout", (e) => {
			const to = e.relatedTarget as Node | null;
			if (to && root.contains(to)) return;
			this.win.setTimeout(() => {
				if (root.isConnected && doc.hasFocus() && !root.contains(doc.activeElement)) root.focus({ preventScroll: true });
			}, 0);
		});
		// A popout only becomes Obsidian's active window when it gains focus, and the scope goes on the active window's stack.
		this.onWinFocus = () => {
			this.pushKeyScope();
			this.win.setTimeout(() => this.pushKeyScope(), 0);
		};
		this.win.addEventListener("focus", this.onWinFocus);
		// Touch has no hover: tapping the lock area focuses the (hidden) field, which reveals it and opens the keyboard.
		card.addEventListener("pointerdown", (e) => {
			if (e.pointerType !== "touch" || !root.classList.contains("hover-reveal")) return;
			if (!(e.target as Element).closest(".vault-lock-form")) input.focus({ preventScroll: true });
		});
		// Preview mode: click on the backdrop (not on the to-do panel) closes it.
		root.addEventListener("click", (e) => {
			if (!root.classList.contains("is-preview") && !root.classList.contains("is-manual")) return;
			// composedPath() is fixed when the click starts. Using e.target.closest() would misfire when a
			// handler (e.g. delete) re-renders the list and detaches the clicked button before this runs.
			const path = e.composedPath();
			if (path.includes(this.todosEl) || path.includes(this.gameEl)) return; // clicking the game plays it
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

		// Hidden password field: how far the to-dos may slide up into the empty space under the title (see styles.css).
		// At least REVEAL_HOVER_ZONE px at the top of the card stay uncovered, so there is always something to hover.
		const RO = (this.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
		this.slotObserver = RO
			? new RO(() => {
					const keep = Math.max(form.offsetTop - card.offsetTop, REVEAL_HOVER_ZONE);
					root.style.setProperty("--vl-reveal-shift", `${Math.max(card.offsetHeight - keep, 0)}px`);
				})
			: null;
		this.slotObserver?.observe(form);
		this.slotObserver?.observe(card);
		// Typed text keeps a hidden field visible wherever the focus goes; the to-dos must not slide over it then.
		input.addEventListener("input", () => this.syncTyped());

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
		this.pushKeyScope();
		this.observer.observe(body, { childList: true });
		this.onViewport?.();
	}

	private enforce(): void {
		const body = this.doc.body;
		if (!this.root.isConnected) body.append(this.root);
		let added = false;
		for (const child of Array.from(body.children)) {
			if (child === this.root || this.inerted.has(child)) continue;
			added = true;
			if ((child as HTMLElement).inert) continue; // was already inert; leave it alone
			(child as HTMLElement).inert = true;
			this.inerted.add(child);
		}
		// A dialog that opened after we locked pushed its own key scope on top of ours; take the top back.
		if (added) this.pushKeyScope();
	}

	/** Make our scope the top of this window's scope stack. Does nothing for a window Obsidian does not consider active. */
	private pushKeyScope(): void {
		if (!this.root.isConnected || this.win !== activeWindow) return;
		if (this.scopePushed) this.keymap.popScope(this.keyScope);
		this.keymap.pushScope(this.keyScope);
		this.scopePushed = true;
	}

	private popKeyScope(): void {
		if (!this.scopePushed) return;
		this.scopePushed = false;
		this.keymap.popScope(this.keyScope);
	}

	/** The padlock: pixel art for the themes that have it, the icon set's line icon otherwise. */
	private drawIcon(open: boolean): void {
		const pixel = PIXEL_LOCKS[this.theme];
		if (pixel) {
			this.iconEl.replaceChildren(pixelLock(this.doc, open, pixel));
			return;
		}
		setIcon(this.iconEl, open ? "lock-open" : "lock");
		if (open && !this.iconEl.querySelector("svg")) setIcon(this.iconEl, "unlock"); // older icon set
	}

	/** Undo setUnlocking() when the screen is locked again before it went away. */
	cancelUnlocking(): void {
		this.root.classList.remove("is-unlocking");
		this.titleEl.textContent = this.baseTitle;
		this.drawIcon(false);
		this.setBusy(false);
	}

	/** Success feedback: the padlock opens and the text says so; the caller removes the overlay shortly after. */
	setUnlocking(): void {
		this.root.classList.add("is-unlocking");
		this.host?.freeze(); // the last frame stays for the fade; nothing runs or listens any more
		this.input.disabled = true;
		this.button.disabled = true;
		this.drawIcon(true);
		this.titleEl.textContent = this.unlockedTitle;
		this.button.textContent = "✓"; // not "checking…" any more; the label is restored by detach() -> setBusy(false)
	}

	/** Wrong password: the card shakes once. */
	setDenied(): void {
		const r = this.root;
		r.classList.remove("is-denied", "is-error");
		void r.offsetWidth; // restart the animation if it is still running
		r.classList.add("is-denied", "is-error");
		this.win.clearTimeout(this.deniedTimer);
		this.deniedTimer = this.win.setTimeout(() => r.classList.remove("is-denied", "is-error"), 350); // = the 0.35 s shake in styles.css
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
		this.root.classList.remove("is-denied", "is-error", "is-unlocking");
		if (this.iconEl.querySelector("svg") && this.root.isConnected) this.drawIcon(false); // back to the closed padlock
		this.fx?.destroy();
		this.fx = null;
		this.disposeGame(); // frame loop, key and pointer listeners, canvas: gone with the screen
		this.clearVideo(); // free the decoder while nothing is shown; re-created on the next show
		this.observer.disconnect();
		this.popKeyScope();
		for (const el of this.inerted) (el as HTMLElement).inert = false;
		this.inerted.clear();
		this.root.remove();
		this.root.style.removeProperty("top");
		this.root.style.removeProperty("height");
		this.input.value = "";
		this.syncTyped();
		this.setBusy(false);
		this.setMessage("");
	}

	destroy(): void {
		this.detach();
		this.slotObserver?.disconnect();
		this.win.removeEventListener("focus", this.onWinFocus);
		this.doc.removeEventListener("visibilitychange", this.onVis);
		const vv = this.win.visualViewport;
		if (vv && this.onViewport) {
			vv.removeEventListener("resize", this.onViewport);
			vv.removeEventListener("scroll", this.onViewport);
		}
	}

	/** Switch the field between password entry and recovery-key entry ("Forgot your password?"). */
	setRecovery(on: boolean): void {
		this.recoveryOn = on;
		this.root.classList.toggle("is-recovery", on);
		this.refreshLabels();
	}

	/** Placeholder, accessible name, button text and link text for the current entry kind. Themes may reword the password ones. */
	private refreshLabels(): void {
		const busy = this.root.classList.contains("is-busy") || this.root.classList.contains("is-unlocking");
		if (this.recoveryOn) {
			this.input.placeholder = this.t.recoverPlaceholder;
			this.input.setAttribute("aria-label", this.t.recoverPlaceholder);
			this.input.autocapitalize = "characters";
			if (!busy) this.button.textContent = this.t.recoverUnlock;
			this.forgotBtn.textContent = this.t.backToPassword;
		} else {
			this.input.setAttribute("aria-label", this.t.placeholder);
			this.input.autocapitalize = "off";
			if (!busy) this.button.textContent = this.unlockLabel;
			this.forgotBtn.textContent = this.t.forgot;
			const text = THEME_TEXT[this.theme];
			this.input.placeholder = text.placeholder === "none" ? " " : text.placeholder === "english" ? "password" : this.t.placeholder;
		}
	}

	setMode(mode: Mode, manual = false): void {
		const cover = mode === "cover";
		const preview = mode === "preview";
		this.root.classList.toggle("is-manual", cover && manual);
		this.root.classList.toggle("is-cover", cover);
		this.root.classList.toggle("is-preview", preview);
		this.input.disabled = cover || preview;
		this.button.disabled = cover || preview;
		// The game runs only while the screen is really up (locked or previewed), never under the grace-period cover.
		this.host?.setActive(mode === "locked" || preview);
	}

	/** Another window's game set a new best: this window's game shows it too. */
	setHighScore(game: GameId, score: number): void {
		if (this.gameId === game) this.host?.setHighScore(score);
	}

	/** Start the game of a game theme, stop and remove the previous one when the theme changed. */
	private syncGame(a: Appearance): void {
		const id = gameOf(a.theme);
		if (id === this.gameId) {
			if (id) this.host?.setHighScore(a.highScores[id]);
			return;
		}
		this.disposeGame();
		if (!id) return;
		this.gameId = id;
		this.host = new GameHost(createGame(id), {
			doc: this.doc,
			win: this.win,
			mount: this.gameEl,
			root: this.root,
			highScore: a.highScores[id],
			onHighScore: (score) => this.handlers.highScore(id, score),
			focusField: () => {
				if (this.input.disabled) return false;
				this.input.focus({ preventScroll: true });
				return this.doc.activeElement === this.input;
			},
		});
	}

	private disposeGame(): void {
		this.host?.destroy();
		this.host = null;
		this.gameId = null;
		this.gameEl.replaceChildren();
	}

	/** Apply the cosmetic settings: background, animation, text, clock, layout and widgets. */
	applyAppearance(a: Appearance, todos: Todo[]): void {
		this.setImage(a.imageUrl);
		this.setVideo(a.videoUrl);

		const r = this.root;
		this.theme = a.theme;
		const game = gameOf(a.theme);
		const text = THEME_TEXT[a.theme];
		r.dataset.theme = a.theme;
		r.classList.toggle("is-game", game !== null);
		this.syncGame(a);
		// the wallpaper icons exist only while the Windows 95 theme is on
		if (a.theme === "win95") {
			if (this.desktopEl.childElementCount === 0) buildDesktop(this.doc, this.desktopEl);
		} else if (this.desktopEl.childElementCount > 0) this.desktopEl.replaceChildren();
		// The game themes keep the field visible: Space and the arrow keys belong to the game, not to "press any key".
		r.classList.toggle("hover-reveal", a.hoverReveal && game === null);
		this.unlockLabel = text.unlock ?? this.t.unlock;
		this.unlockedTitle = text.unlocked ?? this.t.unlocked;
		this.baseTitle = text.title ?? this.t.lockedTitle;
		if (!this.root.classList.contains("is-unlocking")) this.drawIcon(false);
		this.input.placeholder = text.placeholder === "none" ? " " : text.placeholder === "english" ? "password" : this.t.placeholder;
		this.chromeTitleEl.textContent = a.theme === "win95" ? "Lockscape" : a.theme === "terminal" ? "lockscape — zsh" : "";
		r.classList.toggle("has-recovery", a.hasRecovery);
		if (!a.hasRecovery && this.recoveryOn) this.setRecovery(false);
		this.refreshLabels();
		r.classList.toggle("title-auto", a.titleMode === "auto");
		r.classList.toggle("title-hide", a.titleMode === "hide");
		r.classList.toggle("custom-title", a.customTitle !== "");
		r.classList.toggle("no-icon", !a.showIcon);
		r.classList.toggle("pos-top", a.position === "top");
		r.classList.toggle("pos-bottom", a.position === "bottom");
		r.classList.toggle("shape-round", a.fieldShape === "rounded");
		r.classList.toggle("shape-pill", a.fieldShape === "pill");
		r.classList.toggle("shape-square", a.fieldShape === "square");
		this.titleEl.textContent = a.customTitle || this.baseTitle; // textContent only: never parsed as HTML

		// Public CSS variables (also documented for Obsidian CSS snippets). Unset = automatic.
		const setVar = (name: string, value: string) =>
			value ? r.style.setProperty(name, value) : r.style.removeProperty(name);
		setVar("--vl-text", a.textColor);
		setVar("--vl-accent", a.accentColor);
		// text on a button painted with the chosen accent: white on dark colours, near-black on bright ones
		const accentRgb = a.accentColor ? resolveColor(this.doc, a.accentColor) : null;
		setVar("--vl-on-accent", accentRgb ? inkFor(accentRgb) : "");
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
		this.lastTime = this.lastDate = "";
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
		const probe = createEl("img");
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
			if (!reduced && !this.doc.hidden) void this.video.play().catch(() => undefined);
			return;
		}
		this.clearVideo();
		this.videoUrl = url;
		if (!url) {
			this.updateMedia();
			return;
		}
		const v = createEl("video");
		v.className = "vault-lock-video";
		v.muted = true; // required for autoplay; the lock screen never plays sound
		v.loop = true;
		v.playsInline = true;
		v.autoplay = !reduced && !this.doc.hidden; // reduced motion or a hidden window: show the first frame, do not play
		v.preload = "auto";
		v.controls = false;
		v.disablePictureInPicture = true;
		v.setAttribute("aria-hidden", "true");
		v.addEventListener("loadeddata", () => {
			if (this.videoUrl !== url) return;
			this.videoAutoDim = this.legibilityDim(v);
			this.videoLoaded = true;
			this.updateMedia();
			if (!reduced && !this.doc.hidden) void v.play().catch(() => undefined);
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
			const canvas = createEl("canvas");
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
				const palette4 = [...colors, colors[0]];
				this.fx = new PointerFx(this.doc, this.win, this.anim, a.animation as PointerFxKind, palette4);
			}
			return;
		}
		colors.forEach((c, i) => this.anim.style.setProperty(`--vl-c${i + 1}`, c));
		const area = this.win.innerWidth * this.win.innerHeight;
		const add = (tag: "b" | "i", vars: Record<string, string>) => {
			const e = createEl(tag);
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

	/** The time as text, or (Windows 95) digits and colons as pixel art with the rest, such as "오후", left as text. */
	private drawTime(time: string): void {
		if (this.theme !== "win95") {
			this.timeEl.textContent = time;
			this.timeEl.removeAttribute("role");
			this.timeEl.removeAttribute("aria-label");
			return;
		}
		const parts = runsOf(time).map((run) => {
			if (run.pixel) return pixelSvg(this.doc, run.text);
			const span = createSpan();
			span.className = "vl-px-text";
			span.textContent = run.text;
			return span;
		});
		this.timeEl.replaceChildren(...parts);
		// the drawn digits are hidden from screen readers; the element says the real time
		this.timeEl.setAttribute("role", "img");
		this.timeEl.setAttribute("aria-label", time);
	}

	updateClock(now: Date): void {
		if (!this.timeFmt || !this.dateFmt) return;
		const time = this.timeFmt.format(now);
		if (time !== this.lastTime) {
			this.lastTime = time;
			this.drawTime(time);
			if (this.theme === "terminal") this.loginEl.textContent = `last login: ${loginStamp(now)}`;
		}
		const date = this.dateFmt.format(now);
		if (date !== this.lastDate) {
			this.lastDate = date;
			this.dateEl.textContent = date;
		}
	}

	renderTodos(todos: Todo[]): void {
		const rows = todos.map((todo) => {
			const row = createDiv();
			row.className = "vault-lock-todo" + (todo.done ? " is-done" : "");
			const label = createEl("label");
			label.className = "vault-lock-todo-label";
			const box = createEl("input");
			box.type = "checkbox";
			box.checked = todo.done;
			box.addEventListener("change", () => this.handlers.toggleTodo(todo.id));
			const text = createSpan();
			text.textContent = todo.text; // textContent only: user text is never parsed as HTML
			label.append(box, text);
			const del = createEl("button");
			del.type = "button";
			del.className = "vault-lock-todo-btn";
			del.setAttribute("aria-label", this.t.todoDelete);
			setIcon(del, "x");
			del.addEventListener("click", () => this.handlers.deleteTodo(todo.id));
			row.append(label, del);
			return row;
		});
		this.todoList.replaceChildren(...rows);
		this.todosEl.classList.toggle("is-short", todos.length <= 1);
		const addForm = this.todosEl.querySelector<HTMLElement>(".vault-lock-todo-add");
		addForm?.classList.toggle("is-off", todos.length >= MAX_TODOS);
	}

	syncTyped(): void {
		this.root.classList.toggle("has-typed", this.input.value !== "");
	}

	setMessage(text: string): void {
		this.message.textContent = text;
		this.root.classList.toggle("has-message", text !== ""); // keeps a hidden field visible while a message shows
	}

	setBusy(busy: boolean): void {
		this.root.classList.toggle("is-busy", busy);
		this.input.disabled = busy;
		this.button.disabled = busy;
		this.button.textContent = busy ? this.t.checking : this.recoveryOn ? this.t.recoverUnlock : this.unlockLabel;
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
	/** The cover was asked for ("hide screen" command), not caused by leaving the app: a click or Esc takes it away, no password. */
	private manual = false;
	private views = new Map<Document, OverlayView>();
	private countdown: number | null = null;
	private clockTimer: number | null = null;
	private busy = false;
	private unlockTimer = 0;
	private unlocking = false;
	/** Where the keyboard focus was in each window before the overlay took over; given back when it goes away. */
	private readonly savedFocus = new Map<Document, HTMLElement>();

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

	get isManualCover(): boolean {
		return this.mode === "cover" && this.manual;
	}

	get isPreviewing(): boolean {
		return this.mode === "preview";
	}

	/** Hide content immediately without asking for a password (grace period running). */
	cover(): void {
		if (this.mode === "locked") return;
		this.rememberFocus();
		this.mode = "cover";
		this.render();
	}

	/** Hide the screen at once (before sharing it, say). No password: a click or Esc shows it again. */
	hideScreen(): void {
		if (this.mode === "locked" || this.mode === "preview") return;
		this.rememberFocus();
		this.manual = true;
		this.mode = "cover";
		this.render();
		window.setTimeout(() => {
			if (!this.isManualCover) return;
			for (const v of this.views.values()) if (v.doc.hasFocus()) v.focusRoot();
		}, 50);
	}

	lock(): void {
		this.manual = false;
		// Locked again while the padlock was still opening: cancel the pending release, or it would unlock us.
		if (this.unlocking) {
			window.clearTimeout(this.unlockTimer);
			this.unlocking = false;
			this.busy = false;
			this.eachView((v) => v.cancelUnlocking());
		}
		this.rememberFocus();
		this.mode = "locked";
		this.notifyLock();
		this.notifyWindow(true);
		this.render();
		this.eachView((v) => v.setRecovery(false));
		this.startCountdown();
		// With a hidden password field, focus the overlay (not the field) so it is not revealed unasked.
		// A game theme also starts on the overlay: the game is ready to play and Tab goes to the field.
		const ap = this.hooks.getAppearance();
		const preferInput = !ap.hoverReveal && gameOf(ap.theme) === null;
		window.setTimeout(() => this.focusActive(preferInput), 50);
	}

	/** Show the lock screen without locking, so appearance settings can be judged. Click/Esc closes it. */
	preview(): void {
		if (this.mode === "locked") return;
		this.rememberFocus();
		this.mode = "preview";
		this.notifyWindow(true);
		this.render();
		window.setTimeout(() => {
			if (this.mode !== "preview") return;
			for (const v of this.views.values()) if (v.doc.hasFocus()) v.focusRoot();
		}, 50);
	}

	release(): void {
		this.manual = false;
		window.clearTimeout(this.unlockTimer);
		this.unlocking = false;
		this.mode = "off";
		this.stopCountdown();
		this.stopClock();
		for (const view of this.views.values()) view.detach();
		this.notifyWindow(false);
		this.restoreFocus();
	}

	/** Remember the focused element of every window, but only when the overlay is not already up (cover -> locked keeps the first). */
	private rememberFocus(): void {
		if (this.mode !== "off") return;
		this.savedFocus.clear();
		for (const doc of this.hooks.getDocuments()) {
			const el = doc.activeElement as HTMLElement | null;
			if (el && el !== doc.body && el !== doc.documentElement) this.savedFocus.set(doc, el);
		}
	}

	private restoreFocus(): void {
		for (const [doc, el] of this.savedFocus) {
			if (el.isConnected && typeof el.focus === "function" && doc.hasFocus()) el.focus({ preventScroll: true });
		}
		this.savedFocus.clear();
	}

	destroy(): void {
		window.clearTimeout(this.unlockTimer);
		const wasShowing = this.mode !== "off";
		this.savedFocus.clear();
		this.mode = "off";
		if (wasShowing) this.notifyWindow(false);
		this.stopCountdown();
		this.stopClock();
		for (const view of this.views.values()) view.destroy();
		this.views.clear();
	}

	/** Closing the owner's open dialogs is best effort; the lock screen must come up even if it throws. */
	private notifyLock(): void {
		try {
			this.hooks.onLock();
		} catch {
			/* the key scope already blocks the dialog's keys */
		}
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
					submit: (pw, kind) => void this.handleSubmit(pw, kind),
					closePreview: () => {
						if (this.mode === "preview" || this.manual) this.release();
					},
					highScore: (game, score) => {
						this.hooks.onHighScore(game, score);
						this.eachView((v) => v.setHighScore(game, score));
					},
					addTodo: (text) => this.editTodos((list) => {
						if (list.length < MAX_TODOS) list.push({ id: newId(), text: clipChars(text, MAX_TODO_LENGTH), done: false });
					}),
					toggleTodo: (id) => this.editTodos((list) => {
						const item = list.find((x) => x.id === id);
						if (item) item.done = !item.done;
					}),
					deleteTodo: (id) => this.editTodos((list) => {
						const i = list.findIndex((x) => x.id === id);
						if (i >= 0) list.splice(i, 1);
					}),
				}, this.hooks.keymap);
				this.views.set(doc, view);
			}
			view.applyAppearance(appearance, todos);
			view.attach();
			view.setMode(this.mode, this.manual);
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

	private async handleSubmit(password: string, kind: SubmitKind): Promise<void> {
		if (this.busy || this.mode !== "locked") return;
		if (password === "") return; // an empty Enter is not an attempt and must not count as a failure
		this.busy = true;
		this.eachView((v) => v.setBusy(true));
		let result: UnlockResult;
		try {
			result = await this.hooks.submit(password, kind);
		} catch {
			result = { ok: false, message: this.t.cryptoError };
		}
		if (result.ok) {
			this.stopCountdown();
			this.unlocking = true;
			this.eachView((v) => v.setUnlocking());
			// let the padlock open before the overlay goes away; reduced motion skips the wait
			const wait = this.prefersReducedMotion() ? 0 : UNLOCK_MS;
			this.unlockTimer = window.setTimeout(() => {
				this.unlocking = false;
				this.busy = false;
				this.release();
				this.hooks.onUnlocked(kind);
			}, wait);
			return;
		}
		this.busy = false;
		this.eachView((v) => {
			v.setBusy(false);
			v.input.value = "";
			v.syncTyped();
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
