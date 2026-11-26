// Small colour helpers for the animated backgrounds. Pure functions plus one canvas call that lets the
// browser parse any CSS colour (hex, hsl(), named, Obsidian's accent variable...).

export type RGB = [number, number, number];

const DEFAULT_ACCENT = "#7c5cd6";

/** Accept only "#rrggbb" from data.json; anything else means "automatic". */
export function cleanHex(v: unknown): string {
	return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : "";
}

/** Let the browser resolve any CSS colour string to RGB. Returns null if it cannot be parsed. */
export function resolveColor(doc: Document, css: string): RGB | null {
	try {
		const canvas = createEl("canvas");
		canvas.width = canvas.height = 1;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) return null;
		ctx.fillStyle = "#010203"; // sentinel: an unparsable colour leaves this unchanged
		ctx.fillStyle = css;
		ctx.clearRect(0, 0, 1, 1);
		ctx.fillRect(0, 0, 1, 1);
		const d = ctx.getImageData(0, 0, 1, 1).data;
		if (css.trim() !== "" && d[0] === 1 && d[1] === 2 && d[2] === 3 && !/#010203/i.test(css)) return null;
		return [d[0], d[1], d[2]];
	} catch {
		return null;
	}
}

/** The colour Obsidian's theme uses for accents, or a sensible fallback. */
export function themeAccent(doc: Document): RGB {
	const raw = doc.defaultView?.getComputedStyle(doc.body).getPropertyValue("--interactive-accent").trim() ?? "";
	return (raw && resolveColor(doc, raw)) || resolveColor(doc, DEFAULT_ACCENT) || [124, 92, 214];
}

const linear = (v: number): number => {
	const c = v / 255;
	return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** WCAG contrast ratio of two colours, 1 to 21. */
export function contrastRatio(a: RGB, b: RGB): number {
	const lum = ([r, g, bl]: RGB) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(bl);
	const x = lum(a);
	const y = lum(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Text colour for a button painted `bg`: white if that reads (4.5:1), else near-black if that reads, else white.
 * The last case is a narrow purple-magenta band where neither reaches 4.5:1 (the best there is about 4.2:1); white is
 * what people expect on those colours, and the default purple is in it.
 */
export function inkFor(bg: RGB): "#ffffff" | "#111111" {
	if (contrastRatio([255, 255, 255], bg) >= 4.5) return "#ffffff";
	return contrastRatio([17, 17, 17], bg) >= 4.5 ? "#111111" : "#ffffff";
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return [0, 0, l];
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h = 0;
	if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	return [h * 60, s, l];
}

function hsl(h: number, s: number, l: number): string {
	const hue = ((h % 360) + 360) % 360;
	return `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

/**
 * Three harmonious colours around a base colour (base, a warmer and a cooler neighbour),
 * lifted to a lively saturation/lightness so they glow on dark and tint on light backgrounds.
 */
export function palette(base: RGB): [string, string, string] {
	const [h, s] = rgbToHsl(base);
	const sat = Math.min(0.85, Math.max(0.55, s));
	return [hsl(h, sat, 0.6), hsl(h + 38, sat, 0.58), hsl(h - 42, sat, 0.62)];
}

/** Solid CSS string for a base colour, for glows and flakes. */
export function toCss(c: RGB): string {
	return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}
