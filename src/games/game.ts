// The contract between a game and its host. A game owns its rules and its drawing; the host owns everything
// that touches the page (canvas, frame loop, keyboard, focus, cleanup), so a game never has to remember to clean up.

import type { GameId } from "../themes";

export interface Game {
	readonly id: GameId;
	/** Logical canvas size in px. The host scales the real canvas for high-DPI screens. */
	readonly width: number;
	readonly height: number;
	/** True while time is passing (a round in progress). The host runs the frame loop only then. */
	readonly running: boolean;
	readonly score: number;
	/** Back to the "press Space to start" screen. */
	reset(): void;
	/** Advance by dt seconds. Called only while `running` and not paused. */
	update(dt: number): void;
	/** Draw the whole frame. `paused` is true while the password field has the keyboard. */
	draw(ctx: CanvasRenderingContext2D, paused: boolean): void;
	/** A key went down (true) or up (false). `code` is KeyboardEvent.code. Return true if the game used it. */
	key(code: string, down: boolean): boolean;
	/** Pointer position over the canvas, in logical px. Optional. */
	pointer?(x: number, y: number): void;
	/** The keyboard went to a control: forget every held key (its keyup will never reach the game). */
	releaseKeys?(): void;
	/** A click or tap on the canvas (`pointer` has just reported where). Return true if the game used it. */
	pointerDown?(): boolean;
	setHighScore(score: number): void;
}

/** What every game shows while the password field has the keyboard. */
export const PAUSED_LINES: readonly [string, string] = ["PAUSED", "ESC: BACK TO GAME"];
