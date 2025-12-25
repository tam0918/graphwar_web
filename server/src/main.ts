import "dotenv/config";
import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { nanoid } from "nanoid";
import { generateLlmHint } from "./llmHint";
import { createStatsDbFromEnv } from "./statsDb";
import {
  encodeMessage,
  PROTOCOL_VERSION,
  safeParseJsonMessage,
  GAME_CONSTANTS,
  randomGaussian,
  type GameMode,
  type DifficultyMode,
  type MatchPreset,
  type RoomConfig,
  simulateShot,
  collidePoint,
  type TerrainState,
  type TerrainCircle,
  type PlayerGameState,
  type ClientToServerMessage,
  type PlayerState,
  type RoomState,
  type RoomSummary,
  type ServerToClientMessage,
  type LastGameOver,
  type PlayerStats,
} from "@graphwar/shared";

type Client = {
  clientId: string;
  name: string;
  roomId: string | null;
  ready: boolean;
};

type Room = {
  id: string;
  name: string;
  ownerClientId: string;
  config: RoomConfig;
  clients: Set<WebSocket>;
  bots: Map<string, { clientId: string; name: string }>;
  gameState: "lobby" | "in_game";
  lastGameOver?: LastGameOver;
  game?: {
    mode: GameMode;
    difficulty: DifficultyMode;
    terrain: TerrainState;
    players: PlayerGameState[];
    currentTurnIndex: number;
    timeTurnStarted: number;
    hintPauseStartedAtMs?: number;
    hintPauseByClientId?: string;
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
    matchStatsByClientId: Map<string, { kills: number; bestMultiKill: number }>;
    timers: Set<NodeJS.Timeout>;
    botTurnScheduledFor?: string;
  };
};

const PORT = Number(process.env.PORT ?? 8080);

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: "/ws" });

const clientsBySocket = new Map<WebSocket, Client>();
const roomsById = new Map<string, Room>();

const statsDb = createStatsDbFromEnv();
void statsDb.init().catch((e) => {
  // eslint-disable-next-line no-console
  console.warn("[statsDb] init failed (server will continue without DB):", e);
});

function now() {
  return Date.now();
}

function maxPlayersForPreset(preset: MatchPreset): number {
  switch (preset) {
    case "2v2":
      return 4;
    case "4v4":
      return 8;
    case "1vX":
    default:
      return 6;
  }
}

function makeRoomConfig(partial?: Partial<Pick<RoomConfig, "preset" | "difficulty">>): RoomConfig {
  const preset: MatchPreset = partial?.preset ?? "1vX";
  const difficulty: DifficultyMode = partial?.difficulty ?? "practice";
  return { preset, difficulty, maxPlayers: maxPlayersForPreset(preset) };
}

function isBotId(clientId: string): boolean {
  return clientId.startsWith("bot_");
}

function roomPopulation(room: Room): number {
  return room.clients.size + room.bots.size;
}

function requireRoomOwner(client: Client, room: Room): boolean {
  return client.clientId === room.ownerClientId;
}

function asRoomState(room: Room): RoomState {
  const base = {
    id: room.id,
    name: room.name,
    ownerClientId: room.ownerClientId,
    config: room.config,
    players: [] as PlayerState[],
    gameState: room.gameState,
    lastGameOver: room.lastGameOver,
  };

  // Lobby player list (connections), not necessarily game players.
  for (const ws of room.clients) {
    const c = clientsBySocket.get(ws);
    if (!c) continue;
    base.players.push({ clientId: c.clientId, name: c.name, ready: c.ready });
  }

  for (const b of room.bots.values()) {
    base.players.push({ clientId: b.clientId, name: b.name, ready: true, isBot: true });
  }
  base.players.sort((a, b) => a.name.localeCompare(b.name));

  if (room.gameState !== "in_game" || !room.game) return base;

  const currentTurnClientId = room.game.players[room.game.currentTurnIndex]?.clientId ?? "";
  return {
    ...base,
    game: {
      mode: room.game.mode,
      difficulty: room.game.difficulty,
      terrain: room.game.terrain,
      currentTurnClientId,
      timeTurnStarted: room.game.timeTurnStarted,
      phase: room.game.phase,
      players: room.game.players.map((p) => ({
        clientId: p.clientId,
        name: p.name,
        team: p.team,
        soldiers: p.soldiers.map((s) => ({ x: s.x, y: s.y, angle: s.angle, alive: s.alive })),
        currentTurnSoldier: p.currentTurnSoldier,
      })),
      lastShot: room.game.lastShot,
    },
  };
}

function send(ws: WebSocket, msg: ServerToClientMessage) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(encodeMessage(msg));
  } catch {
    // Ignore send errors; close handler will clean up.
  }
}

function broadcast(room: Room, msg: ServerToClientMessage) {
  const raw = encodeMessage(msg);
  for (const ws of room.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(raw);
    } catch {
      // Ignore send errors; close handler will clean up.
    }
  }
}

function getLobbyState(): RoomSummary[] {
  const rooms: RoomSummary[] = [];
  for (const room of roomsById.values()) {
    rooms.push({
      id: room.id,
      name: room.name,
      numPlayers: roomPopulation(room),
      gameState: room.gameState,
      preset: room.config.preset,
      difficulty: room.config.difficulty,
      maxPlayers: room.config.maxPlayers,
    });
  }
  rooms.sort((a, b) => a.name.localeCompare(b.name));
  return rooms;
}

function getRoomState(room: Room): RoomState {
  return asRoomState(room);
}

function broadcastLobbyState() {
  const msg: ServerToClientMessage = { type: "lobby.state", rooms: getLobbyState() };
  const raw = encodeMessage(msg);
  for (const ws of clientsBySocket.keys()) ws.send(raw);
}

function endGame(room: Room): void {
  // Capture winner before we clear game state.
  if (room.game) {
    let team1 = false;
    let team2 = false;
    for (const p of room.game.players) {
      if (!playerHasAliveSoldiers(p)) continue;
      if (p.team === 1) team1 = true;
      if (p.team === 2) team2 = true;
    }

    const winnerTeam: 1 | 2 | null = team1 && !team2 ? 1 : team2 && !team1 ? 2 : null;
    const winners =
      winnerTeam == null
        ? []
        : room.game.players
            .filter((p) => p.team === winnerTeam && playerHasAliveSoldiers(p))
            .map((p) => ({ clientId: p.clientId, name: p.name, team: p.team }));

    room.lastGameOver = {
      winnerTeam,
      winners,
      endedAt: now(),
    };
  }

  // Persist match stats (best-effort, never blocks gameplay).
  if (room.game && room.lastGameOver && statsDb.enabled) {
    const g = room.game;
    const winnerIds = new Set(room.lastGameOver.winners.map((w) => w.clientId));
    const players = g.players.map((p) => {
      const ms = g.matchStatsByClientId.get(p.clientId) ?? { kills: 0, bestMultiKill: 0 };
      return {
        name: p.name,
        didWin: winnerIds.has(p.clientId),
        kills: ms.kills,
        bestMultiKill: ms.bestMultiKill,
      };
    });

    void statsDb.recordMatch({ players }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[statsDb] recordMatch failed:", e);
    });
  }

  if (room.game) {
    for (const t of room.game.timers) clearTimeout(t);
    room.game.timers.clear();
  }
  room.game = undefined;
  room.gameState = "lobby";

  // After a match ends, reset readiness so players explicitly ready up again.
  for (const ws of room.clients) {
    const c = clientsBySocket.get(ws);
    if (c) c.ready = false;
  }
}

function surrenderPlayer(room: Room, clientId: string): void {
  if (!room.game) return;
  const g = room.game;
  const p = g.players.find((pl) => pl.clientId === clientId);
  if (!p) return;

  for (const s of p.soldiers) s.alive = false;

  // If they surrendered on their turn, move the turn forward.
  const turnPlayer = g.players[g.currentTurnIndex];
  if (turnPlayer?.clientId === clientId) {
    advanceTurn(room);
  }

  if (isGameOver(room)) {
    endGame(room);
  }
}

function leaveRoom(ws: WebSocket) {
  const client = clientsBySocket.get(ws);
  if (!client?.roomId) return;

  const room = roomsById.get(client.roomId);
  client.roomId = null;
  client.ready = false;

  if (!room) return;

  // If a player leaves mid-game, treat it like surrender so turns don't get stuck.
  if (room.gameState === "in_game" && room.game) {
    surrenderPlayer(room, client.clientId);
  }

  room.clients.delete(ws);

  // Reassign owner if needed (bots cannot own rooms).
  if (client.clientId === room.ownerClientId) {
    const nextOwner = Array.from(room.clients)
      .map((s) => clientsBySocket.get(s))
      .find(Boolean);
    if (nextOwner) room.ownerClientId = nextOwner.clientId;
  }

  if (room.clients.size === 0) {
    if (room.game) {
      for (const t of room.game.timers) clearTimeout(t);
      room.game.timers.clear();
    }
    roomsById.delete(room.id);
    broadcastLobbyState();
    return;
  }

  broadcast(room, { type: "room.state", room: getRoomState(room) });
  broadcastLobbyState();
}

function joinRoom(ws: WebSocket, room: Room) {
  const client = clientsBySocket.get(ws);
  if (!client) return;

  if (room.gameState === "in_game") {
    send(ws, { type: "error", message: "Cannot join a room mid-game" });
    return;
  }

  if (roomPopulation(room) >= room.config.maxPlayers) {
    send(ws, { type: "error", message: "Room is full" });
    return;
  }

  if (client.roomId && client.roomId !== room.id) leaveRoom(ws);

  client.roomId = room.id;
  client.ready = false;
  room.clients.add(ws);

  send(ws, { type: "room.state", room: getRoomState(room) });
  broadcast(room, { type: "room.state", room: getRoomState(room) });
  broadcastLobbyState();
}

function distSq(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function distPointToSegmentSq(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq <= 1e-9) return distSq(p, a);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
  const proj = { x: a.x + t * abx, y: a.y + t * aby };
  return distSq(p, proj);
}

function pickRelevantObstacles(args: {
  shooter: { x: number; y: number };
  target: { x: number; y: number };
  terrain: TerrainState;
}): { circles: Array<{ x: number; y: number; r: number }>; holes: Array<{ x: number; y: number; r: number }> } {
  const { terrain } = args;
  // Provide full obstacle coordinates so the model can avoid any blocker,
  // not just those near the straight corridor.
  return {
    circles: terrain.circles.map((c) => ({ x: c.x, y: c.y, r: c.r })),
    holes: terrain.holes.map((h) => ({ x: h.x, y: h.y, r: h.r })),
  };
}

function circlesTooClose(a: TerrainCircle, b: TerrainCircle, gap: number): boolean {
  const minD = a.r + b.r + gap;
  return distSq(a, b) < minD * minD;
}

function generateCircles(): TerrainCircle[] {
  const {
    PLANE_LENGTH,
    PLANE_HEIGHT,
    NUM_CIRCLES_MEAN_VALUE,
    NUM_CIRCLES_STANDARD_DEVIATION,
    CIRCLE_MEAN_RADIUS,
    CIRCLE_STANDARD_DEVIATION,
  } = GAME_CONSTANTS;

  // Spawn constraints tuned to avoid cramped/overlapping maps.
  const MIN_CIRCLE_R = 14;
  const MAX_CIRCLE_R = 90;
  const MIN_CIRCLE_GAP = 14; // pixels between circle edges
  const EDGE_PADDING = 8; // keep away from boundary
  const MAX_TRIES_PER_CIRCLE = 80;

  let target = Math.trunc(randomGaussian() * NUM_CIRCLES_STANDARD_DEVIATION + NUM_CIRCLES_MEAN_VALUE);
  if (target < 1) target = 1;

  const circles: TerrainCircle[] = [];

  // Place circles with rejection sampling; if the plane is too dense we simply place fewer.
  for (let i = 0; i < target; i++) {
    let placed = false;

    for (let attempt = 0; attempt < MAX_TRIES_PER_CIRCLE; attempt++) {
      let r = Math.trunc(randomGaussian() * CIRCLE_STANDARD_DEVIATION + CIRCLE_MEAN_RADIUS);
      while (r < MIN_CIRCLE_R) r = Math.trunc(randomGaussian() * CIRCLE_STANDARD_DEVIATION + CIRCLE_MEAN_RADIUS);
      if (r > MAX_CIRCLE_R) r = MAX_CIRCLE_R;

      const xMin = r + EDGE_PADDING;
      const xMax = PLANE_LENGTH - r - EDGE_PADDING;
      const yMin = r + EDGE_PADDING;
      const yMax = PLANE_HEIGHT - r - EDGE_PADDING;

      if (xMax <= xMin || yMax <= yMin) continue;

      const candidate: TerrainCircle = {
        x: Math.floor(xMin + Math.random() * (xMax - xMin)),
        y: Math.floor(yMin + Math.random() * (yMax - yMin)),
        r,
      };

      let ok = true;
      for (const c of circles) {
        if (circlesTooClose(candidate, c, MIN_CIRCLE_GAP)) {
          ok = false;
          break;
        }
      }

      if (!ok) continue;

      circles.push(candidate);
      placed = true;
      break;
    }

    if (!placed) {
      // Stop early if we can't fit more without breaking spacing rules.
      break;
    }
  }

  return circles;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function testSoldier(candidate: { x: number; y: number }, placed: Array<{ x: number; y: number }>, circles: TerrainCircle[]): boolean {
  const MIN_SOLDIER_SPACING = GAME_CONSTANTS.SOLDIER_SELECTION_RADIUS * 2; // feels natural and avoids stacking
  const CIRCLE_CLEARANCE = GAME_CONSTANTS.SOLDIER_SELECTION_RADIUS + 10;

  for (const s of placed) {
    if (distSq(candidate, s) < MIN_SOLDIER_SPACING * MIN_SOLDIER_SPACING) return false;
  }
  for (const c of circles) {
    const minD = c.r + CIRCLE_CLEARANCE;
    if (distSq(candidate, c) < minD * minD) return false;
  }
  return true;
}

function generateSoldierPositions(players: PlayerGameState[], circles: TerrainCircle[]): void {
  const { PLANE_LENGTH, PLANE_HEIGHT, SOLDIER_RADIUS } = GAME_CONSTANTS;
  const placed: Array<{ x: number; y: number }> = [];

  // Keep a buffer near the midline so both teams don't spawn on top of each other.
  const CENTER_BUFFER = 35;
  const half = PLANE_LENGTH / 2;

  for (const p of players) {
    for (let i = 0; i < p.soldiers.length; i++) {
      let s: { x: number; y: number };
      do {
        let x = Math.floor(Math.random() * (PLANE_LENGTH / 2 - CENTER_BUFFER - 2 * SOLDIER_RADIUS)) + SOLDIER_RADIUS;
        const y = Math.floor(Math.random() * (PLANE_HEIGHT - 2 * SOLDIER_RADIUS)) + SOLDIER_RADIUS;
        if (p.team === 2) x += half + CENTER_BUFFER;
        s = { x, y };
      } while (!testSoldier(s, placed, circles));

      placed.push(s);
      p.soldiers[i] = { x: s.x, y: s.y, angle: 0, alive: true };
    }
  }
}

function playerHasAliveSoldiers(p: PlayerGameState): boolean {
  return p.soldiers.some((s) => s.alive);
}

function advanceTurn(room: Room): void {
  if (!room.game) return;
  const g = room.game;
  if (g.players.length === 0) return;

  g.phase = "playing";
  g.lastShot = undefined;

  // Find next player with at least one alive soldier.
  for (let step = 0; step < g.players.length; step++) {
    g.currentTurnIndex = (g.currentTurnIndex + 1) % g.players.length;
    const p = g.players[g.currentTurnIndex]!;
    if (!playerHasAliveSoldiers(p)) continue;

    // Advance to next alive soldier for that player.
    const n = p.soldiers.length;
    for (let i = 0; i < n; i++) {
      p.currentTurnSoldier = (p.currentTurnSoldier + 1) % n;
      if (p.soldiers[p.currentTurnSoldier]!.alive) break;
    }
    break;
  }

  g.timeTurnStarted = now();

  maybeScheduleBotTurn(room);
}

function selectNearestEnemyTarget(g: NonNullable<Room["game"]>, shooter: PlayerGameState): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Number.POSITIVE_INFINITY;

  for (const p of g.players) {
    if (p.team === shooter.team) continue;
    for (const s of p.soldiers) {
      if (!s.alive) continue;
      const d = distSq({ x: s.x, y: s.y }, { x: shooter.soldiers[shooter.currentTurnSoldier]!.x, y: shooter.soldiers[shooter.currentTurnSoldier]!.y });
      if (d < bestD) {
        bestD = d;
        best = { x: s.x, y: s.y };
      }
    }
  }

  return best;
}

function botChooseFunction(mode: GameMode, dxLocal: number, dyLocal: number): string {
  // Keep it intentionally simple; Gemini (if configured) provides better suggestions.
  // These functions are interpreted in shooter-local coordinates.
  if (mode === "normal") {
    const slope = dxLocal !== 0 ? dyLocal / dxLocal : 0;
    const m = Math.max(-6, Math.min(6, slope));
    const mm = Math.round(m * 10) / 10;
    if (Math.abs(mm) < 0.2) return "0";
    return `${mm}*x`;
  }
  if (mode === "fst_ode") {
    // dy/dx = k
    const slope = dxLocal !== 0 ? dyLocal / dxLocal : 0;
    const k = Math.max(-6, Math.min(6, slope));
    const kk = Math.round(k * 10) / 10;
    return `${kk}`;
  }
  // snd_ode: y'' = 0 gives straight-ish trajectory depending on angle.
  return "0";
}

function maybeScheduleBotTurn(room: Room): void {
  if (!room.game || room.gameState !== "in_game") return;
  const g = room.game;
  if (g.phase !== "playing") return;

  const turnPlayer = g.players[g.currentTurnIndex];
  if (!turnPlayer) return;

  if (!isBotId(turnPlayer.clientId)) {
    g.botTurnScheduledFor = undefined;
    return;
  }

  if (g.botTurnScheduledFor === turnPlayer.clientId) return;
  g.botTurnScheduledFor = turnPlayer.clientId;

  schedule(room, 900, () => {
    const gg = room.game;
    if (!gg || gg.phase !== "playing") return;
    const tp = gg.players[gg.currentTurnIndex];
    if (!tp || tp.clientId !== turnPlayer.clientId) return;

    const shooterSoldier = tp.soldiers[tp.currentTurnSoldier];
    if (!shooterSoldier || !shooterSoldier.alive) {
      advanceTurn(room);
      broadcast(room, { type: "room.state", room: getRoomState(room) });
      broadcastLobbyState();
      return;
    }

    const target = selectNearestEnemyTarget(gg, tp);
    const inverted = tp.team === 2;
    const dxLocal = inverted ? shooterSoldier.x - (target?.x ?? shooterSoldier.x) : (target?.x ?? shooterSoldier.x) - shooterSoldier.x;
    const dyLocal = -( (target?.y ?? shooterSoldier.y) - shooterSoldier.y );

    if (gg.mode === "snd_ode") {
      const EPS = 1e-3;
      const a = (Math.random() - 0.5) * (Math.PI / 2);
      shooterSoldier.angle = Math.max(-Math.PI / 2 + EPS, Math.min(Math.PI / 2 - EPS, a));
    }

    const f = botChooseFunction(gg.mode, dxLocal, dyLocal);
    const err = fireShot(room, tp.clientId, f);
    if (err) {
      // If bot failed (e.g. malformed), skip its turn.
      advanceTurn(room);
      broadcast(room, { type: "room.state", room: getRoomState(room) });
      broadcastLobbyState();
    }
  });
}

function isGameOver(room: Room): boolean {
  if (!room.game) return true;
  // If only one team has alive soldiers -> game over.
  let team1 = false;
  let team2 = false;
  for (const p of room.game.players) {
    if (!playerHasAliveSoldiers(p)) continue;
    if (p.team === 1) team1 = true;
    if (p.team === 2) team2 = true;
  }
  return !(team1 && team2);
}

function startGame(room: Room): void {
  // New match: clear last result banner.
  room.lastGameOver = undefined;

  if (room.clients.size < 1) {
    throw new Error("At least one human player is required");
  }

  const total = roomPopulation(room);
  if (room.config.preset === "2v2" && total !== 4) {
    throw new Error("2v2 requires exactly 4 players (humans + bots)");
  }
  if (room.config.preset === "4v4" && total !== 8) {
    throw new Error("4v4 requires exactly 8 players (humans + bots)");
  }
  if (room.config.preset === "1vX" && (total < 2 || total > 6)) {
    throw new Error("1vX requires 2-6 players (humans + bots)");
  }

  const participants: Array<{ clientId: string; name: string; isHuman: boolean }> = [];
  for (const ws of room.clients) {
    const c = clientsBySocket.get(ws);
    if (!c) continue;
    participants.push({ clientId: c.clientId, name: c.name, isHuman: true });
  }
  for (const b of room.bots.values()) participants.push({ clientId: b.clientId, name: b.name, isHuman: false });

  // Stable ordering; ensure owner is first for 1vX so they are the "1".
  participants.sort((a, b) => a.clientId.localeCompare(b.clientId));
  if (room.config.preset === "1vX") {
    const idx = participants.findIndex((p) => p.clientId === room.ownerClientId);
    if (idx > 0) {
      const [owner] = participants.splice(idx, 1);
      participants.unshift(owner);
    }
  }

  const players: PlayerGameState[] = [];
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i]!;
    let team: 1 | 2 = 1;
    if (room.config.preset === "1vX") {
      team = i === 0 ? 1 : 2;
    } else if (room.config.preset === "2v2") {
      team = i < 2 ? 1 : 2;
    } else if (room.config.preset === "4v4") {
      team = i < 4 ? 1 : 2;
    }

    players.push({
      clientId: p.clientId,
      name: p.name,
      team,
      soldiers: new Array(1).fill(null).map(() => ({ x: 0, y: 0, angle: 0, alive: true })),
      currentTurnSoldier: 0,
    });
  }

  const circles = generateCircles();
  const terrain: TerrainState = { circles, holes: [] };
  generateSoldierPositions(players, circles);

  // Pick random start player that has soldiers.
  let startIdx = Math.floor(Math.random() * players.length);
  for (let i = 0; i < players.length; i++) {
    const idx = (startIdx + i) % players.length;
    if (playerHasAliveSoldiers(players[idx]!)) {
      startIdx = idx;
      break;
    }
  }

  room.gameState = "in_game";
  room.game = {
    mode: "normal",
    difficulty: room.config.difficulty,
    terrain,
    players,
    currentTurnIndex: startIdx,
    timeTurnStarted: now(),
    phase: "playing",
    matchStatsByClientId: new Map(players.map((p) => [p.clientId, { kills: 0, bestMultiKill: 0 }])),
    timers: new Set<NodeJS.Timeout>(),
  };

  maybeScheduleBotTurn(room);
}

function fireShot(room: Room, byClientId: string, functionStringRaw: string): string | null {
  if (!room.game) return "Game not started";
  const g = room.game;

  if (g.phase === "animating_shot") return "Shot is already animating";

  const turnPlayer = g.players[g.currentTurnIndex];
  if (!turnPlayer || turnPlayer.clientId !== byClientId) return "Not your turn";

  const functionString = functionStringRaw.trim();
  if (!functionString) return "Function is required";

  let shot;
  try {
    shot = simulateShot({
      mode: g.mode,
      functionString,
      terrain: g.terrain,
      players: g.players,
      currentTurnIndex: g.currentTurnIndex,
    });
  } catch {
    return "Malformed function";
  }

  const startedAtMs = now();
  const functionVelocity = GAME_CONSTANTS.FUNCTION_VELOCITY;

  // Friendly fire: teammates can be hit but do not die. Filter hits to enemy-only.
  const shooterTeam = turnPlayer.team;
  const enemyHits = shot.hits.filter((h) => {
    const targetPlayer = g.players.find((p) => p.clientId === h.targetClientId);
    return !!targetPlayer && targetPlayer.team !== shooterTeam;
  });

  // Track per-match stats for achievements / leaderboard.
  const ms = g.matchStatsByClientId.get(byClientId);
  if (ms) {
    ms.kills += enemyHits.length;
    ms.bestMultiKill = Math.max(ms.bestMultiKill, enemyHits.length);
  }

  g.phase = "animating_shot";
  g.lastShot = {
    byClientId,
    functionString,
    fireAngle: shot.fireAngle,
    startedAtMs,
    functionVelocity,
    explosion: shot.explosion,
    hits: enemyHits,
    path: shot.path,
  };

  for (const h of enemyHits) {
    const killAt = startedAtMs + Math.floor((h.killStep * 1000) / functionVelocity);
    schedule(room, killAt - now(), () => {
      const gg = room.game;
      if (!gg || gg.phase !== "animating_shot" || gg.lastShot?.startedAtMs !== startedAtMs) return;
      const target = gg.players.find((p) => p.clientId === h.targetClientId);
      const sol = target?.soldiers[h.soldierIndex];
      if (sol) sol.alive = false;
      broadcast(room, { type: "room.state", room: getRoomState(room) });
    });
  }

  const drawDurationMs = Math.floor((shot.path.length * 1000) / functionVelocity);
  const explodeAtMs = startedAtMs + drawDurationMs;

  schedule(room, explodeAtMs - now(), () => {
    const gg = room.game;
    if (!gg || gg.phase !== "animating_shot" || gg.lastShot?.startedAtMs !== startedAtMs) return;
    gg.terrain.holes.push(shot.explosion);
    if (gg.lastShot) gg.lastShot.path = [];
    broadcast(room, { type: "room.state", room: getRoomState(room) });
  });

  schedule(room, explodeAtMs + GAME_CONSTANTS.NEXT_TURN_DELAY_MS - now(), () => {
    const gg = room.game;
    if (!gg || gg.lastShot?.startedAtMs !== startedAtMs) return;

    if (isGameOver(room)) {
      endGame(room);
      broadcast(room, { type: "room.state", room: getRoomState(room) });
      broadcastLobbyState();
      return;
    }

    advanceTurn(room);
    broadcast(room, { type: "room.state", room: getRoomState(room) });
    broadcastLobbyState();
  });

  broadcast(room, { type: "room.state", room: getRoomState(room) });
  broadcastLobbyState();
  return null;
}


function schedule(room: Room, delayMs: number, fn: () => void) {
  if (!room.game) return;
  const t = setTimeout(() => {
    room.game?.timers.delete(t);
    try {
      fn();
    } catch (e) {
      // Never crash the server due to a scheduled callback.
      console.error("Scheduled task failed", e);
    }
  }, Math.max(0, delayMs));
  room.game.timers.add(t);
}

function handleMessage(ws: WebSocket, msg: ClientToServerMessage) {
  const client = clientsBySocket.get(ws);
  if (!client) return;

  switch (msg.type) {
    case "hello": {
      const name = msg.name.trim().slice(0, 24);
      if (!name) {
        send(ws, { type: "error", message: "Name is required" });
        return;
      }
      client.name = name;
      send(ws, { type: "lobby.state", rooms: getLobbyState() });
      return;
    }

    case "lobby.listRooms": {
      send(ws, { type: "lobby.state", rooms: getLobbyState() });
      return;
    }

    case "stats.get": {
      const top = Math.max(1, Math.min(50, msg.top ?? 5));
      if (!statsDb.enabled) {
        send(ws, { type: "stats.me", stats: null });
        send(ws, { type: "stats.leaderboard", entries: [] });
        return;
      }

      void (async () => {
        try {
          const me: PlayerStats = await statsDb.getPlayer(client.name);
          const entries = await statsDb.getLeaderboard(top);
          send(ws, { type: "stats.me", stats: me });
          send(ws, { type: "stats.leaderboard", entries });
        } catch {
          send(ws, { type: "error", message: "DB error while loading stats" });
        }
      })();
      return;
    }

    case "room.create": {
      const roomName = msg.name.trim().slice(0, 32);
      if (!roomName) {
        send(ws, { type: "error", message: "Room name is required" });
        return;
      }
      const room: Room = {
        id: nanoid(8),
        name: roomName,
        ownerClientId: client.clientId,
        config: makeRoomConfig(msg.config),
        clients: new Set<WebSocket>(),
        bots: new Map(),
        gameState: "lobby",
      };
      roomsById.set(room.id, room);
      joinRoom(ws, room);
      return;
    }

    case "room.join": {
      const room = roomsById.get(msg.roomId);
      if (!room) {
        send(ws, { type: "error", message: "Room not found" });
        return;
      }
      joinRoom(ws, room);
      return;
    }

    case "room.leave": {
      leaveRoom(ws);
      send(ws, { type: "room.state", room: null });
      return;
    }

    case "player.ready": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      client.ready = !!msg.ready;
      const room = roomsById.get(client.roomId);
      if (room) broadcast(room, { type: "room.state", room: getRoomState(room) });
      return;
    }

    case "game.start": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      const room = roomsById.get(client.roomId);
      if (!room) return;

      if (room.gameState !== "lobby") {
        send(ws, { type: "error", message: "Game already started" });
        return;
      }

      const allReady = Array.from(room.clients).every((s) => clientsBySocket.get(s)?.ready);
      if (!allReady) {
        send(ws, { type: "error", message: "All players must be ready" });
        return;
      }

      try {
        startGame(room);
      } catch (e) {
        send(ws, { type: "error", message: e instanceof Error ? e.message : "Unable to start game" });
        return;
      }
      broadcast(room, { type: "room.state", room: getRoomState(room) });
      broadcastLobbyState();
      return;
    }

    case "game.surrender": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      const room = roomsById.get(client.roomId);
      if (!room?.game || room.gameState !== "in_game") {
        send(ws, { type: "error", message: "Game not started" });
        return;
      }

      // Apply elimination + turn advance. Do NOT auto-leave the room.
      surrenderPlayer(room, client.clientId);

      broadcast(room, { type: "room.state", room: getRoomState(room) });
      broadcastLobbyState();
      return;
    }

    case "game.setMode": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      const room = roomsById.get(client.roomId);
      if (!room?.game) {
        send(ws, { type: "error", message: "Game not started" });
        return;
      }
      room.game.mode = msg.mode;
      broadcast(room, { type: "room.state", room: getRoomState(room) });
      return;
    }

    case "game.setDifficulty":
    case "room.setConfig": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      const room = roomsById.get(client.roomId);
      if (!room) return;
      if (room.gameState !== "lobby") {
        send(ws, { type: "error", message: "Cannot change settings mid-game" });
        return;
      }
      if (!requireRoomOwner(client, room)) {
        send(ws, { type: "error", message: "Only the room owner can change settings" });
        return;
      }

      const incoming = msg.type === "game.setDifficulty" ? { difficulty: msg.difficulty } : msg.config;
      const nextPreset = incoming.preset ?? room.config.preset;
      const nextDifficulty = incoming.difficulty ?? room.config.difficulty;
      const nextMax = maxPlayersForPreset(nextPreset);

      if (roomPopulation(room) > nextMax) {
        send(ws, { type: "error", message: `Too many players for ${nextPreset} (max ${nextMax})` });
        return;
      }

      room.config = { preset: nextPreset, difficulty: nextDifficulty, maxPlayers: nextMax };
      broadcast(room, { type: "room.state", room: getRoomState(room) });
      broadcastLobbyState();
      return;
    }

    case "room.addBot": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      const room = roomsById.get(client.roomId);
      if (!room) return;
      if (room.gameState !== "lobby") {
        send(ws, { type: "error", message: "Cannot add bots mid-game" });
        return;
      }
      if (!requireRoomOwner(client, room)) {
        send(ws, { type: "error", message: "Only the room owner can add bots" });
        return;
      }
      if (roomPopulation(room) >= room.config.maxPlayers) {
        send(ws, { type: "error", message: "Room is full" });
        return;
      }

      const botId = `bot_${nanoid(6)}`;
      const botNameBase = msg.name?.trim().slice(0, 24);
      const botName = botNameBase && botNameBase.length > 0 ? botNameBase : `Bot ${room.bots.size + 1}`;
      room.bots.set(botId, { clientId: botId, name: botName });

      broadcast(room, { type: "room.state", room: getRoomState(room) });
      broadcastLobbyState();
      return;
    }

    case "room.removeBot": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      const room = roomsById.get(client.roomId);
      if (!room) return;
      if (room.gameState !== "lobby") {
        send(ws, { type: "error", message: "Cannot remove bots mid-game" });
        return;
      }
      if (!requireRoomOwner(client, room)) {
        send(ws, { type: "error", message: "Only the room owner can remove bots" });
        return;
      }
      if (!isBotId(msg.clientId) || !room.bots.has(msg.clientId)) {
        send(ws, { type: "error", message: "Bot not found" });
        return;
      }
      room.bots.delete(msg.clientId);
      broadcast(room, { type: "room.state", room: getRoomState(room) });
      broadcastLobbyState();
      return;
    }

    case "game.setAngle": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      const room = roomsById.get(client.roomId);
      if (!room?.game) {
        send(ws, { type: "error", message: "Game not started" });
        return;
      }
      const g = room.game;
      const turnPlayer = g.players[g.currentTurnIndex];
      if (!turnPlayer || turnPlayer.clientId !== client.clientId) {
        send(ws, { type: "error", message: "Not your turn" });
        return;
      }
      const s = turnPlayer.soldiers[turnPlayer.currentTurnSoldier];
      if (!s) return;
      // Avoid tan(angle) blowing up at +/- pi/2 for snd_ode.
      const EPS = 1e-3;
      s.angle = Math.max(-Math.PI / 2 + EPS, Math.min(Math.PI / 2 - EPS, msg.angle));
      broadcast(room, { type: "room.state", room: getRoomState(room) });
      return;
    }

    case "game.fire": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      const room = roomsById.get(client.roomId);
      if (!room?.game) {
        send(ws, { type: "error", message: "Game not started" });
        return;
      }

      const err = fireShot(room, client.clientId, msg.functionString);
      if (err) send(ws, { type: "error", message: err });
      return;
    }

    case "hint.request": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      const room = roomsById.get(client.roomId);
      if (!room?.game || room.gameState !== "in_game") {
        send(ws, { type: "error", message: "Game not started" });
        return;
      }
      if (room.game.difficulty !== "practice") {
        send(ws, { type: "error", message: "Hints are disabled in hard mode" });
        return;
      }

      const g = room.game;
      const turnPlayer = g.players[g.currentTurnIndex];
      if (!turnPlayer || turnPlayer.clientId !== client.clientId) {
        send(ws, { type: "error", message: "Hints are only available on your turn" });
        return;
      }

      void (async () => {
        // Pause the turn timer while the server waits for the LLM so the player doesn't lose their turn.
        const pauseTurn = (() => {
          const gg = room.game;
          if (!gg) return { active: false } as const;
          if (gg.hintPauseStartedAtMs != null) return { active: false } as const;
          gg.hintPauseStartedAtMs = now();
          gg.hintPauseByClientId = client.clientId;
          return { active: true, startedAt: gg.hintPauseStartedAtMs } as const;
        })();

        try {
          const shooterSoldier = turnPlayer.soldiers[turnPlayer.currentTurnSoldier];
          if (!shooterSoldier) throw new Error("No shooter soldier");
          const payload = (msg as any).payload as
            | { shooter?: { x: number; y: number }; target?: { x: number; y: number }; debug?: boolean }
            | undefined;
          const debugRequested = payload?.debug === true;
          const debugAlwaysOnError = process.env.AI_DEBUG_ON_ERROR === "1";
          const debugEvents: any[] = [];

          const inverted = turnPlayer.team === 2;

          const toGameCoordsFromPixels = (p: { x: number; y: number }) => {
            const { PLANE_LENGTH, PLANE_HEIGHT, PLANE_GAME_LENGTH } = GAME_CONSTANTS;
            let x = p.x;
            const y = p.y;
            if (inverted) x = PLANE_LENGTH - x;
            return {
              x: (PLANE_GAME_LENGTH * (x - PLANE_LENGTH / 2)) / PLANE_LENGTH,
              y: (PLANE_GAME_LENGTH * (-y + PLANE_HEIGHT / 2)) / PLANE_LENGTH,
            };
          };

          const shooterGame = toGameCoordsFromPixels({ x: shooterSoldier.x, y: shooterSoldier.y });

          const isAheadTarget = (t: { x: number; y: number }) => {
            const tg = toGameCoordsFromPixels({ x: t.x, y: t.y });
            const dx = tg.x - shooterGame.x;
            return Number.isFinite(dx) && dx > 0.15;
          };

          const selectNearestEnemyTargetAhead = () => {
            let best: { x: number; y: number } | null = null;
            let bestD = Number.POSITIVE_INFINITY;
            for (const p of g.players) {
              if (p.team === turnPlayer.team) continue;
              for (const s of p.soldiers) {
                if (!s.alive) continue;
                const cand = { x: s.x, y: s.y };
                if (!isAheadTarget(cand)) continue;
                const d = distSq({ x: shooterSoldier.x, y: shooterSoldier.y }, cand);
                if (d < bestD) {
                  bestD = d;
                  best = cand;
                }
              }
            }
            return best;
          };

          // Use the payload target if provided; map it to the nearest alive enemy soldier.
          const desiredTarget = payload?.target;
          let target: { x: number; y: number } | null = null;
          if (desiredTarget && Number.isFinite(desiredTarget.x) && Number.isFinite(desiredTarget.y)) {
            let best = Number.POSITIVE_INFINITY;
            for (const p of g.players) {
              if (p.team === turnPlayer.team) continue;
              for (const s of p.soldiers) {
                if (!s.alive) continue;
                const d = distSq({ x: s.x, y: s.y }, { x: desiredTarget.x, y: desiredTarget.y });
                if (d < best) {
                  best = d;
                  const cand = { x: s.x, y: s.y };
                  if (isAheadTarget(cand)) target = cand;
                }
              }
            }
          }
          if (!target) target = selectNearestEnemyTargetAhead() ?? selectNearestEnemyTarget(g, turnPlayer);
          if (!target) throw new Error("No valid target");

          // If the target is behind relative to the shoot direction, re-pick an ahead target to avoid impossible hints.
          if (!isAheadTarget(target)) {
            const ahead = selectNearestEnemyTargetAhead();
            if (ahead) target = ahead;
          }
          const dxLocalPixels = inverted ? shooterSoldier.x - target.x : target.x - shooterSoldier.x;
          const dyLocalGameSign = -(target.y - shooterSoldier.y);

          const fallbackFn = botChooseFunction(g.mode, dxLocalPixels, dyLocalGameSign);

          const distSq2 = (a: { x: number; y: number }, b: { x: number; y: number }) => {
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            return dx * dx + dy * dy;
          };

          const targetGame = toGameCoordsFromPixels({ x: target.x, y: target.y });
          const dxLocalGame = targetGame.x - shooterGame.x;
          const dyLocalGame = targetGame.y - shooterGame.y;

          const aliveEnemySoldiers = g.players.flatMap((p) =>
            p.team !== turnPlayer.team ? p.soldiers.filter((s) => s.alive) : [],
          );
          const enemySoldiersAliveCount = aliveEnemySoldiers.length;
          const enemies = aliveEnemySoldiers.map((s) => ({ x: s.x, y: s.y })).slice(0, 24);

          const aliveTeams = Array.from(
            new Set(g.players.filter((p) => p.soldiers.some((s) => s.alive)).map((p) => p.team)),
          );
          const isTwoTeamMatch = aliveTeams.length === 2;
          const wantsMultiHit = isTwoTeamMatch && enemySoldiersAliveCount >= 2;

          const materializeTemplateFunction = (fnRaw: string) => {
            let fn = String(fnRaw || "");

            // Some LLMs return template variables (dx, dy, dy/dx). Graphwar does not support these symbols,
            // so we substitute them using the current local-game target vector.
            const dx = dxLocalGame;
            const dy = dyLocalGame;
            const m = Number.isFinite(dx) && Math.abs(dx) > 1e-12 ? dy / dx : 0;

            // Replace dy/dx first to avoid clobbering "dy" or "dx" replacements.
            fn = fn.replace(/\bdy\s*\/\s*dx\b/gi, `(${m.toFixed(8)})`);
            fn = fn.replace(/\bdy\b/gi, `(${dy.toFixed(8)})`);
            fn = fn.replace(/\bdx\b/gi, `(${dx.toFixed(8)})`);

            // Remove double spaces introduced by substitutions.
            fn = fn.replace(/\s+/g, " ").trim();
            return fn;
          };

          const isShotGoodEnough = (fn: string) => {
            const shot = simulateShot({
              mode: g.mode,
              functionString: fn,
              terrain: g.terrain,
              players: g.players,
              currentTurnIndex: g.currentTurnIndex,
              maxSteps: 3500,
            });
            const r = GAME_CONSTANTS.EXPLOSION_RADIUS;

            // Hard rule for practice hints: do not accept any function whose trajectory hits terrain/bounds.
            // Our physics uses point sampling per step; to avoid "tunneling" through circles between steps,
            // also sample along each segment in pixel-space.
            const pathCollidesTerrain = (() => {
              const pts = shot.path;
              if (!pts.length) return true;

              const stepPx = 6; // smaller => stricter collision check
              const terrain = g.terrain;

              const checkPoint = (p: { x: number; y: number }) => collidePoint(terrain, p);

              for (let i = 0; i < pts.length; i++) {
                const p = pts[i]!;
                if (checkPoint(p)) return true;

                const prev = i > 0 ? pts[i - 1]! : null;
                if (!prev) continue;

                const dx = p.x - prev.x;
                const dy = p.y - prev.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const steps = Math.max(1, Math.ceil(dist / stepPx));
                for (let s = 1; s < steps; s++) {
                  const t = s / steps;
                  const sp = { x: prev.x + dx * t, y: prev.y + dy * t };
                  if (checkPoint(sp)) return true;
                }
              }
              return false;
            })();

            // Use closest approach along the path, not the final collision point.
            // This avoids incorrectly accepting shots that collide with a blocker near the target line.
            let bestD2 = Number.POSITIVE_INFINITY;
            let bestLocalX = Number.NEGATIVE_INFINITY;
            for (const pt of shot.path) {
              const d2 = distSq2(pt, target);
              if (d2 < bestD2) {
                bestD2 = d2;
                const ptGame = toGameCoordsFromPixels(pt);
                bestLocalX = ptGame.x - shooterGame.x;
              }
            }

            // Also require meaningful forward progress in LOCAL GAME X.
            // Otherwise it can clip a circle early and never really threaten the target.
            const progressOk =
              Number.isFinite(dxLocalGame) && dxLocalGame > 1e-6
                ? bestLocalX >= dxLocalGame * 0.85
                : true;

            const nearTargetOk = bestD2 <= (r * 1.25) * (r * 1.25);

            // Count unique ENEMY soldier hits (friendly fire doesn't kill).
            const shooterTeam = turnPlayer.team;
            const enemyHitCount = (() => {
              const seen = new Set<string>();
              for (const h of shot.hits) {
                const tp = g.players.find((p) => p.clientId === h.targetClientId);
                if (!tp || tp.team === shooterTeam) continue;
                seen.add(`${h.targetClientId}:${h.soldierIndex}`);
              }
              return seen.size;
            })();

            const multiHitOk = !wantsMultiHit ? true : enemyHitCount >= 2;
            return {
              ok: !pathCollidesTerrain && progressOk && (wantsMultiHit ? multiHitOk : nearTargetOk),
              shot,
              lastLocalX: bestLocalX,
              collided: pathCollidesTerrain,
              bestD2,
              enemyHitCount,
            };
          };

          const tryAutoParabolaSearch = () => {
            if (g.mode !== "normal") return null;
            if (!Number.isFinite(dxLocalGame) || Math.abs(dxLocalGame) < 1e-6) return null;

            const dx = dxLocalGame;
            const dy = dyLocalGame;
            const m = dy / dx;

            // Scan curvature magnitudes; negative a lifts (because x*(x-dx) is negative mid-way).
            const mags = [0.0005, 0.001, 0.002, 0.004, 0.008, 0.012, 0.02, 0.03, 0.05, 0.08];
            const candidates: number[] = [];
            for (const mag of mags) {
              candidates.push(-mag, mag);
            }

            for (const a of candidates) {
              const fn = `${m.toFixed(6)}*x + ${a.toFixed(6)}*x*(x-${dx.toFixed(4)})`;
              try {
                validateFunction(fn);
                const res = isShotGoodEnough(fn);
                if (res.ok) return { fn, m, a };
              } catch {
                // ignore
              }
            }
            return null;
          };

          const validateFunction = (fn: string) => {
            // Validate parseability quickly using the current authoritative game state.
            simulateShot({
              mode: g.mode,
              functionString: fn,
              terrain: g.terrain,
              players: g.players,
              currentTurnIndex: g.currentTurnIndex,
              maxSteps: 400,
            });
          };

          try {
            const llmArgs = {
              mode: g.mode,
              shooterTeam: turnPlayer.team,
              shooter: { x: shooterSoldier.x, y: shooterSoldier.y },
              target: { x: target.x, y: target.y },
              enemies,
              objective: wantsMultiHit ? ("multi" as const) : ("single" as const),
              obstacles: pickRelevantObstacles({
                shooter: { x: shooterSoldier.x, y: shooterSoldier.y },
                target: { x: target.x, y: target.y },
                terrain: g.terrain,
              }),
              dxLocalPixels,
              dyLocalGameSign,
            } as const;

            const maxAttempts = (() => {
              const raw = process.env.AI_HINT_MAX_ATTEMPTS;
              if (!raw) return 10;
              const n = Number(raw);
              if (!Number.isFinite(n) || n <= 0) return 10;
              return Math.max(1, Math.min(10, Math.floor(n)));
            })();

            let bestCandidate:
              | {
                  functionString: string;
                  explanation?: string;
                  bestD2: number;
                  enemyHitCount: number;
                }
              | null = null;

            let nextFeedback: string | undefined;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              send(ws, { type: "hint.progress", attempt, maxAttempts, status: "thinking" });
              const hint = await generateLlmHint(
                {
                  ...llmArgs,
                  validationFeedback: nextFeedback,
                },
                debugRequested || debugAlwaysOnError ? (ev) => debugEvents.push(ev) : undefined,
              );

              try {
                const fn = materializeTemplateFunction(hint.functionString);
                validateFunction(fn);

                const evalRes = isShotGoodEnough(fn);
                const minDistPx = Math.sqrt(evalRes.bestD2);

                // Track best candidate by multi-hit first, then distance.
                if (!evalRes.collided && Number.isFinite(evalRes.bestD2)) {
                  if (
                    !bestCandidate ||
                    evalRes.enemyHitCount > bestCandidate.enemyHitCount ||
                    (evalRes.enemyHitCount === bestCandidate.enemyHitCount && evalRes.bestD2 < bestCandidate.bestD2)
                  ) {
                    bestCandidate = {
                      functionString: fn,
                      explanation: hint.explanation,
                      bestD2: evalRes.bestD2,
                      enemyHitCount: evalRes.enemyHitCount,
                    };
                  }
                }

                if (evalRes.ok) {
                  send(ws, { type: "hint.progress", attempt, maxAttempts, status: "done" });
                  send(ws, {
                    type: "hint.response",
                    functionString: fn,
                    explanation: `${hint.explanation ?? "AI hint."} (attempt ${attempt}/${maxAttempts}, validated no terrain collision)`,
                    debug: debugRequested ? { events: debugEvents as any } : undefined,
                  });
                  return;
                }

                const lastLocalY = (() => {
                  const lastGame = toGameCoordsFromPixels(evalRes.shot.lastPoint);
                  return lastGame.y - shooterGame.y;
                })();

                // Provide concrete collision/near-miss feedback for the next attempt.
                nextFeedback =
                  `Attempt ${attempt}/${maxAttempts} was rejected by the game engine simulation. ` +
                  (evalRes.collided ? `It collided with terrain/bounds (including between steps). ` : `It did not collide, but missed the target. `) +
                  (wantsMultiHit ? `Enemy hits achieved: ${evalRes.enemyHitCount}. Try to hit 2+ enemies if possible. ` : ``) +
                  `Closest distance to target was ~${minDistPx.toFixed(1)}px. ` +
                  `It stopped at LocalGame approx (x=${evalRes.lastLocalX.toFixed(3)}, y=${lastLocalY.toFixed(3)}), ` +
                  `but needs to reach (dx=${dxLocalGame.toFixed(3)}, dy=${dyLocalGame.toFixed(3)}). ` +
                  `Adjust the curve to increase clearance around the blocking circles and reduce miss distance.`;

                debugEvents.push({
                  type: "error",
                  message: `Attempt ${attempt} rejected: collided=${String(evalRes.collided)} minDistPx=${minDistPx.toFixed(
                    1,
                  )} lastPoint=(${evalRes.shot.lastPoint.x.toFixed(1)},${evalRes.shot.lastPoint.y.toFixed(1)})`,
                });
              } catch {
                // unparsable function; keep retrying
                nextFeedback =
                  `Attempt ${attempt}/${maxAttempts} was rejected because the function was not parseable/executable by the game engine. ` +
                  `Return a simpler valid expression using only supported tokens.`;
              }
            }

            // If no perfect shot found, prefer a deterministic local parabola search.
            const auto = tryAutoParabolaSearch();
            if (auto) {
              send(ws, { type: "hint.progress", attempt: maxAttempts, maxAttempts, status: "done" });
              send(ws, {
                type: "hint.response",
                functionString: auto.fn,
                explanation:
                  `Auto-adjusted a parabola to clear terrain and still reach the target (LLM failed after ${maxAttempts} attempts; validated no terrain collision).`,
                debug: debugRequested ? { events: debugEvents as any } : undefined,
              });
              return;
            }

            // Otherwise, if we have a non-colliding best candidate, return it even if it slightly misses.
            if (bestCandidate) {
              send(ws, { type: "hint.progress", attempt: maxAttempts, maxAttempts, status: "done" });
              send(ws, {
                type: "hint.response",
                functionString: bestCandidate.functionString,
                explanation:
                  bestCandidate.explanation ??
                  `Best non-colliding AI hint found after ${maxAttempts} attempts (multi-hit=${bestCandidate.enemyHitCount}; may still miss slightly; validated no terrain collision).`,
                debug: debugRequested ? { events: debugEvents as any } : undefined,
              });
              return;
            }

            // Fall back to a safe baseline.
            send(ws, {
              type: "hint.response",
              functionString: fallbackFn,
              explanation: `AI couldn't find a safe path after ${maxAttempts} attempts; using a safe fallback.`,
              debug: debugRequested ? { events: debugEvents as any } : undefined,
            });
            return;
          } catch (e) {
            // LLM can fail or return malformed output; still give a usable hint.
            const rawReason = e instanceof Error ? e.message : "AI failed";

            const oneLine = String(rawReason)
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 400);

            const retryInSeconds = (() => {
              const m = oneLine.match(/Please retry in\s+([0-9]+(?:\.[0-9]+)?)s/i);
              if (!m) return null;
              const n = Number(m[1]);
              return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
            })();

            const is429 = /LLM request failed \(429\)/i.test(oneLine) || /\bcode\s*[:=]?\s*429\b/i.test(oneLine);
            const looksLikeQuota = /quota|rate limit|RESOURCE_EXHAUSTED/i.test(oneLine);

            const reasonForUser = (() => {
              if (is429 || looksLikeQuota) {
                const suffix = retryInSeconds ? ` Retry in ~${retryInSeconds}s.` : "";
                return `AI is rate-limited/quota-limited (HTTP 429).${suffix}`;
              }
              return oneLine.length ? oneLine : "AI failed";
            })();

            // Keep the full error server-side for debugging.
            console.warn("AI hint failed:", rawReason);
            send(ws, { type: "hint.progress", attempt: 0, maxAttempts: 0, status: "error" });
            send(ws, {
              type: "hint.response",
              functionString: fallbackFn,
              explanation: `AI failed (${reasonForUser}); using a safe fallback.`,
              debug:
                debugRequested || debugAlwaysOnError
                  ? {
                      events: (debugEvents as any[]).concat([
                        {
                          type: "error",
                          message: String(rawReason),
                        },
                      ]),
                    }
                  : undefined,
            });
            return;
          }
        } catch (e) {
          send(ws, { type: "error", message: e instanceof Error ? e.message : "Hint failed" });
        } finally {
          // Resume turn timer and give back the paused duration.
          if (pauseTurn.active && room.game && room.game.hintPauseStartedAtMs != null) {
            const gg = room.game;
            const pausedFor = now() - (gg.hintPauseStartedAtMs ?? now());
            gg.timeTurnStarted += pausedFor;
            gg.hintPauseStartedAtMs = undefined;
            gg.hintPauseByClientId = undefined;
            broadcast(room, { type: "room.state", room: getRoomState(room) });
            broadcastLobbyState();
          }
        }
      })();
      return;
    }

    case "chat.send": {
      if (!client.roomId) {
        send(ws, { type: "error", message: "Not in a room" });
        return;
      }
      const room = roomsById.get(client.roomId);
      if (!room) return;

      const text = msg.text.trim().slice(0, 240);
      if (!text) return;

      broadcast(room, {
        type: "chat.msg",
        roomId: room.id,
        from: client.name,
        text,
        ts: Date.now(),
      });
      return;
    }
  }
}

// Turn timer (similar to Java TURN_TIME). Keeps it simple: 60s.
setInterval(() => {
  const TURN_TIME_MS = GAME_CONSTANTS.TURN_TIME_MS;
  for (const room of roomsById.values()) {
    if (room.gameState !== "in_game" || !room.game) continue;
    if (room.game.hintPauseStartedAtMs != null) continue;
    if (now() - room.game.timeTurnStarted > TURN_TIME_MS) {
      advanceTurn(room);
      broadcast(room, { type: "room.state", room: getRoomState(room) });
      broadcastLobbyState();
    }
  }
}, 500);

wss.on("connection", (ws) => {
  const clientId = nanoid(10);
  clientsBySocket.set(ws, { clientId, name: "Player", roomId: null, ready: false });

  send(ws, { type: "welcome", clientId, protocolVersion: PROTOCOL_VERSION });
  send(ws, { type: "lobby.state", rooms: getLobbyState() });
  send(ws, { type: "room.state", room: null });

  ws.on("message", (data) => {
    const raw = typeof data === "string" ? data : data.toString("utf-8");
    const parsed = safeParseJsonMessage(raw);
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
      send(ws, { type: "error", message: "Invalid message" });
      return;
    }

    handleMessage(ws, parsed as ClientToServerMessage);
  });

  ws.on("close", () => {
    leaveRoom(ws);
    clientsBySocket.delete(ws);
    broadcastLobbyState();
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Graphwar web server listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});
