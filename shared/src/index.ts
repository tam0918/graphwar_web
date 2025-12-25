export type RoomSummary = {
  id: string;
  name: string;
  numPlayers: number;
  gameState: "lobby" | "in_game";
};

export type PlayerState = {
  clientId: string;
  name: string;
  ready: boolean;
};

export type RoomState = {
  id: string;
  name: string;
  players: PlayerState[];
  gameState: "lobby" | "in_game";
  lastGameOver?: LastGameOver;
  game?: GameState;
};

export type GameTeam = 1 | 2;

export type LastGameOver = {
  winnerTeam: GameTeam | null;
  winners: Array<{ clientId: string; name: string; team: GameTeam }>;
  endedAt: number;
};

export type GameSoldier = {
  x: number;
  y: number;
  angle: number;
  alive: boolean;
};

export type GamePlayer = {
  clientId: string;
  name: string;
  team: GameTeam;
  soldiers: GameSoldier[];
  currentTurnSoldier: number;
};

export type TerrainCircle = { x: number; y: number; r: number };
export type ExplosionHole = { x: number; y: number; r: number };

export type GameState = {
  mode: import("./gameConstants").GameMode;
  terrain: { circles: TerrainCircle[]; holes: ExplosionHole[] };
  currentTurnClientId: string;
  timeTurnStarted: number;
  players: GamePlayer[];
  phase: "playing" | "animating_shot";
  lastShot?: {
    byClientId: string;
    functionString: string;
    fireAngle: number;
    startedAtMs: number;
    functionVelocity: number;
    explosion: { x: number; y: number; r: number };
    hits: Array<{ targetClientId: string; soldierIndex: number; killStep: number }>;
    path: Array<{ x: number; y: number }>;
  };
};

export type ClientToServerMessage =
  | { type: "hello"; name: string }
  | { type: "lobby.listRooms" }
  | { type: "room.create"; name: string }
  | { type: "room.join"; roomId: string }
  | { type: "room.leave" }
  | { type: "chat.send"; text: string }
  | { type: "player.ready"; ready: boolean }
  | { type: "game.start" }
  | { type: "game.surrender" }
  | { type: "game.setMode"; mode: import("./gameConstants").GameMode }
  | { type: "game.setAngle"; angle: number }
  | { type: "game.fire"; functionString: string };

export type ServerToClientMessage =
  | { type: "welcome"; clientId: string; protocolVersion: number }
  | { type: "error"; message: string }
  | { type: "lobby.state"; rooms: RoomSummary[] }
  | { type: "room.state"; room: RoomState | null }
  | { type: "chat.msg"; roomId: string; from: string; text: string; ts: number };

export const PROTOCOL_VERSION = 1 as const;

export * from "./gameConstants";
export * from "./game/physics";
export * from "./game/terrain";
export * from "./function/parse";
export * from "./function/evaluate";
export * from "./math/random";

export function safeParseJsonMessage(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function encodeMessage(msg: ClientToServerMessage | ServerToClientMessage): string {
  return JSON.stringify(msg);
}
