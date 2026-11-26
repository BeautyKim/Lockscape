// Visual themes. A theme restyles the whole lock screen as a set (window frame, clock, card, field, button).
// Three of them also run a small offline canvas game above the password field.
// This file has no DOM or Obsidian imports on purpose: it is unit-tested in plain node.

export const THEMES = ["default", "win95", "terminal", "gameboy-snake", "neon-breakout", "obsidian-runner"] as const;
export type Theme = (typeof THEMES)[number];

export const GAME_IDS = ["snake", "breakout", "runner"] as const;
export type GameId = (typeof GAME_IDS)[number];

const GAME_OF: Readonly<Partial<Record<Theme, GameId>>> = {
	"gameboy-snake": "snake",
	"neon-breakout": "breakout",
	"obsidian-runner": "runner",
};

export function gameOf(theme: Theme): GameId | null {
	return GAME_OF[theme] ?? null;
}

/**
 * Text a theme fixes in English because it is part of the look (the button of the Windows 95 window says UNLOCK,
 * the terminal says [UNLOCK]). Anything left out stays translated.
 */
export interface ThemeText {
	unlock?: string; // button label
	title?: string; // replaces "Locked"
	unlocked?: string; // shown while the padlock opens
	placeholder?: "none" | "english"; // password field hint; default = translated
}

export const THEME_TEXT: Readonly<Record<Theme, ThemeText>> = {
	default: {},
	win95: { unlock: "UNLOCK", placeholder: "none" },
	terminal: { unlock: "[UNLOCK]", title: "[ LOCKED ]", unlocked: "[ UNLOCKED ]", placeholder: "none" },
	"gameboy-snake": { unlock: "PLAY & UNLOCK" },
	"neon-breakout": { unlock: "UNLOCK", placeholder: "none" },
	"obsidian-runner": { unlock: "UNLOCK", placeholder: "english" },
};

/** A saved theme name. Anything unknown, including the retro and cartoon themes of earlier versions, becomes the default. */
export function parseTheme(raw: unknown): Theme {
	return (THEMES as readonly unknown[]).includes(raw) ? (raw as Theme) : "default";
}

// ---- high scores ---------------------------------------------------------------------------

export type HighScores = Record<GameId, number>;
export const MAX_SCORE = 999_999;

export function emptyHighScores(): HighScores {
	return { snake: 0, breakout: 0, runner: 0 };
}

/** data.json is edited by sync and by hand: take only whole numbers in range per game and ignore the rest. */
export function parseHighScores(raw: unknown): HighScores {
	const out = emptyHighScores();
	if (typeof raw !== "object" || raw === null) return out;
	const r = raw as Record<string, unknown>;
	for (const id of GAME_IDS) {
		const v = r[id];
		if (typeof v === "number" && Number.isFinite(v)) out[id] = Math.min(MAX_SCORE, Math.max(0, Math.floor(v)));
	}
	return out;
}

/** Two devices played the same game: the better score wins on both. */
export function mergeHighScores(a: HighScores, b: HighScores): HighScores {
	const out = emptyHighScores();
	for (const id of GAME_IDS) out[id] = Math.max(a[id], b[id]);
	return out;
}
