// Text length helpers. Lengths are counted in code points, not UTF-16 units, so an emoji counts as one character
// and cutting a string to a limit can never split a surrogate pair into a broken half.

export function charCount(text: string): number {
	return Array.from(text).length;
}

/** Cut to `max` characters (code points). Returns the input itself when it already fits. */
export function clipChars(text: string, max: number): string {
	const chars = Array.from(text);
	return chars.length <= max ? text : chars.slice(0, max).join("");
}
