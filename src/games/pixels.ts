// Pixel-art sprites for the canvas games. A sprite is rows of characters, so its shape can be checked in a plain
// node test (same width on every row, only known characters); drawBitmap() paints it as filled rects.

export type Bitmap = readonly string[];

/** Every row has the width of the first, and every character is "." (empty) or a key of the palette. */
export function bitmapProblems(rows: Bitmap, palette: Readonly<Record<string, string>>): string[] {
	const out: string[] = [];
	const w = rows[0]?.length ?? 0;
	rows.forEach((row, y) => {
		if (row.length !== w) out.push(`row ${y} is ${row.length} wide, expected ${w}`);
		for (const c of row) if (c !== "." && !(c in palette)) out.push(`row ${y}: unknown character "${c}"`);
	});
	return out;
}

export const bitmapSize = (rows: Bitmap): { w: number; h: number } => ({ w: rows[0]?.length ?? 0, h: rows.length });

/** Paint a sprite with its top-left corner at (x, y). Whole pixels only, so the edges stay crisp. */
export function drawBitmap(ctx: CanvasRenderingContext2D, rows: Bitmap, palette: Readonly<Record<string, string>>, x: number, y: number, scale: number): void {
	const ox = Math.round(x);
	const oy = Math.round(y);
	rows.forEach((row, ry) => {
		let rx = 0;
		while (rx < row.length) {
			const c = row[rx];
			if (c === ".") {
				rx++;
				continue;
			}
			let end = rx + 1;
			while (end < row.length && row[end] === c) end++; // one rect per run of the same colour
			ctx.fillStyle = palette[c];
			ctx.fillRect(ox + rx * scale, oy + ry * scale, (end - rx) * scale, scale);
			rx = end;
		}
	});
}
