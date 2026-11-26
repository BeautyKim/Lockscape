import type { App } from "obsidian";

// The lock-screen background is chosen with the OS file picker, downscaled, re-encoded as JPEG and
// stored in the plugin folder. There is deliberately no "image URL" input: the plugin never fetches
// anything from the network.

const MAX_EDGE = 1920; // px; plenty for a lock screen, keeps the file small for sync
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const JPEG_QUALITY = 0.85;

export const BACKGROUND_FILE = "lockscreen-bg.jpg";
export type VideoExt = "mp4" | "webm";
export const VIDEO_EXTS: VideoExt[] = ["mp4", "webm"];
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 120;

export function backgroundPath(pluginDir: string): string {
	return `${pluginDir}/${BACKGROUND_FILE}`;
}

export function videoPath(pluginDir: string, ext: VideoExt): string {
	return `${pluginDir}/lockscreen-bg.${ext}`;
}

/** Opens the system picker. Must be called from a user gesture (button click). */
function pickFile(doc: Document, accept: string): Promise<File | null> {
	return new Promise((resolve) => {
		const input = doc.createElement("input");
		input.type = "file";
		input.accept = accept;
		input.style.display = "none";
		const done = (file: File | null) => {
			input.remove();
			resolve(file);
		};
		input.addEventListener("change", () => done(input.files?.[0] ?? null));
		input.addEventListener("cancel", () => done(null));
		doc.body.append(input);
		input.click();
	});
}

async function toJpeg(file: File, win: Window): Promise<ArrayBuffer> {
	if (file.size > MAX_INPUT_BYTES) throw new Error("image too large");
	const bitmap = await win.createImageBitmap(file); // honours EXIF orientation
	try {
		const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
		const w = Math.max(1, Math.round(bitmap.width * scale));
		const h = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = win.document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2d context");
		ctx.fillStyle = "#000"; // transparent PNG/SVG areas become black instead of undefined
		ctx.fillRect(0, 0, w, h);
		ctx.drawImage(bitmap, 0, 0, w, h);
		const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
		if (!blob) throw new Error("encode failed");
		return await blob.arrayBuffer();
	} finally {
		bitmap.close();
	}
}

/**
 * Let the user pick an image and save it as the background.
 * @returns true if saved, false if the picker was cancelled. Throws if the image cannot be used.
 */
export async function chooseBackground(app: App, pluginDir: string, doc: Document): Promise<boolean> {
	const file = await pickFile(doc, "image/*");
	if (!file) return false;
	const data = await toJpeg(file, doc.defaultView ?? window);
	await app.vault.adapter.writeBinary(backgroundPath(pluginDir), data);
	return true;
}

export async function removeBackground(app: App, pluginDir: string): Promise<void> {
	const path = backgroundPath(pluginDir);
	if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
}

/** Check that the browser can actually play the clip (right codec, finite short duration) before saving it. */
async function verifyPlayable(file: File, doc: Document): Promise<void> {
	const url = URL.createObjectURL(file); // blob: URL, local to this window; never leaves the machine
	try {
		const video = doc.createElement("video");
		video.muted = true;
		video.preload = "metadata";
		await new Promise<void>((resolve, reject) => {
			const timer = window.setTimeout(() => reject(new Error("timeout")), 10_000);
			video.onloadedmetadata = () => {
				window.clearTimeout(timer);
				if (!video.videoWidth || !video.videoHeight) return reject(new Error("no video track"));
				if (!Number.isFinite(video.duration) || video.duration > MAX_VIDEO_SECONDS) return reject(new Error("too long"));
				resolve();
			};
			video.onerror = () => {
				window.clearTimeout(timer);
				reject(new Error("cannot decode"));
			};
			video.src = url;
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

function extOf(file: File): VideoExt | null {
	if (file.type === "video/mp4") return "mp4";
	if (file.type === "video/webm") return "webm";
	const m = /\.(mp4|webm)$/i.exec(file.name);
	return m ? (m[1].toLowerCase() as VideoExt) : null;
}

/**
 * Let the user pick a short looping clip (MP4/WebM, up to 30 MB) and save it unchanged as the background video.
 * @returns the saved extension, or null if the picker was cancelled. Throws if the clip cannot be used.
 */
export async function chooseVideo(app: App, pluginDir: string, doc: Document): Promise<VideoExt | null> {
	const file = await pickFile(doc, "video/mp4,video/webm,.mp4,.webm");
	if (!file) return null;
	const ext = extOf(file);
	if (!ext || file.size > MAX_VIDEO_BYTES) throw new Error("unsupported video");
	await verifyPlayable(file, doc);
	// Write the new clip before touching the old one: if the write fails, the previous video is still there.
	await app.vault.adapter.writeBinary(videoPath(pluginDir, ext), await file.arrayBuffer());
	for (const other of VIDEO_EXTS) {
		if (other === ext) continue; // only one clip is kept
		const path = videoPath(pluginDir, other);
		if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
	}
	return ext;
}

export async function removeVideo(app: App, pluginDir: string): Promise<void> {
	for (const ext of VIDEO_EXTS) {
		const path = videoPath(pluginDir, ext);
		if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
	}
}
