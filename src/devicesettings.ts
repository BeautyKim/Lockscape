// Settings that can be kept per device instead of in the synced data.json. A phone and a laptop want different
// idle times, and "shrink window" means nothing on a phone. The choice itself ("use separate settings here")
// and the values live in this device's local storage, which Obsidian scopes to the vault and never syncs.

export const DEVICE_KEYS = [
	"idleMinutes",
	"lockOnHide",
	"graceSeconds",
	"coverOnBlur",
	"lockOnSystemLock",
	"shrinkOnLock",
	"lockWindowSize",
] as const;

export type DeviceKey = (typeof DEVICE_KEYS)[number];
export type DeviceValues = Record<string, unknown>;

/** Copy the device-only keys out of a settings object. */
export function pickDevice(settings: Record<string, unknown>): DeviceValues {
	const out: DeviceValues = {};
	for (const k of DEVICE_KEYS) out[k] = settings[k];
	return out;
}

/** Overlay values stored on this device onto settings read from data.json. Unknown or missing keys are ignored. */
export function applyDevice<T extends Record<string, unknown>>(shared: T, local: unknown): T {
	if (typeof local !== "object" || local === null) return shared;
	const out: Record<string, unknown> = { ...shared };
	for (const k of DEVICE_KEYS) if (k in (local as DeviceValues)) out[k] = (local as DeviceValues)[k];
	return out as T;
}
