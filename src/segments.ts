// Seven-segment digits for the retro theme, built with createElementNS (no innerHTML, no assets).

const SVG_NS = "http://www.w3.org/2000/svg";

// viewBox 0 0 60 104. Each bar is a flat hexagon so neighbouring segments meet like a real LED digit.
function hbar(cx: number, cy: number, len: number, th: number): string {
	const h = th / 2;
	const l = len / 2;
	return `${cx - l},${cy} ${cx - l + h},${cy - h} ${cx + l - h},${cy - h} ${cx + l},${cy} ${cx + l - h},${cy + h} ${cx - l + h},${cy + h}`;
}

function vbar(cx: number, cy: number, len: number, th: number): string {
	const h = th / 2;
	const l = len / 2;
	return `${cx},${cy - l} ${cx + h},${cy - l + h} ${cx + h},${cy + l - h} ${cx},${cy + l} ${cx - h},${cy + l - h} ${cx - h},${cy - l + h}`;
}

const SEGMENTS: Record<string, string> = {
	a: hbar(30, 5, 40, 9),
	b: vbar(55, 28.5, 38, 9),
	c: vbar(55, 75.5, 38, 9),
	d: hbar(30, 99, 40, 9),
	e: vbar(5, 75.5, 38, 9),
	f: vbar(5, 28.5, 38, 9),
	g: hbar(30, 52, 40, 9),
};

const LIT: Record<string, string> = {
	"0": "abcdef",
	"1": "bc",
	"2": "abdeg",
	"3": "abcdg",
	"4": "bcfg",
	"5": "acdfg",
	"6": "acdefg",
	"7": "abc",
	"8": "abcdefg",
	"9": "abcdfg",
};

/** One digit as an inline SVG: lit segments get class "on", unlit ones stay as faint ghosts. */
export function digitSvg(doc: Document, ch: string): SVGSVGElement {
	const svg = doc.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", "0 0 60 104");
	svg.setAttribute("class", "vault-lock-seg");
	svg.setAttribute("aria-hidden", "true");
	const lit = LIT[ch] ?? "";
	for (const [name, points] of Object.entries(SEGMENTS)) {
		const poly = doc.createElementNS(SVG_NS, "polygon");
		poly.setAttribute("points", points);
		if (lit.includes(name)) poly.setAttribute("class", "on");
		svg.append(poly);
	}
	return svg;
}
