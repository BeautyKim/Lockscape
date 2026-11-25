// Password hashing for the lock screen. Uses only the platform WebCrypto API.
// PBKDF2-HMAC-SHA256 with a random per-credential salt. No plaintext is stored.

const ITERATIONS = 600_000; // OWASP 2023 recommendation for PBKDF2-SHA256
const MIN_ITER = 100_000; // reject tampered, absurdly low/high values in data.json
const MAX_ITER = 10_000_000;

export interface Credential {
	v: 1;
	salt: string; // base64
	iter: number;
	hash: string; // base64
}

export function cryptoAvailable(): boolean {
	return typeof crypto !== "undefined" && !!crypto.subtle && !!crypto.getRandomValues;
}

export function isCredential(x: unknown): x is Credential {
	if (typeof x !== "object" || x === null) return false;
	const c = x as Record<string, unknown>;
	return (
		c.v === 1 &&
		typeof c.salt === "string" &&
		typeof c.hash === "string" &&
		typeof c.iter === "number" &&
		Number.isInteger(c.iter) &&
		c.iter >= MIN_ITER &&
		c.iter <= MAX_ITER
	);
}

function toB64(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

function fromB64(s: string): Uint8Array {
	const bin = atob(s);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function derive(password: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
	// NFKC: the same Korean/accented password typed via different IMEs or OSes
	// (e.g. macOS NFD vs Windows NFC) must produce the same key.
	const raw = new TextEncoder().encode(password.normalize("NFKC"));
	const key = await crypto.subtle.importKey("raw", raw as BufferSource, "PBKDF2", false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter },
		key,
		256,
	);
	return new Uint8Array(bits);
}

function equalConstantTime(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

export async function createCredential(password: string): Promise<Credential> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await derive(password, salt, ITERATIONS);
	return { v: 1, salt: toB64(salt), iter: ITERATIONS, hash: toB64(hash) };
}

export async function verifyPassword(password: string, cred: Credential): Promise<boolean> {
	const hash = await derive(password, fromB64(cred.salt), cred.iter);
	return equalConstantTime(hash, fromB64(cred.hash));
}
