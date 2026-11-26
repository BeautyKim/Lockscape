// A pixel-art padlock for the themes that draw their own icons (Windows 95, runner).
// The bitmap lives here as rows of characters so the shape can be checked in a plain node test;
// pixelLock() turns it into an <svg> made of <rect> elements (no innerHTML, no data URLs).

const W = 14;
const pad = (inner: string, margin: number): string => ".".repeat(margin) + inner + ".".repeat(W - margin - inner.length);
const body = (inner: string): string => {
	if (inner.length !== 10) throw new Error(`pixel lock body row must be 10 wide, got ${inner.length}`);
	return pad(`o${inner}o`, 1);
};
const f = "f".repeat(10);

// o outline, s shade, f face, k keyhole, . empty
const SHACKLE_TOP = [pad("oooooo", 4), pad(`o${"s".repeat(6)}o`, 3)];
const BODY = [
	pad("o".repeat(12), 1),
	body(f),
	body(f),
	body("fff" + "kkkk" + "fff"), // keyhole: round top ...
	body("ffff" + "kk" + "ffff"), // ... and a stem
	body("ffff" + "kk" + "ffff"),
	body(f),
	body("s".repeat(10)),
	pad("o".repeat(12), 1),
];

/** Closed: both legs of the shackle reach the body. */
export const LOCK_CLOSED: readonly string[] = [
	...SHACKLE_TOP,
	...Array.from({ length: 4 }, () => pad(`os${".".repeat(6)}so`, 2)),
	...BODY,
];

/** Open: the right leg stops short of the body. */
export const LOCK_OPEN: readonly string[] = [
	...SHACKLE_TOP,
	pad(`os${".".repeat(6)}so`, 2),
	pad(`os${".".repeat(6)}so`, 2),
	pad(`os${".".repeat(6)}..`, 2),
	pad(`os${".".repeat(6)}..`, 2),
	...BODY,
];

export interface PixelPalette {
	o: string;
	s: string;
	f: string;
	k: string;
}

export function pixelLock(doc: Document, open: boolean, palette: PixelPalette): SVGSVGElement {
	const rows = open ? LOCK_OPEN : LOCK_CLOSED;
	const NS = "http://www.w3.org/2000/svg";
	const svg = doc.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", `0 0 ${W} ${rows.length}`);
	svg.setAttribute("shape-rendering", "crispEdges");
	svg.setAttribute("aria-hidden", "true");
	rows.forEach((row, y) => {
		for (let x = 0; x < row.length; x++) {
			const c = row[x] as keyof PixelPalette | ".";
			if (c === ".") continue;
			const r = doc.createElementNS(NS, "rect");
			r.setAttribute("x", String(x));
			r.setAttribute("y", String(y));
			r.setAttribute("width", "1");
			r.setAttribute("height", "1");
			r.setAttribute("fill", palette[c]);
			svg.append(r);
		}
	});
	return svg;
}
