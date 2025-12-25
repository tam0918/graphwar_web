import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { nanoid } from "nanoid";
import {
  encodeMessage,
  PROTOCOL_VERSION,
  safeParseJsonMessage,
  GAME_CONSTANTS,
  randomGaussian,
  type GameMode,
  simulateShot,
  type TerrainState,
  type TerrainCircle,
  type PlayerGameState,
  type ClientToServerMessage,
  type PlayerState,
  type RoomState,
  type RoomSummary,
  type ServerToClientMessage,
  type LastGameOver,
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
  clients: Set<WebSocket>;
  gameState: "lobby" | "in_game";
  lastGameOver?: LastGameOver;
  game?: {
    mode: GameMode;
    terrain: TerrainState;
    players: PlayerGameState[];
    currentTurnIndex: number;
    timeTurnStarted: number;
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
    timers: Set<NodeJS.Timeout>;
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

function now() {
  return Date.now();
}

function asRoomState(room: Room): RoomState {
  const base = {
    id: room.id,
    name: room.name,
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
  base.players.sort((a, b) => a.name.localeCompare(b.name));

  if (room.gameState !== "in_game" || !room.game) return base;

  const currentTurnClientId = room.game.players[room.game.currentTurnIndex]?.clientId ?? "";
  return {
    ...base,
    game: {
      mode: room.game.mode,
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
      numPlayers: room.clients.size,
      gameState: room.gameState,
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

  const players: PlayerGameState[] = [];
  const sorted = Array.from(room.clients)
    .map((ws) => clientsBySocket.get(ws))
    .filter(Boolean)
    .map((c) => c!)
    .sort((a, b) => a.clientId.localeCompare(b.clientId));

  // Alternate teams similar to Java reorder behavior (simplified deterministic).
  let team: 1 | 2 = Math.random() < 0.5 ? 1 : 2;
  for (const c of sorted) {
    players.push({
      clientId: c.clientId,
      name: c.name,
      team,
      soldiers: new Array(1).fill(null).map(() => ({ x: 0, y: 0, angle: 0, alive: true })),
      currentTurnSoldier: 0,
    });
    team = team === 1 ? 2 : 1;
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
    terrain,
    players,
    currentTurnIndex: startIdx,
    timeTurnStarted: now(),
    phase: "playing",
    timers: new Set<NodeJS.Timeout>(),
  };
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

    case "room.create": {
      const roomName = msg.name.trim().slice(0, 32);
      if (!roomName) {
        send(ws, { type: "error", message: "Room name is required" });
        return;
      }
      const room: Room = {
        id: nanoid(8),
        name: roomName,
        clients: new Set<WebSocket>(),
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

      const allReady = Array.from(room.clients).every((s) => clientsBySocket.get(s)?.ready);
      if (!allReady) {
        send(ws, { type: "error", message: "All players must be ready" });
        return;
      }

      startGame(room);
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

      const g = room.game;

      if (g.phase === "animating_shot") {
        send(ws, { type: "error", message: "Shot is already animating" });
        return;
      }

      const turnPlayer = g.players[g.currentTurnIndex];
      if (!turnPlayer || turnPlayer.clientId !== client.clientId) {
        send(ws, { type: "error", message: "Not your turn" });
        return;
      }

      const functionString = msg.functionString.trim();
      if (!functionString) {
        send(ws, { type: "error", message: "Function is required" });
        return;
      }

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
        send(ws, { type: "error", message: "Malformed function" });
        return;
      }

      // Begin animation timeline (Java-like)
      const startedAtMs = now();
      const functionVelocity = GAME_CONSTANTS.FUNCTION_VELOCITY;
      g.phase = "animating_shot";
      g.lastShot = {
        byClientId: client.clientId,
        functionString,
        fireAngle: shot.fireAngle,
        startedAtMs,
        functionVelocity,
        explosion: shot.explosion,
        hits: shot.hits,
        path: shot.path,
      };

      // Server schedules kills and explosion application
      for (const h of shot.hits) {
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

      // Apply terrain hole at end of drawing
      schedule(room, explodeAtMs - now(), () => {
        const gg = room.game;
        if (!gg || gg.phase !== "animating_shot" || gg.lastShot?.startedAtMs !== startedAtMs) return;
        gg.terrain.holes.push(shot.explosion);
        // Clear the projectile path as soon as drawing finishes.
        // This makes it obvious to the other player that the shot is done.
        if (gg.lastShot) gg.lastShot.path = [];
        broadcast(room, { type: "room.state", room: getRoomState(room) });
      });

      // Next turn after NEXT_TURN_DELAY
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
