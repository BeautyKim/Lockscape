import en, { type Strings } from "./en";
import ko from "./ko";
import ja from "./ja";
import zh from "./zh";
import zhTW from "./zh-tw";
import es from "./es";
import fr from "./fr";
import de from "./de";
import pt from "./pt";
import ru from "./ru";

export type { Strings };

// To add a language: create src/i18n/<code>.ts typed as `Strings` (the compiler enforces every key),
// then register it here. Unknown languages fall back to English.
export const LOCALES: Record<string, Strings> = {
	en,
	ko,
	ja,
	zh,
	"zh-tw": zhTW,
	es,
	fr,
	de,
	pt,
	ru,
};

/** Map a BCP-47-ish tag (Obsidian's "zh-TW", navigator's "pt-BR", "ko_KR") to a LOCALES key. */
export function resolveLocale(tag: string | null | undefined): string {
	const l = (tag ?? "").trim().toLowerCase().replace(/_/g, "-");
	if (LOCALES[l]) return l;
	if (/^zh-(tw|hk|mo|hant)/.test(l)) return "zh-tw";
	const base = l.split("-")[0];
	return LOCALES[base] ? base : "en";
}

export function detectTag(): string {
	// Obsidian stores the app language (Settings → General → Language) here, on desktop and mobile.
	try {
		const stored = window.localStorage.getItem("language");
		if (stored) return stored;
	} catch {
		/* storage blocked: fall through */
	}
	return navigator.language || "en";
}

export function getStrings(tag: string = detectTag()): Strings {
	return LOCALES[resolveLocale(tag)];
}

/** Substitute "{n}" in a translated template. */
export function fmt(template: string, n: number | string): string {
	return template.replace("{n}", String(n));
}
