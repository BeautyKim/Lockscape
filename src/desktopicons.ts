// Desktop icons for the Windows 95 theme's wallpaper: My Computer, My Documents, Internet, Recycle Bin.
// Each is a 16x16 bitmap of characters (see PALETTE) drawn as <rect>s in an <svg>, like the pixel padlock: no image
// files, no data URLs, no HTML parsing. They are decoration only (aria-hidden, not clickable).

// k black, w white, g light grey, d dark grey, y/Y folder yellow and its shade, b globe blue, c highlight, n green
export const PALETTE: Readonly<Record<string, string>> = {
	k: "#000000",
	w: "#ffffff",
	g: "#c0c0c0",
	d: "#808080",
	y: "#ffff66",
	Y: "#c0a000",
	b: "#0000c0",
	c: "#40e0e0",
	n: "#009000",
};

const COMPUTER: readonly string[] = [
	"................",
	".kkkkkkkkkkkkkk.",
	".kggggggggggggk.",
	".kgddddddddddgk.",
	".kgdwwwcccccdgk.",
	".kgdwcccccccdgk.",
	".kgdwcccccccdgk.",
	".kgdccccccccdgk.",
	".kgddddddddddgk.",
	".kgggggggggnngk.",
	".kkkkkkkkkkkkkk.",
	"......kkkk......",
	"......kkkk......",
	"..kwwwwwwwwwwk..",
	"..kkkkkkkkkkkk..",
	"................",
];

const FOLDER: readonly string[] = [
	"................",
	"................",
	".kkkkkk.........",
	".kyyyyk.........",
	".kkkkkkkkkkkkkk.",
	".kwwwwwwwwwwwwk.",
	".kyyyyyyyyyyyYk.",
	".kyyyyyyyyyyyYk.",
	".kyyyyyyyyyyyYk.",
	".kyyyyyyyyyyyYk.",
	".kyyyyyyyyyyyYk.",
	".kyyyyyyyyyyyYk.",
	".kYYYYYYYYYYYYk.",
	".kkkkkkkkkkkkkk.",
	"................",
	"................",
];

const GLOBE: readonly string[] = [
	"......kkkk......",
	"....kkkkkkkk....",
	"...kkcccbbbkk...",
	"..kknnnbbnnbkk..",
	".kknnnbbbbnnbkk.",
	".kbcnnbbbbbbbbk.",
	"kkbcbbbbnnnnbbkk",
	"kkbbcbbbbnnnbbkk",
	"kkbbbbbbbbnnbbkk",
	"kkbbbbnnbbbbbbkk",
	".kbbbbnnnbbbbbk.",
	".kkbbbbnnbbbbkk.",
	"..kkbbbbbbbbkk..",
	"...kkbbbbbbkk...",
	"....kkkkkkkk....",
	"......kkkk......",
];

const BIN: readonly string[] = [
	"......kggk......",
	"......kkkk......",
	"..kkkkkkkkkkkk..",
	"..kkkkkkkkkkkk..",
	"...kkkkkkkkkk...",
	"...kgwgdgwgdk...",
	"...kgwgdgwgdk...",
	"...kgwgdgwgdk...",
	"...kgwgnnwgdk...",
	"...kgwndgngdk...",
	"...kgwgnnwgdk...",
	"...kgwndgngdk...",
	"...kgwgdgwgdk...",
	"...kgdddddddk...",
	"...kkkkkkkkkk...",
	"................",
];

export interface DesktopIcon {
	id: string;
	/** The caption under the icon. English on purpose, like the theme's UNLOCK button. */
	label: string;
	rows: readonly string[];
}

/** In the order they are stacked down the left edge of the desktop. */
export const DESKTOP_ICONS: readonly DesktopIcon[] = [
	{ id: "computer", label: "My Computer", rows: COMPUTER },
	{ id: "folder", label: "My Documents", rows: FOLDER },
	{ id: "internet", label: "Internet", rows: GLOBE },
	{ id: "bin", label: "Recycle Bin", rows: BIN },
];

/** Draw a bitmap as one <svg> of <rect>s (runs of one colour are merged into one rect). Empty cells ("." or unknown) are skipped. */
export function bitmapSvg(doc: Document, rows: readonly string[], palette: Readonly<Record<string, string>>): SVGSVGElement {
	const svg = createSvg("svg");
	svg.setAttribute("viewBox", `0 0 ${rows[0]?.length ?? 0} ${rows.length}`);
	svg.setAttribute("shape-rendering", "crispEdges");
	svg.setAttribute("aria-hidden", "true");
	rows.forEach((row, y) => {
		let x = 0;
		while (x < row.length) {
			const c = row[x];
			const fill = palette[c];
			if (!fill) {
				x++;
				continue;
			}
			let end = x + 1;
			while (end < row.length && row[end] === c) end++;
			const r = createSvg("rect");
			r.setAttribute("x", String(x));
			r.setAttribute("y", String(y));
			r.setAttribute("width", String(end - x));
			r.setAttribute("height", "1");
			r.setAttribute("fill", fill);
			svg.append(r);
			x = end;
		}
	});
	return svg;
}

/** The icon column: one <figure> per icon with its caption. Built once; the stylesheet decides when it shows. */
export function buildDesktop(doc: Document, into: HTMLElement): void {
	const figures = DESKTOP_ICONS.map((icon) => {
		const fig = createDiv();
		fig.className = `vl-icon vl-icon-${icon.id}`;
		const cap = createSpan();
		cap.className = "vl-icon-label";
		cap.textContent = icon.label;
		fig.append(bitmapSvg(doc, icon.rows, PALETTE), cap);
		return fig;
	});
	into.replaceChildren(...figures);
}
