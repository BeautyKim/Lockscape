// A short record of when the screen locked and unlocked and when a password was wrong. No password, no note
// content, no device name. It lives in data.json (so it syncs) and is capped, so it cannot grow without bound.
// It is a convenience for the owner, not tamper-proof evidence: anyone who can edit data.json can edit this.

export const LOG_LIMIT = 50;

export type LockReason = "startup" | "idle" | "left" | "manual" | "system";
export type LogKind = "lock" | "unlock" | "fail" | "recover"; // "recover": unlocked with the recovery key

export interface LogEntry {
	t: number; // epoch ms
	k: LogKind;
	r?: LockReason; // only for "lock"
}

export const LOCK_REASONS: readonly LockReason[] = ["startup", "idle", "left", "manual", "system"];
const KINDS: readonly LogKind[] = ["lock", "unlock", "fail", "recover"];

/** Read the log from data.json: keep well-formed entries only, newest last, at most LOG_LIMIT. */
export function parseLog(raw: unknown): LogEntry[] {
	if (!Array.isArray(raw)) return [];
	const out: LogEntry[] = [];
	for (const x of raw) {
		if (typeof x !== "object" || x === null) continue;
		const e = x as Record<string, unknown>;
		if (typeof e.t !== "number" || !Number.isFinite(e.t) || e.t < 0) continue;
		if (typeof e.k !== "string" || !KINDS.includes(e.k as LogKind)) continue;
		const entry: LogEntry = { t: Math.floor(e.t), k: e.k as LogKind };
		if (entry.k === "lock" && typeof e.r === "string" && LOCK_REASONS.includes(e.r as LockReason)) entry.r = e.r as LockReason;
		out.push(entry);
	}
	return out.slice(-LOG_LIMIT);
}

/** Two devices may both have written: merge by time, drop exact duplicates, keep the newest LOG_LIMIT. */
export function mergeLogs(a: LogEntry[], b: LogEntry[]): LogEntry[] {
	const seen = new Set<string>();
	const all: LogEntry[] = [];
	for (const e of [...a, ...b]) {
		const key = `${e.t}|${e.k}|${e.r ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		all.push(e);
	}
	all.sort((x, y) => x.t - y.t);
	return all.slice(-LOG_LIMIT);
}

/** A new list with `entry` added at the end. */
export function appendLog(log: LogEntry[], entry: LogEntry): LogEntry[] {
	return [...log, entry].slice(-LOG_LIMIT);
}
