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

// ---- recovery key ---------------------------------------------------------------------------------------
// A random key the owner writes down when setting the password. Only its PBKDF2 hash is stored (same scheme as the
// password). It is 120 random bits, so unlike a short password it cannot be guessed offline from a copy of data.json.

// Crockford base32: no I, L, O, U, so a hand-written key is hard to misread. 32 symbols = 5 bits each.
const RK_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_KEY_LENGTH = 24; // symbols, 120 bits

/** A new key, shown as six groups of four: `ABCD-EFGH-...`. */
export function generateRecoveryKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array((RECOVERY_KEY_LENGTH * 5) / 8));
	let bits = 0;
	let acc = 0;
	let out = "";
	for (const b of bytes) {
		acc = (acc << 8) | b;
		bits += 8;
		while (bits >= 5) {
			out += RK_ALPHABET[(acc >> (bits - 5)) & 31];
			bits -= 5;
		}
		acc &= (1 << bits) - 1;
	}
	return out.match(/.{4}/g)!.join("-");
}

/** What the user typed, reduced to the key's own symbols: any case, spaces and dashes ignored, O→0 and I/L→1 as Crockford says. */
export function normalizeRecoveryKey(input: string): string {
	return input
		.normalize("NFKC")
		.toUpperCase()
		.replace(/[^0-9A-Z]/g, "")
		.replace(/O/g, "0")
		.replace(/[IL]/g, "1");
}

/** True when the text has the right number of key symbols (cheap check before hashing). */
export function looksLikeRecoveryKey(input: string): boolean {
	const n = normalizeRecoveryKey(input);
	return n.length === RECOVERY_KEY_LENGTH && [...n].every((c) => RK_ALPHABET.includes(c));
}

export async function createRecoveryCredential(key: string): Promise<Credential> {
	return createCredential(normalizeRecoveryKey(key));
}

export async function verifyRecoveryKey(input: string, cred: Credential): Promise<boolean> {
	if (!looksLikeRecoveryKey(input)) return false;
	return verifyPassword(normalizeRecoveryKey(input), cred);
}
