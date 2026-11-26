// One place that knows which game belongs to which id. Rules and drawing stay in each game's own file.

import type { GameId } from "../themes";
import { BreakoutGame } from "./breakout";
import type { Game } from "./game";
import { RunnerGame } from "./runner";
import { SnakeGame } from "./snake";

export function createGame(id: GameId): Game {
	switch (id) {
		case "snake":
			return new SnakeGame();
		case "breakout":
			return new BreakoutGame();
		case "runner":
			return new RunnerGame();
	}
}

export { GameHost, type HostOptions } from "./host";
export type { Game } from "./game";
