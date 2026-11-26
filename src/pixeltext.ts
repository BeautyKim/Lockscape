// Pixel digits for the Windows 95 clock. No font file: each digit is a 5x7 bitmap drawn as <rect>s in an <svg>
// (like the pixel padlock in pixelicons.ts), so nothing is downloaded and no HTML is parsed.
// Only 0-9 and ":" are drawn this way. Everything else in a formatted time (the "오후" / "PM" marker) stays text.

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
	"0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
	"1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
	"2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
	"3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
	"4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
	"5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
	"6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
	"7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
	"8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
	"9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
	":": [".", ".", "#", ".", "#", ".", "."],
};
export const GLYPH_ROWS = 7;

export const isPixelChar = (c: string): boolean => c in GLYPHS;

/** Every glyph is 7 rows and every row of a glyph has the same width, using only "#" and ".". Empty = fine. */
export function glyphProblems(): string[] {
	const out: string[] = [];
	for (const [ch, rows] of Object.entries(GLYPHS)) {
		if (rows.length !== GLYPH_ROWS) out.push(`${ch}: ${rows.length} rows`);
		if (rows.some((r) => r.length !== rows[0].length || !/^[#.]+$/.test(r))) out.push(`${ch}: ragged or unknown character`);
	}
	return out;
}

export interface Run {
	pixel: boolean;
	text: string;
}

/** Split a formatted time into stretches drawn as pixels (digits and colons) and stretches left as text. */
export function runsOf(text: string): Run[] {
	const out: Run[] = [];
	for (const ch of Array.from(text)) {
		const pixel = isPixelChar(ch);
		const last = out[out.length - 1];
		if (last && last.pixel === pixel) last.text += ch;
		else out.push({ pixel, text: ch });
	}
	return out;
}

/** Width in cells of a stretch of pixel characters, with one empty column between characters. */
export function pixelWidth(text: string): number {
	const chars = Array.from(text).filter(isPixelChar);
	return chars.reduce((w, ch) => w + GLYPHS[ch][0].length, 0) + Math.max(0, chars.length - 1);
}

/** Draw digits and colons as one <svg>. Colour comes from `fill: currentColor`, size from the stylesheet. */
export function pixelSvg(doc: Document, text: string): SVGSVGElement {
	const svg = createSvg("svg");
	svg.setAttribute("viewBox", `0 0 ${pixelWidth(text)} ${GLYPH_ROWS}`);
	svg.setAttribute("shape-rendering", "crispEdges");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("vl-px-digits");
	let x = 0;
	for (const ch of Array.from(text)) {
		const rows = GLYPHS[ch];
		if (!rows) continue;
		rows.forEach((row, y) => {
			let c = 0;
			while (c < row.length) {
				if (row[c] !== "#") {
					c++;
					continue;
				}
				let end = c + 1;
				while (end < row.length && row[end] === "#") end++; // one rect per run of lit cells
				const r = createSvg("rect");
				r.setAttribute("x", String(x + c));
				r.setAttribute("y", String(y));
				r.setAttribute("width", String(end - c));
				r.setAttribute("height", "1");
				svg.append(r);
				c = end;
			}
		});
		x += rows[0].length + 1;
	}
	return svg;
}
