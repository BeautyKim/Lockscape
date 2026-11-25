import { App, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	VIDEO_EXTS,
	backgroundPath,
	chooseBackground,
	chooseVideo,
	removeBackground,
	removeVideo,
	videoPath,
	type VideoExt,
} from "./background";
import { cleanHex } from "./color";
import { Credential, createCredential, cryptoAvailable, isCredential, verifyPassword } from "./crypto";
import { detectTag, fmt, getStrings, type Strings } from "./i18n";
import {
	WINDOW_SIZES,
	WINDOW_SIZE_NAMES,
	isSavedWindow,
	restoreWindow,
	shrinkWindow,
	windowResizeSupported,
	type SavedWindow,
	type WindowSizeName,
} from "./windowSize";
import {
	LockScreen,
	MAX_TODOS,
	MAX_TODO_LENGTH,
	type Appearance,
	type AnimationKind,
	type ClockFormat,
	type FieldShape,
	type FontStyle,
	type Position,
	type Theme,
	type TitleMode,
	type Todo,
	type UnlockResult,
} from "./lockscreen";

const MIN_PASSWORD_LENGTH = 8;
const FREE_ATTEMPTS = 5; // wrong guesses before back-off starts
const BACKOFF_BASE_MS = 30_000; // doubles per further failure
const BACKOFF_MAX_MS = 15 * 60_000;

type BackgroundKind = "none" | "image" | "video";

interface Settings {
	settingsVersion: number; // 2 = theme-aware defaults for clock font and field shape
	credential: Credential | null;
	lockOnStartup: boolean;
	idleMinutes: number; // 0 = off
	lockOnHide: boolean;
	graceSeconds: number; // 0 = immediately
	failCount: number;
	retryAt: number; // epoch ms
	// appearance
	theme: Theme;
	backgroundKind: BackgroundKind;
	hasBackground: boolean; // an image file exists at backgroundPath()
	hasVideo: boolean; // a video file exists at videoPath(videoExt)
	videoExt: VideoExt;
	dim: number; // 0-80
	blur: number; // 0-20
	animation: AnimationKind;
	showClock: boolean;
	showSeconds: boolean;
	showDate: boolean;
	clockFormat: ClockFormat;
	showTodos: boolean;
	todos: Todo[];
	hoverReveal: boolean;
	titleMode: TitleMode;
	customTitle: string;
	showIcon: boolean;
	position: Position;
	fieldShape: FieldShape;
	clockScale: number; // 60-160
	clockFont: FontStyle;
	clockWeight: number; // 100-700
	textColor: string; // "" = automatic
	accentColor: string; // "" = theme accent
	// desktop only: shrink the app window while locked
	shrinkOnLock: boolean;
	lockWindowSize: WindowSizeName;
	savedWindow: SavedWindow | null; // set while the window is shrunk; survives a quit-while-locked
}

const DEFAULTS: Settings = {
	settingsVersion: 2,
	credential: null,
	lockOnStartup: true,
	idleMinutes: 10,
	lockOnHide: true,
	graceSeconds: 30,
	failCount: 0,
	retryAt: 0,
	theme: "default",
	backgroundKind: "none",
	hasBackground: false,
	hasVideo: false,
	videoExt: "mp4",
	dim: 35,
	blur: 0,
	animation: "none",
	showClock: true,
	showSeconds: false,
	showDate: true,
	clockFormat: "auto",
	showTodos: false, // off by default: the list is visible without the password
	todos: [],
	hoverReveal: false,
	titleMode: "auto",
	customTitle: "",
	showIcon: true,
	position: "center",
	fieldShape: "auto",
	clockScale: 100,
	clockFont: "auto",
	clockWeight: 300,
	textColor: "",
	accentColor: "",
	shrinkOnLock: false,
	lockWindowSize: "small",
	savedWindow: null,
};

const IDLE_CHOICES = [0, 1, 5, 10, 15, 30, 60];
const GRACE_CHOICES = [0, 15, 30, 60, 300];
const THEMES: Theme[] = ["default", "retro", "cartoon"];
const ANIMATIONS: AnimationKind[] = ["none", "aurora", "fireflies", "snow", "glow", "trail", "orbs"];
const BACKGROUND_KINDS: BackgroundKind[] = ["none", "image", "video"];
const POSITIONS: Position[] = ["top", "center", "bottom"];
const FONT_STYLES: FontStyle[] = ["auto", "sans", "serif", "mono", "rounded"];
const FIELD_SHAPES: FieldShape[] = ["auto", "rounded", "pill", "square"];
/** Names used before the redesign of the built-in animations. */
const LEGACY_ANIMATIONS: Record<string, AnimationKind> = { gradient: "aurora", bubbles: "fireflies" };

/** The cosmetic settings that "Reset appearance" restores. Password, to-dos, window options and files are untouched. */
const APPEARANCE_KEYS = [
	"theme", "backgroundKind", "dim", "blur", "animation", "showClock", "showSeconds", "showDate", "clockFormat", "clockScale",
	"clockFont", "clockWeight", "hoverReveal", "titleMode", "customTitle", "showIcon", "position", "fieldShape",
	"textColor", "accentColor", "showTodos",
] as const;
const CLOCK_FORMATS: ClockFormat[] = ["auto", "24", "12"];
const TITLE_MODES: TitleMode[] = ["auto", "show", "hide"];

function num(v: unknown, fallback: number, min: number, max: number): number {
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
	return typeof v === "boolean" ? v : fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
	return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** data.json is user-editable and synced, so treat it as untrusted input. */
function cleanTodos(v: unknown): Todo[] {
	if (!Array.isArray(v)) return [];
	const out: Todo[] = [];
	for (const x of v) {
		if (out.length >= MAX_TODOS) break;
		if (typeof x !== "object" || x === null) continue;
		const r = x as Record<string, unknown>;
		if (typeof r.id !== "string" || typeof r.text !== "string" || r.id.length > 64) continue;
		const text = r.text.trim().slice(0, MAX_TODO_LENGTH);
		if (!text) continue;
		out.push({ id: r.id, text, done: r.done === true });
	}
	return out;
}

export default class VaultLockPlugin extends Plugin {
	settings: Settings = { ...DEFAULTS };
	t: Strings = getStrings();
	private lockScreen!: LockScreen;
	private lastActivity = Date.now();
	private hiddenAt: number | null = null;

	get hasPassword(): boolean {
		return this.settings.credential !== null;
	}

	get pluginDir(): string {
		return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
	}

	get imagePath(): string {
		return backgroundPath(this.pluginDir);
	}

	/** Local app:// resource URL of the chosen background photo, or null. Never a remote URL. */
	get imageUrl(): string | null {
		const s = this.settings;
		return s.backgroundKind === "image" && s.hasBackground ? this.app.vault.adapter.getResourcePath(this.imagePath) : null;
	}

	/** Local app:// resource URL of the chosen background video, or null. */
	get videoUrl(): string | null {
		const s = this.settings;
		return s.backgroundKind === "video" && s.hasVideo
			? this.app.vault.adapter.getResourcePath(videoPath(this.pluginDir, s.videoExt))
			: null;
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.t = getStrings();

		this.lockScreen = new LockScreen(this.t, {
			submit: (pw) => this.attemptUnlock(pw),
			getRetryAt: () => this.settings.retryAt,
			getDocuments: () => this.collectDocuments(),
			getAppearance: () => this.appearance(),
			getTodos: () => this.settings.todos,
			setTodos: (todos) => {
				this.settings.todos = todos;
				void this.saveSettings();
			},
			onWindow: (active) => this.applyWindow(active),
			onUnlocked: () => this.markActivity(),
		});

		// Lock as early as possible so notes are not visible while the workspace loads.
		if (this.hasPassword && this.settings.lockOnStartup) this.lockScreen.lock();
		// The last session ended while locked and shrunk, and we are not locking now: put the window back.
		else if (this.settings.savedWindow) this.applyWindow(false);

		this.addSettingTab(new VaultLockSettingTab(this.app, this));
		this.addCommand({ id: "lock-now", name: this.t.lockNow, callback: () => this.lockNow() });
		this.addRibbonIcon("lock", this.t.lockNow, () => this.lockNow());

		// Activity tracking for idle lock (main window + popout windows).
		this.watchActivity(window);
		this.registerEvent(
			this.app.workspace.on("window-open", (_w, win) => {
				this.watchActivity(win);
				this.lockScreen.refresh();
			}),
		);
		this.registerEvent(this.app.workspace.on("window-close", () => this.lockScreen.refresh()));
		this.registerInterval(window.setInterval(() => this.checkIdle(), 5_000));

		// Leaving the app: minimize (desktop) / app switch (mobile).
		this.registerDomEvent(document, "visibilitychange", () => this.onVisibility());
	}

	onunload(): void {
		this.lockScreen?.destroy();
	}

	lockNow(): void {
		if (!this.hasPassword) {
			new Notice(this.t.noPassword);
			return;
		}
		this.lockScreen.lock();
	}

	/** Show the lock screen without locking (works without a password set). */
	previewLock(): void {
		this.lockScreen.preview();
	}

	/** Shrink the app window while the lock screen shows; restore it when it goes away. Desktop only. */
	private applyWindow(active: boolean): void {
		if (active) {
			if (!this.settings.shrinkOnLock || !Platform.isDesktopApp) return;
			const saved = shrinkWindow(WINDOW_SIZES[this.settings.lockWindowSize], this.settings.savedWindow);
			if (saved !== this.settings.savedWindow) {
				this.settings.savedWindow = saved;
				void this.saveSettings();
			}
		} else if (this.settings.savedWindow) {
			// restored even if the option was switched off meanwhile
			restoreWindow(this.settings.savedWindow);
			this.settings.savedWindow = null;
			void this.saveSettings();
		}
	}

	private appearance(): Appearance {
		const s = this.settings;
		return {
			theme: s.theme,
			imageUrl: this.imageUrl,
			videoUrl: this.videoUrl,
			dim: s.dim,
			blur: s.blur,
			animation: s.animation,
			showClock: s.showClock,
			showSeconds: s.showSeconds,
			showDate: s.showDate,
			clockFormat: s.clockFormat,
			showTodos: s.showTodos,
			hoverReveal: s.hoverReveal,
			titleMode: s.titleMode,
			customTitle: s.customTitle,
			showIcon: s.showIcon,
			position: s.position,
			fieldShape: s.fieldShape,
			clockScale: s.clockScale,
			clockFont: s.clockFont,
			clockWeight: s.clockWeight,
			textColor: s.textColor,
			accentColor: s.accentColor,
			locale: detectTag(),
		};
	}

	// ---- unlock / rate limiting ---------------------------------------------------------

	async attemptUnlock(password: string): Promise<UnlockResult> {
		const now = Date.now();
		const cred = this.settings.credential;
		if (!cred) return { ok: true };
		if (now < this.settings.retryAt) {
			return { ok: false, message: fmt(this.t.wait, Math.ceil((this.settings.retryAt - now) / 1000)), retryAt: this.settings.retryAt };
		}
		if (!cryptoAvailable()) return { ok: false, message: this.t.cryptoError }; // fail closed

		let ok = false;
		try {
			ok = await verifyPassword(password, cred);
		} catch {
			return { ok: false, message: this.t.cryptoError };
		}

		if (ok) {
			this.settings.failCount = 0;
			this.settings.retryAt = 0;
			await this.saveSettings();
			return { ok: true };
		}

		this.settings.failCount += 1;
		if (this.settings.failCount >= FREE_ATTEMPTS) {
			const wait = Math.min(BACKOFF_BASE_MS * 2 ** (this.settings.failCount - FREE_ATTEMPTS), BACKOFF_MAX_MS);
			this.settings.retryAt = Date.now() + wait;
		}
		await this.saveSettings();
		return { ok: false, message: this.t.wrong, retryAt: this.settings.retryAt || undefined };
	}

	// ---- idle / visibility --------------------------------------------------------------

	private markActivity(): void {
		this.lastActivity = Date.now();
	}

	private watchActivity(win: Window): void {
		const bump = () => {
			if (!this.lockScreen.isLocked && !this.lockScreen.isCovering) this.markActivity();
		};
		for (const ev of ["pointerdown", "keydown", "wheel", "touchstart"]) {
			this.registerDomEvent(win, ev as keyof WindowEventMap, bump, { passive: true, capture: true });
		}
		// pointermove is noisy: sample at most once a second
		let last = 0;
		this.registerDomEvent(
			win,
			"pointermove",
			() => {
				const now = Date.now();
				if (now - last > 1000) {
					last = now;
					bump();
				}
			},
			{ passive: true, capture: true },
		);
	}

	private checkIdle(): void {
		const { idleMinutes } = this.settings;
		if (!this.hasPassword || idleMinutes <= 0 || this.lockScreen.isLocked) return;
		// Also fires right after the machine wakes from sleep, since Date.now() jumps.
		if (Date.now() - this.lastActivity >= idleMinutes * 60_000) this.lockScreen.lock();
	}

	private onVisibility(): void {
		if (!this.hasPassword || !this.settings.lockOnHide) return;
		if (document.visibilityState === "hidden") {
			if (this.lockScreen.isLocked) return;
			this.hiddenAt = Date.now();
			if (this.settings.graceSeconds === 0) this.lockScreen.lock();
			else this.lockScreen.cover(); // hide content right away (app switcher snapshot)
			return;
		}
		// visible again
		if (this.hiddenAt === null) return;
		const away = Date.now() - this.hiddenAt;
		this.hiddenAt = null;
		if (this.lockScreen.isLocked) return;
		if (away >= this.settings.graceSeconds * 1000) this.lockScreen.lock();
		else {
			this.lockScreen.release();
			this.markActivity();
		}
	}

	private collectDocuments(): Document[] {
		const docs = new Set<Document>([document]);
		this.app.workspace.iterateAllLeaves((leaf) => {
			const doc = leaf.view?.containerEl?.ownerDocument;
			if (doc) docs.add(doc);
		});
		return Array.from(docs);
	}

	// ---- settings I/O -------------------------------------------------------------------

	async loadSettings(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Partial<Record<keyof Settings, unknown>>;
		// v1 builds saved "sans" / "rounded" as *defaults* before themes existed; treat those as "theme decides".
		const v1 = typeof raw.settingsVersion !== "number" || raw.settingsVersion < 2;
		const legacyFont = v1 && raw.clockFont === "sans" && (raw.clockWeight === undefined || raw.clockWeight === 300);
		const legacyShape = v1 && raw.fieldShape === "rounded";
		this.settings = {
			settingsVersion: 2,
			theme: oneOf(raw.theme, THEMES, DEFAULTS.theme),
			credential: isCredential(raw.credential) ? raw.credential : null,
			lockOnStartup: bool(raw.lockOnStartup, DEFAULTS.lockOnStartup),
			idleMinutes: num(raw.idleMinutes, DEFAULTS.idleMinutes, 0, 24 * 60),
			lockOnHide: bool(raw.lockOnHide, DEFAULTS.lockOnHide),
			graceSeconds: num(raw.graceSeconds, DEFAULTS.graceSeconds, 0, 3600),
			failCount: num(raw.failCount, 0, 0, 1000),
			retryAt: num(raw.retryAt, 0, 0, Number.MAX_SAFE_INTEGER),
			backgroundKind: oneOf(raw.backgroundKind, BACKGROUND_KINDS, raw.hasBackground === true ? "image" : "none"),
			hasBackground: bool(raw.hasBackground, DEFAULTS.hasBackground),
			hasVideo: bool(raw.hasVideo, DEFAULTS.hasVideo),
			videoExt: oneOf(raw.videoExt, VIDEO_EXTS, DEFAULTS.videoExt),
			dim: num(raw.dim, DEFAULTS.dim, 0, 80),
			blur: num(raw.blur, DEFAULTS.blur, 0, 20),
			animation: oneOf(
				typeof raw.animation === "string" && raw.animation in LEGACY_ANIMATIONS ? LEGACY_ANIMATIONS[raw.animation] : raw.animation,
				ANIMATIONS,
				DEFAULTS.animation,
			),
			showClock: bool(raw.showClock, DEFAULTS.showClock),
			showSeconds: bool(raw.showSeconds, DEFAULTS.showSeconds),
			showDate: bool(raw.showDate, DEFAULTS.showDate),
			clockFormat: oneOf(raw.clockFormat, CLOCK_FORMATS, DEFAULTS.clockFormat),
			showTodos: bool(raw.showTodos, DEFAULTS.showTodos),
			todos: cleanTodos(raw.todos),
			hoverReveal: bool(raw.hoverReveal, DEFAULTS.hoverReveal),
			titleMode: oneOf(raw.titleMode, TITLE_MODES, DEFAULTS.titleMode),
			customTitle: typeof raw.customTitle === "string" ? raw.customTitle.trim().slice(0, 60) : "",
			showIcon: bool(raw.showIcon, DEFAULTS.showIcon),
			position: oneOf(raw.position, POSITIONS, DEFAULTS.position),
			fieldShape: legacyShape ? "auto" : oneOf(raw.fieldShape, FIELD_SHAPES, DEFAULTS.fieldShape),
			clockScale: num(raw.clockScale, DEFAULTS.clockScale, 60, 160),
			clockFont: legacyFont ? "auto" : oneOf(raw.clockFont, FONT_STYLES, DEFAULTS.clockFont),
			clockWeight: num(raw.clockWeight, DEFAULTS.clockWeight, 100, 700),
			textColor: cleanHex(raw.textColor),
			accentColor: cleanHex(raw.accentColor),
			shrinkOnLock: bool(raw.shrinkOnLock, DEFAULTS.shrinkOnLock),
			lockWindowSize: oneOf(raw.lockWindowSize, WINDOW_SIZE_NAMES, DEFAULTS.lockWindowSize),
			savedWindow: isSavedWindow(raw.savedWindow) ? raw.savedWindow : null,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

// ---- settings UI -----------------------------------------------------------------------

class VaultLockSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: VaultLockPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const t = this.plugin.t;
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		containerEl.createEl("p", { text: t.settingsInfo, cls: "setting-item-description" });

		const pw = new Setting(containerEl)
			.setName(t.password)
			.setDesc(this.plugin.hasPassword ? t.passwordSet : t.passwordNotSet);
		if (this.plugin.hasPassword) {
			pw.addButton((b) => b.setButtonText(t.changePassword).onClick(() => this.openModal("change")));
			pw.addButton((b) => b.setButtonText(t.removePassword).setWarning().onClick(() => this.openModal("remove")));
		} else {
			pw.addButton((b) => b.setButtonText(t.setPassword).setCta().onClick(() => this.openModal("set")));
		}

		new Setting(containerEl).setName(t.lockOnStartup).addToggle((c) =>
			c.setValue(s.lockOnStartup).onChange(async (v) => {
				s.lockOnStartup = v;
				await save();
			}),
		);

		new Setting(containerEl).setName(t.idle).addDropdown((c) => {
			for (const m of IDLE_CHOICES) c.addOption(String(m), m === 0 ? t.idleOff : fmt(t.minutes, m));
			c.setValue(String(s.idleMinutes)).onChange(async (v) => {
				s.idleMinutes = Number(v);
				await save();
			});
		});

		new Setting(containerEl)
			.setName(t.lockOnHide)
			.setDesc(t.lockOnHideDesc)
			.addToggle((c) =>
				c.setValue(s.lockOnHide).onChange(async (v) => {
					s.lockOnHide = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName(t.grace)
			.setDesc(t.graceDesc)
			.addDropdown((c) => {
				for (const g of GRACE_CHOICES) {
					c.addOption(String(g), g === 0 ? t.immediately : g >= 60 ? fmt(t.minutes, g / 60) : fmt(t.seconds, g));
				}
				c.setValue(String(s.graceSeconds)).onChange(async (v) => {
					s.graceSeconds = Number(v);
					await save();
				});
			});

		this.displayAppearance(containerEl, t, s, save);
	}

	private displayAppearance(containerEl: HTMLElement, t: Strings, s: Settings, save: () => Promise<void>): void {
		const doc = containerEl.ownerDocument;
		const heading = (name: string) => new Setting(containerEl).setName(name).setHeading();
		const redraw = () => this.display();

		const toggle = (name: string, get: () => boolean, set: (v: boolean) => void, desc?: string) => {
			const row = new Setting(containerEl).setName(name);
			if (desc) row.setDesc(desc);
			row.addToggle((c) =>
				c.setValue(get()).onChange(async (v) => {
					set(v);
					await save();
				}),
			);
		};
		const choice = <T extends string>(name: string, values: readonly T[], labels: Record<T, string>, get: () => T, set: (v: T) => void, after?: () => void) => {
			new Setting(containerEl).setName(name).addDropdown((c) => {
				for (const v of values) c.addOption(v, labels[v]);
				c.setValue(get()).onChange(async (v) => {
					set(oneOf(v, values, values[0]));
					await save();
					after?.();
				});
			});
		};
		const slide = (name: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void): Setting => {
			return new Setting(containerEl).setName(name).addSlider((c) =>
				c
					.setLimits(min, max, step)
					.setValue(get())
					.setDynamicTooltip()
					.onChange(async (v) => {
						set(v);
						await save();
					}),
			);
		};
		const color = (name: string, key: "textColor" | "accentColor", fallback: string) => {
			const row = new Setting(containerEl).setName(name).setDesc(s[key] || t.colorAuto);
			row.addColorPicker((c) =>
				c.setValue(s[key] || fallback).onChange(async (v) => {
					s[key] = cleanHex(v);
					row.setDesc(s[key] || t.colorAuto);
					await save();
				}),
			);
			row.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip(t.resetColor)
					.onClick(async () => {
						s[key] = "";
						await save();
						redraw();
					}),
			);
		};

		new Setting(containerEl).setName(t.appearance).setHeading();

		new Setting(containerEl)
			.setName(t.preview)
			.setDesc(t.previewDesc)
			.addButton((b) =>
				b.setButtonText(t.preview).onClick(() => {
					// On desktop the settings window sits on top; close it so the preview is visible.
					try {
						(this.app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
					} catch {
						/* not available on this version */
					}
					this.plugin.previewLock();
				}),
			);

		if (windowResizeSupported()) {
			// The size only matters when shrinking is on, so the size row stays disabled until then.
			// (syncSizeRow is defined below; the toggle callback only runs after the whole tab is built.)
			new Setting(containerEl)
				.setName(t.shrinkWindow)
				.setDesc(t.shrinkWindowDesc)
				.addToggle((c) =>
					c.setValue(s.shrinkOnLock).onChange(async (v) => {
						s.shrinkOnLock = v;
						syncSizeRow(v);
						await save();
					}),
				);
			const sizeRow = new Setting(containerEl).setName(t.lockWindowSize).addDropdown((c) => {
				for (const name of WINDOW_SIZE_NAMES) {
					const z = WINDOW_SIZES[name];
					c.addOption(name, `${z.width} × ${z.height}`);
				}
				c.setValue(s.lockWindowSize).onChange(async (v) => {
					s.lockWindowSize = oneOf(v, WINDOW_SIZE_NAMES, "small");
					await save();
				});
			});
			const syncSizeRow = (enabled: boolean) => {
				sizeRow.setDisabled(!enabled);
				sizeRow.settingEl.toggleClass("is-disabled", !enabled);
			};
			syncSizeRow(s.shrinkOnLock);
		}

		choice(
			t.theme,
			THEMES,
			{ default: t.themeDefault, retro: t.themeRetro, cartoon: t.themeCartoon },
			() => s.theme,
			(v) => (s.theme = v),
		);

		// ---- background ----
		heading(t.secBackground);
		choice(
			t.bgKind,
			BACKGROUND_KINDS,
			{ none: t.bgKindNone, image: t.bgKindImage, video: t.bgKindVideo },
			() => s.backgroundKind,
			(v) => (s.backgroundKind = v),
			redraw,
		);

		if (s.backgroundKind === "image") {
			const row = new Setting(containerEl).setName(t.bgImage).setDesc(t.bgImageDesc);
			if (s.hasBackground) {
				const thumb = row.controlEl.createEl("img", { cls: "vault-lock-thumb" });
				thumb.src = this.plugin.app.vault.adapter.getResourcePath(this.plugin.imagePath);
				thumb.alt = "";
			}
			row.addButton((b) =>
				b.setButtonText(t.chooseImage).onClick(async () => {
					try {
						if (!(await chooseBackground(this.app, this.plugin.pluginDir, doc))) return;
						s.hasBackground = true;
						await save();
						redraw();
					} catch {
						new Notice(t.imageFailed);
					}
				}),
			);
			if (s.hasBackground) {
				row.addButton((b) =>
					b.setButtonText(t.removeImage).onClick(async () => {
						await removeBackground(this.app, this.plugin.pluginDir);
						s.hasBackground = false;
						await save();
						redraw();
					}),
				);
			}
		}

		if (s.backgroundKind === "video") {
			const row = new Setting(containerEl).setName(t.bgVideo).setDesc(t.bgVideoDesc);
			row.addButton((b) =>
				b.setButtonText(t.chooseVideo).onClick(async () => {
					try {
						const ext = await chooseVideo(this.app, this.plugin.pluginDir, doc);
						if (!ext) return;
						s.hasVideo = true;
						s.videoExt = ext;
						await save();
						redraw();
					} catch {
						new Notice(t.videoFailed);
					}
				}),
			);
			if (s.hasVideo) {
				row.addButton((b) =>
					b.setButtonText(t.removeImage).onClick(async () => {
						await removeVideo(this.app, this.plugin.pluginDir);
						s.hasVideo = false;
						await save();
						redraw();
					}),
				);
			}
		}

		if (s.backgroundKind !== "none") {
			slide(t.dim, 0, 80, 5, () => s.dim, (v) => (s.dim = v));
			slide(t.blur, 0, 20, 1, () => s.blur, (v) => (s.blur = v));
		}

		choice(
			t.animation,
			ANIMATIONS,
			{
				none: t.animNone,
				aurora: t.animAurora,
				fireflies: t.animFireflies,
				snow: t.animSnow,
				glow: t.animGlow,
				trail: t.animTrail,
				orbs: t.animOrbs,
			},
			() => s.animation,
			(v) => (s.animation = v),
		);

		// ---- text & colors ----
		heading(t.secText);
		color(t.textColor, "textColor", "#ffffff");
		color(t.accentColor, "accentColor", "#7c5cd6");
		slide(t.clockSize, 60, 160, 5, () => s.clockScale, (v) => (s.clockScale = v));
		// The weight only applies to a chosen font; with "theme default" the theme's own typography is used.
		choice(
			t.clockFont,
			FONT_STYLES,
			{ auto: t.themeAuto, sans: t.fontSans, serif: t.fontSerif, mono: t.fontMono, rounded: t.fontRounded },
			() => s.clockFont,
			(v) => (s.clockFont = v),
			() => syncWeightRow(),
		);
		const weightRow = slide(t.clockWeight, 100, 700, 100, () => s.clockWeight, (v) => (s.clockWeight = v));
		const syncWeightRow = () => {
			weightRow.setDisabled(s.clockFont === "auto");
			weightRow.settingEl.toggleClass("is-disabled", s.clockFont === "auto");
		};
		syncWeightRow();

		new Setting(containerEl)
			.setName(t.customTitle)
			.setDesc(t.customTitleDesc)
			.addText((c) =>
				c
					.setPlaceholder(t.lockedTitle)
					.setValue(s.customTitle)
					.onChange(async (v) => {
						s.customTitle = v.trim().slice(0, 60);
						await save();
					}),
			);
		choice(
			t.showTitle,
			TITLE_MODES,
			{ auto: t.titleAuto, show: t.titleShow, hide: t.titleHide },
			() => s.titleMode,
			(v) => (s.titleMode = v),
		);

		// ---- layout & shape ----
		heading(t.secLayout);
		choice(
			t.position,
			POSITIONS,
			{ top: t.posTop, center: t.posCenter, bottom: t.posBottom },
			() => s.position,
			(v) => (s.position = v),
		);
		choice(
			t.fieldShape,
			FIELD_SHAPES,
			{ auto: t.themeAuto, rounded: t.shapeRounded, pill: t.shapePill, square: t.shapeSquare },
			() => s.fieldShape,
			(v) => (s.fieldShape = v),
		);
		toggle(t.showIcon, () => s.showIcon, (v) => (s.showIcon = v));
		toggle(t.hoverReveal, () => s.hoverReveal, (v) => (s.hoverReveal = v), t.hoverRevealDesc);

		// ---- widgets ----
		heading(t.secWidgets);
		toggle(t.showClock, () => s.showClock, (v) => (s.showClock = v));
		toggle(t.showSeconds, () => s.showSeconds, (v) => (s.showSeconds = v));
		toggle(t.showDate, () => s.showDate, (v) => (s.showDate = v));
		choice(
			t.clockFormat,
			CLOCK_FORMATS,
			{ auto: t.fmtAuto, "24": t.fmt24, "12": t.fmt12 },
			() => s.clockFormat,
			(v) => (s.clockFormat = v),
		);
		toggle(t.showTodos, () => s.showTodos, (v) => (s.showTodos = v), t.showTodosDesc);

		// ---- reset ----
		new Setting(containerEl)
			.setName(t.resetAppearance)
			.setDesc(t.resetAppearanceDesc)
			.addButton((b) =>
				b
					.setButtonText(t.resetAppearanceBtn)
					.setWarning()
					.onClick(async () => {
						for (const key of APPEARANCE_KEYS) (s as unknown as Record<string, unknown>)[key] = DEFAULTS[key];
						await save();
						redraw();
					}),
			);
	}

	private openModal(mode: "set" | "change" | "remove"): void {
		new PasswordModal(this.app, this.plugin, mode, () => this.display()).open();
	}
}

class PasswordModal extends Modal {
	private current = "";
	private next = "";
	private confirm = "";

	constructor(
		app: App,
		private readonly plugin: VaultLockPlugin,
		private readonly mode: "set" | "change" | "remove",
		private readonly onDone: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const t = this.plugin.t;
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(this.mode === "set" ? t.modalSet : this.mode === "change" ? t.modalChange : t.modalRemove);

		const field = (name: string, set: (v: string) => void) =>
			new Setting(contentEl).setName(name).addText((c) => {
				c.inputEl.type = "password";
				c.inputEl.autocomplete = "off";
				c.onChange(set);
			});

		if (this.mode !== "set") field(t.current, (v) => (this.current = v));
		if (this.mode !== "remove") {
			field(t.newPw, (v) => (this.next = v));
			field(t.confirmPw, (v) => (this.confirm = v));
		}

		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t.cancel).onClick(() => this.close()))
			.addButton((b) => b.setButtonText(t.save).setCta().onClick(() => void this.submit()));

		this.scope.register([], "Enter", () => {
			void this.submit();
			return false;
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		const t = this.plugin.t;
		if (!cryptoAvailable()) {
			new Notice(t.cryptoError);
			return;
		}
		if (this.mode !== "set") {
			const res = await this.plugin.attemptUnlock(this.current);
			if (!res.ok) {
				new Notice(res.message);
				return;
			}
		}
		if (this.mode === "remove") {
			this.plugin.settings.credential = null;
			await this.plugin.saveSettings();
			new Notice(t.removed);
		} else {
			if (this.next.length < MIN_PASSWORD_LENGTH) {
				new Notice(fmt(t.tooShort, MIN_PASSWORD_LENGTH));
				return;
			}
			if (this.next !== this.confirm) {
				new Notice(t.mismatch);
				return;
			}
			this.plugin.settings.credential = await createCredential(this.next);
			this.plugin.settings.failCount = 0;
			this.plugin.settings.retryAt = 0;
			await this.plugin.saveSettings();
			new Notice(t.saved);
		}
		this.close();
		this.onDone();
	}
}
