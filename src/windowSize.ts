import { Platform } from "obsidian";

// Optional desktop-only feature: shrink the Obsidian window while the lock screen is showing and put it
// back afterwards. Uses only the window geometry methods of Obsidian's own Electron window (no fs, no
// network, no child processes). On mobile (and if the window object is unavailable) every function is a no-op.

export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** What to put back on unlock. Persisted, so a session that ends while locked can still be undone. */
export interface SavedWindow {
	bounds: Bounds;
	maximized: boolean;
}

export const WINDOW_SIZES = {
	small: { width: 380, height: 520 },
	medium: { width: 460, height: 620 },
	large: { width: 560, height: 720 },
} as const;

export type WindowSizeName = keyof typeof WINDOW_SIZES;
export const WINDOW_SIZE_NAMES = Object.keys(WINDOW_SIZES) as WindowSizeName[];

interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface ElectronWindow {
	getBounds(): Bounds;
	getNormalBounds?(): Bounds;
	setBounds(bounds: Bounds, animate?: boolean): void;
	isMaximized(): boolean;
	isFullScreen(): boolean;
	maximize(): void;
	unmaximize(): void;
}

interface PowerMonitor {
	on(event: string, listener: () => void): unknown;
	removeListener(event: string, listener: () => void): unknown;
}

interface ElectronRemote {
	getCurrentWindow?: () => ElectronWindow;
	powerMonitor?: PowerMonitor;
	screen?: { getDisplayMatching(b: Bounds): { workArea: Rect } };
}

function remote(): ElectronRemote | null {
	try {
		const g = window as unknown as { require?: (m: string) => { remote?: ElectronRemote } | undefined };
		return g.require?.("electron")?.remote ?? null;
	} catch {
		return null;
	}
}

function electronWindow(): ElectronWindow | null {
	if (!Platform.isDesktopApp) return null;
	try {
		const direct = (window as unknown as { electronWindow?: ElectronWindow }).electronWindow;
		const w = direct ?? remote()?.getCurrentWindow?.();
		return w && typeof w.getBounds === "function" && typeof w.setBounds === "function" ? w : null;
	} catch {
		return null;
	}
}

export function windowResizeSupported(): boolean {
	return electronWindow() !== null;
}

function finite(n: unknown, min: number, max: number): n is number {
	return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}

/** data.json is user-editable: validate before ever handing numbers to the window. */
export function isSavedWindow(x: unknown): x is SavedWindow {
	if (typeof x !== "object" || x === null) return false;
	const s = x as Record<string, unknown>;
	const b = s.bounds as Record<string, unknown> | null | undefined;
	return (
		typeof s.maximized === "boolean" &&
		typeof b === "object" &&
		b !== null &&
		finite(b.x, -50_000, 50_000) &&
		finite(b.y, -50_000, 50_000) &&
		finite(b.width, 200, 20_000) &&
		finite(b.height, 150, 20_000)
	);
}

/** Keep a rectangle fully on the display it mostly overlaps (monitor unplugged, resolution changed). */
function fitToDisplay(b: Bounds): Bounds {
	try {
		const area = remote()?.screen?.getDisplayMatching(b)?.workArea;
		if (!area) return b;
		const width = Math.min(b.width, area.width);
		const height = Math.min(b.height, area.height);
		return {
			width,
			height,
			x: Math.min(Math.max(b.x, area.x), area.x + area.width - width),
			y: Math.min(Math.max(b.y, area.y), area.y + area.height - height),
		};
	} catch {
		return b;
	}
}

/**
 * Shrink the window around its current centre.
 * @param existing a previously saved state (kept, never overwritten, so repeated calls cannot lose the original)
 * @returns the state to restore later, or `existing` unchanged if nothing was done
 */
export function shrinkWindow(size: { width: number; height: number }, existing: SavedWindow | null): SavedWindow | null {
	const w = electronWindow();
	if (!w) return existing;
	try {
		if (w.isFullScreen()) return existing; // leaving full screen is animated and unreliable; skip
		let saved = existing;
		if (!saved) {
			const maximized = w.isMaximized();
			saved = { bounds: maximized && w.getNormalBounds ? w.getNormalBounds() : w.getBounds(), maximized };
		}
		if (w.isMaximized()) w.unmaximize();
		const cur = w.getBounds();
		const target: Bounds = {
			width: size.width,
			height: size.height,
			x: Math.round(cur.x + cur.width / 2 - size.width / 2),
			y: Math.round(cur.y + cur.height / 2 - size.height / 2),
		};
		// No animation: on macOS an animated setBounds stalls on its first frame while the window is not the active one
		// (locking because the app lost focus is exactly that case), so the window would not shrink at all.
		w.setBounds(fitToDisplay(target), false);
		return saved;
	} catch {
		return existing;
	}
}

export function restoreWindow(saved: SavedWindow): void {
	const w = electronWindow();
	if (!w) return;
	try {
		w.setBounds(fitToDisplay(saved.bounds), false); // same reason: a stalled restore would leave the window small
		if (saved.maximized) w.maximize();
	} catch {
		/* window gone or API changed: leave it as is */
	}
}

/**
 * Call `onLock` when the operating system locks the screen or goes to sleep. Uses Electron's power monitor, which the
 * app only exposes on some builds: without it this does nothing and returns a no-op (the idle timer still applies).
 * @returns a function that stops listening
 */
export function watchSystemLock(onLock: () => void): () => void {
	const pm = remote()?.powerMonitor;
	if (!pm || typeof pm.on !== "function" || typeof pm.removeListener !== "function") return () => {};
	const events = ["lock-screen", "suspend"];
	try {
		for (const e of events) pm.on(e, onLock);
	} catch {
		return () => {};
	}
	return () => {
		try {
			for (const e of events) pm.removeListener(e, onLock);
		} catch {
			/* window gone */
		}
	};
}
