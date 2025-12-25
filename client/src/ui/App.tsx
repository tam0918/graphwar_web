import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  encodeMessage,
  GAME_CONSTANTS,
  type GameMode,
  type DifficultyMode,
  type MatchPreset,
  simulateShot,
  type ShotResult,
  type RoomState,
  type RoomSummary,
  type ServerToClientMessage,
} from "@graphwar/shared";
import { GameCanvas } from "./GameCanvas";

const DEFAULT_WS_URL = "ws://localhost:8080/ws";

type ChatLine = { from: string; text: string; ts: number };

function distSq(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function App() {
  const debugGemini = (() => {
    try {
      return new URLSearchParams(window.location.search).get("debugGemini") === "1";
    } catch {
      return false;
    }
  })();

  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [name, setName] = useState("Player");
  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);

  const [newRoomName, setNewRoomName] = useState("My Room");
  const [newRoomPreset, setNewRoomPreset] = useState<MatchPreset>("1vX");
  const [newRoomDifficulty, setNewRoomDifficulty] = useState<DifficultyMode>("practice");
  const [chatText, setChatText] = useState("");

  const [functionString, setFunctionString] = useState("x");
  const [angle, setAngle] = useState(0);
  const [mode, setMode] = useState<GameMode>("normal");

  const [showCoordinates, setShowCoordinates] = useState(false);

  const [dismissedGameOverAt, setDismissedGameOverAt] = useState<number | null>(null);

  const inRoom = !!room;

  const inGame = room?.gameState === "in_game" && !!room.game;
  const isMyTurn = inGame && !!clientId && room.game!.currentTurnClientId === clientId;

  const lastGameOver = room?.gameState === "lobby" ? room?.lastGameOver ?? null : null;
  const showGameOverPanel = !!lastGameOver && dismissedGameOverAt !== lastGameOver.endedAt;
  const inPostGame = !!room && showGameOverPanel;

  const [previewShot, setPreviewShot] = useState<ShotResult | null>(null);

  const [hintThinking, setHintThinking] = useState<{
    attempt: number;
    maxAttempts: number;
    frozenTurnSecondsLeft: number | null;
  } | null>(null);

  const [nowMs, setNowMs] = useState(() => Date.now());

  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  const turnSecondsLeftLive = useMemo(() => {
    if (!inGame || !room?.game) return null;
    const elapsed = nowMs - room.game.timeTurnStarted;
    const left = Math.ceil((GAME_CONSTANTS.TURN_TIME_MS - elapsed) / 1000);
    return Math.max(0, left);
  }, [inGame, room, nowMs]);

  useEffect(() => {
    if (!hintThinking) return;
    if (hintThinking.frozenTurnSecondsLeft != null) return;
    if (!isMyTurn) return;
    if (turnSecondsLeftLive == null) return;
    setHintThinking((prev) => (prev ? { ...prev, frozenTurnSecondsLeft: turnSecondsLeftLive } : prev));
  }, [hintThinking, isMyTurn, turnSecondsLeftLive]);

  const turnSecondsLeft = useMemo(() => {
    if (!hintThinking || !isMyTurn) return turnSecondsLeftLive;
    return hintThinking.frozenTurnSecondsLeft ?? turnSecondsLeftLive;
  }, [hintThinking, isMyTurn, turnSecondsLeftLive]);

  const ready = useMemo(() => {
    if (!room) return false;
    // Derive local state by stable clientId (names can collide).
    const me = clientId ? room.players.find((p) => p.clientId === clientId) : undefined;
    return me?.ready ?? false;
  }, [room, clientId]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  function send(msg: any) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (msg && typeof msg === "object" && msg.type === "hint.request") {
      // eslint-disable-next-line no-console
      console.log("[WS send] hint.request", msg);
      if (!debugGemini) {
        // eslint-disable-next-line no-console
        console.log("Tip: add ?debugGemini=1 to receive server-side LLM HTTP debug events in hint.response");
      }
    }
    ws.send(typeof msg === "string" ? msg : encodeMessage(msg));
  }

  function connect() {
    if (wsRef.current) wsRef.current.close();

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setChat([]);
      setClientId(null);
      send({ type: "hello", name });
    };

    ws.onclose = () => {
      setConnected(false);
      setRoom(null);
    };

    ws.onmessage = (ev) => {
      let msg: ServerToClientMessage | null = null;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }

      if (!msg) return;

      if (msg.type === "welcome") {
        setClientId(msg.clientId);
      } else if (msg.type === "lobby.state") {
        setRooms(msg.rooms);
      } else if (msg.type === "room.state") {
        setRoom(msg.room);

        if (msg.room?.game) {
          setMode(msg.room.game.mode);
          const me = clientId ? msg.room.game.players.find((p) => p.clientId === clientId) : undefined;
          const s = me ? me.soldiers[me.currentTurnSoldier] : undefined;
          if (s) setAngle(s.angle);
        }
      } else if (msg.type === "chat.msg") {
        setChat((prev) => prev.concat({ from: msg.from, text: msg.text, ts: msg.ts }));
      } else if (msg.type === "hint.response") {
        // eslint-disable-next-line no-console
        console.log("[WS recv] hint.response", msg);
        setHintThinking(null);
        setFunctionString(msg.functionString);
        if (debugGemini && msg.debug?.events) {
          // eslint-disable-next-line no-console
          console.log("[LLM debug events]", msg.debug.events);
          // eslint-disable-next-line no-console
          console.log("Network tip: in DevTools -> Network, click WS request, then Frames to see websocket traffic.");
        }
        if (msg.explanation) {
          setChat((prev) => prev.concat({ from: "hint", text: msg.explanation!, ts: Date.now() }));
        }
      } else if (msg.type === "hint.progress") {
        if (msg.status === "thinking") {
          setHintThinking((prev) => ({
            attempt: msg.attempt,
            maxAttempts: msg.maxAttempts,
            frozenTurnSecondsLeft: prev?.frozenTurnSecondsLeft ?? null,
          }));
        } else {
          setHintThinking(null);
        }
      } else if (msg.type === "error") {
        setChat((prev) => prev.concat({ from: "server", text: msg.message, ts: Date.now() }));
      }
    };
  }

  useEffect(() => {
    // Live trajectory preview while typing, only for the current player.
    if (!inGame || !room?.game || !clientId || !isMyTurn) {
      setPreviewShot(null);
      return;
    }
    if (room.game.difficulty !== "practice") {
      setPreviewShot(null);
      return;
    }
    if (room.game.phase === "animating_shot") {
      setPreviewShot(null);
      return;
    }

    const currentTurnIndex = room.game.players.findIndex((p) => p.clientId === room.game!.currentTurnClientId);
    if (currentTurnIndex < 0) {
      setPreviewShot(null);
      return;
    }

    const t = setTimeout(() => {
      try {
        // Clone players so we can apply local angle immediately for snd_ode
        const players = room.game!.players.map((p) => ({
          ...p,
          soldiers: p.soldiers.map((s) => ({ ...s })),
        }));

        const shooter = players[currentTurnIndex];
        const shooterSoldier = shooter?.soldiers[shooter?.currentTurnSoldier ?? 0];
        if (shooterSoldier) shooterSoldier.angle = angle;

        const shot = simulateShot({
          mode,
          functionString,
          terrain: room.game!.terrain,
          players: players as any,
          currentTurnIndex,
          maxSteps: 3500,
        });

        setPreviewShot(shot);
      } catch {
        // If function is malformed or blows up, hide preview.
        setPreviewShot(null);
      }
    }, 120);

    return () => clearTimeout(t);
  }, [inGame, isMyTurn, room, clientId, functionString, angle, mode]);

  const topBar = (
    <section style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
      {!inGame ? (
        <>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            WebSocket URL
            <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} style={{ width: 280 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
          </label>
          <button onClick={connect} disabled={connected}>
            {connected ? "Connected" : "Connect"}
          </button>
        </>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          {connected ? "Connected" : "Disconnected"}
          {clientId ? ` • id: ${clientId.slice(0, 6)}` : ""}
          {room ? ` • room: ${room.name}` : ""}
        </div>
      )}

      <button
        onClick={() => {
          wsRef.current?.close();
        }}
        disabled={!connected}
      >
        Disconnect
      </button>
    </section>
  );

  const lobbyScreen = (
    <div className="gw-lobbyLayout">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <h2>Lobby</h2>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            disabled={!connected}
            style={{ flex: 1 }}
          />
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, opacity: 0.9 }}>
            preset
            <select value={newRoomPreset} onChange={(e) => setNewRoomPreset(e.target.value as MatchPreset)} disabled={!connected}>
              <option value="1vX">1vX (max 6)</option>
              <option value="2v2">2v2</option>
              <option value="4v4">4v4</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, opacity: 0.9 }}>
            mode
            <select
              value={newRoomDifficulty}
              onChange={(e) => setNewRoomDifficulty(e.target.value as DifficultyMode)}
              disabled={!connected}
            >
              <option value="practice">practice (hints)</option>
              <option value="hard">hard (no hints)</option>
            </select>
          </label>
          <button
            onClick={() =>
              send({
                type: "room.create",
                name: newRoomName,
                config: { preset: newRoomPreset, difficulty: newRoomDifficulty },
              })
            }
            disabled={!connected}
          >
            Create
          </button>
        </div>

        <button onClick={() => send({ type: "lobby.listRooms" })} disabled={!connected}>
          Refresh rooms
        </button>

        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {rooms.map((r) => (
            <li key={r.id} style={{ margin: "8px 0" }}>
              <div>
                <strong>{r.name}</strong>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  players: {r.numPlayers}/{r.maxPlayers} • preset: {r.preset} • mode: {r.difficulty} • state: {r.gameState}
                </div>
              </div>
              <button onClick={() => send({ type: "room.join", roomId: r.id })} disabled={!connected}>
                Join
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <h2>Room</h2>
        {room ? (
          <>
            <div>
              <strong>{room.name}</strong>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                state: {room.gameState} • players: {room.players.length}/{room.config.maxPlayers} • preset: {room.config.preset} • mode: {room.config.difficulty}
              </div>
            </div>

            <>
              {clientId && room.gameState === "lobby" && clientId === room.ownerClientId ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, opacity: 0.9 }}>
                    preset
                    <select
                      value={room.config.preset}
                      onChange={(e) => send({ type: "room.setConfig", config: { preset: e.target.value as MatchPreset } })}
                      disabled={!connected}
                    >
                      <option value="1vX">1vX (max 6)</option>
                      <option value="2v2">2v2</option>
                      <option value="4v4">4v4</option>
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, opacity: 0.9 }}>
                    mode
                    <select
                      value={room.config.difficulty}
                      onChange={(e) =>
                        send({ type: "room.setConfig", config: { difficulty: e.target.value as DifficultyMode } })
                      }
                      disabled={!connected}
                    >
                      <option value="practice">practice (hints)</option>
                      <option value="hard">hard (no hints)</option>
                    </select>
                  </label>
                  <button onClick={() => send({ type: "room.addBot" })} disabled={!connected}>
                    Add bot
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {clientId === room.ownerClientId ? "" : "Only owner can change preset/mode and add bots."}
                </div>
              )}

                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {room.players.map((p) => (
                    <li key={p.clientId}>
                      {p.name} {p.isBot ? "(bot)" : ""} {p.ready ? "(ready)" : ""}
                      {clientId === room.ownerClientId && room.gameState === "lobby" && p.isBot ? (
                        <button
                          style={{ marginLeft: 8 }}
                          onClick={() => send({ type: "room.removeBot", clientId: p.clientId })}
                          disabled={!connected}
                        >
                          remove
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => send({ type: "player.ready", ready: !ready })} disabled={!connected}>
                    {ready ? "Unready" : "Ready"}
                  </button>
                  <button onClick={() => send({ type: "game.start" })} disabled={!connected}>
                    Start
                  </button>
                  <button
                    onClick={() => {
                      send({ type: "room.leave" });
                      setRoom(null);
                    }}
                    disabled={!connected}
                  >
                    Leave
                  </button>
                </div>

                <div>
                  <h3 style={{ marginBottom: 8 }}>Chat</h3>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      value={chatText}
                      onChange={(e) => setChatText(e.target.value)}
                      disabled={!connected || !inRoom}
                      style={{ flex: 1 }}
                      placeholder={inRoom ? "Say something" : "Join a room to chat"}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          send({ type: "chat.send", text: chatText });
                          setChatText("");
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        send({ type: "chat.send", text: chatText });
                        setChatText("");
                      }}
                      disabled={!connected || !inRoom}
                    >
                      Send
                    </button>
                  </div>
                  <div className="gw-chatLog" style={{ height: 260 }}>
                    {chat.map((c, idx) => (
                      <div key={idx} style={{ marginBottom: 6 }}>
                        <span style={{ fontSize: 12, opacity: 0.75 }}>{new Date(c.ts).toLocaleTimeString()} </span>
                        <strong>{c.from}:</strong> {c.text}
                      </div>
                    ))}
                  </div>
                </div>
            </>
          </>
        ) : (
          <div style={{ opacity: 0.75 }}>Join or create a room to play.</div>
        )}
      </div>
    </div>
  );

  const postGameScreen = !room || !lastGameOver ? null : (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <h2 style={{ margin: 0 }}>Game Over</h2>
      <div style={{ fontSize: 16, opacity: 0.9 }}>
        {lastGameOver.winnerTeam == null ? "Result: Draw" : `Winner: Team ${lastGameOver.winnerTeam}`}
      </div>
      {lastGameOver.winners.length ? (
        <div style={{ fontSize: 14, opacity: 0.9 }}>Winners: {lastGameOver.winners.map((w) => w.name).join(", ")}</div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setDismissedGameOverAt(lastGameOver.endedAt)}>Play again (back to room)</button>
        <button
          onClick={() => {
            send({ type: "room.leave" });
            setRoom(null);
          }}
          disabled={!connected}
        >
          Out
        </button>
      </div>
      <div style={{ fontSize: 12, opacity: 0.75 }}>
        Room: <strong>{room.name}</strong>
      </div>
    </div>
  );

  const gameScreen = (
    <div className="gw-gameLayout">
      <div className="gw-gameMain">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Game</h2>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Turn: {room?.game?.players.find((p) => p.clientId === room.game!.currentTurnClientId)?.name ?? "?"}
            {turnSecondsLeft != null ? ` • ${turnSecondsLeft}s` : ""}
          </div>
        </div>

        <div className="gw-canvasWrap">
          <GameCanvas room={room} previewShot={previewShot} showCoordinates={showCoordinates} />
        </div>
      </div>

      <div className="gw-gameSide">
        <h3 style={{ margin: 0 }}>Actions</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={async () => {
              try {
                if (!document.fullscreenElement) {
                  await document.documentElement.requestFullscreen();
                } else {
                  await document.exitFullscreen();
                }
              } catch {
                // Some browsers/devices can block fullscreen; ignore.
              }
            }}
          >
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
          <button
            onClick={() => setShowCoordinates((v) => !v)}
            title="Show/hide soldier coordinates"
          >
            {showCoordinates ? "Hide coordinates" : "Show coordinates"}
          </button>
          <button
            onClick={() => {
              send({ type: "room.leave" });
              setRoom(null);
            }}
            disabled={!connected}
          >
            Out room
          </button>
          <button
            onClick={() => {
              send({ type: "game.surrender" });
            }}
            disabled={!connected}
          >
            Surrender
          </button>
        </div>

        <div>
          <h3 style={{ margin: 0 }}>Chat</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              disabled={!connected || !inRoom}
              style={{ flex: 1, minWidth: 0 }}
              placeholder={inRoom ? "Say something" : "Join a room to chat"}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  send({ type: "chat.send", text: chatText });
                  setChatText("");
                }
              }}
            />
            <button
              onClick={() => {
                send({ type: "chat.send", text: chatText });
                setChatText("");
              }}
              disabled={!connected || !inRoom}
            >
              Send
            </button>
          </div>
          <div className="gw-chatLog" style={{ height: 220 }}>
            {chat.map((c, idx) => (
              <div key={idx} style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 12, opacity: 0.75 }}>{new Date(c.ts).toLocaleTimeString()} </span>
                <strong>{c.from}:</strong> {c.text}
              </div>
            ))}
          </div>
        </div>

        <hr style={{ width: "100%" }} />

        <h3 style={{ margin: 0 }}>Controls</h3>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          Room mode: <strong>{room?.game?.difficulty ?? "?"}</strong>
        </div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Mode
          <select
            value={mode}
            onChange={(e) => {
              const m = e.target.value as GameMode;
              setMode(m);
              send({ type: "game.setMode", mode: m });
            }}
            disabled={!connected}
          >
            <option value="normal">normal</option>
            <option value="fst_ode">fst_ode</option>
            <option value="snd_ode">snd_ode</option>
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Angle (radians)
          <input
            type="range"
            min={-Math.PI / 2}
            max={Math.PI / 2}
            step={0.01}
            value={angle}
            onChange={(e) => {
              const a = Number(e.target.value);
              setAngle(a);
              send({ type: "game.setAngle", angle: a });
            }}
            disabled={!connected}
          />
          <div style={{ fontSize: 12, opacity: 0.8 }}>{angle.toFixed(2)}</div>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          Function
          <input value={functionString} onChange={(e) => setFunctionString(e.target.value)} disabled={!connected} />
        </label>

        {room?.game?.difficulty === "practice" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Hints (practice mode)</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  if (!room?.game || !clientId) return;
                  const g = room.game;
                  const me = g.players.find((p) => p.clientId === clientId);
                  const mySoldier = me?.soldiers?.[me?.currentTurnSoldier ?? 0];
                  if (!me || !mySoldier) return;

                  setChat((prev) =>
                    prev.concat({ from: "hint", text: "Requesting AI hint...", ts: Date.now() }),
                  );
                  if (debugGemini) {
                    // eslint-disable-next-line no-console
                    console.log("[LLM] hint.request sent");
                  }

                  let target: { x: number; y: number } | null = null;
                  let best = Number.POSITIVE_INFINITY;
                  for (const p of g.players) {
                    if (p.team === me.team) continue;
                    for (const s of p.soldiers) {
                      if (!s.alive) continue;
                      const d = distSq({ x: mySoldier.x, y: mySoldier.y }, { x: s.x, y: s.y });
                      if (d < best) {
                        best = d;
                        target = { x: s.x, y: s.y };
                      }
                    }
                  }
                  if (!target) return;

                  const inverted = me.team === 2;
                  const dxLocalPixels = inverted ? mySoldier.x - target.x : target.x - mySoldier.x;
                  const dyLocalGameSign = -(target.y - mySoldier.y);

                  const slope = dxLocalPixels !== 0 ? dyLocalGameSign / dxLocalPixels : 0;
                  const m = Math.round(clamp(slope, -6, 6) * 10) / 10;

                  setFunctionString(`${m}*x`);
                  setChat((prev) =>
                    prev.concat({
                      from: "hint",
                      text: `Manual hint (degree 1): use ${m}*x as a starting slope.`,
                      ts: Date.now(),
                    }),
                  );
                }}
                disabled={!connected || (inGame && !isMyTurn)}
              >
                Degree 1
              </button>

              <button
                onClick={() => {
                  if (!room?.game || !clientId) return;
                  const g = room.game;
                  const me = g.players.find((p) => p.clientId === clientId);
                  const mySoldier = me?.soldiers?.[me?.currentTurnSoldier ?? 0];
                  if (!me || !mySoldier) return;

                  let target: { x: number; y: number } | null = null;
                  let best = Number.POSITIVE_INFINITY;
                  for (const p of g.players) {
                    if (p.team === me.team) continue;
                    for (const s of p.soldiers) {
                      if (!s.alive) continue;
                      const d = distSq({ x: mySoldier.x, y: mySoldier.y }, { x: s.x, y: s.y });
                      if (d < best) {
                        best = d;
                        target = { x: s.x, y: s.y };
                      }
                    }
                  }
                  if (!target) return;

                  const inverted = me.team === 2;
                  const dxLocalPixels = inverted ? mySoldier.x - target.x : target.x - mySoldier.x;
                  const dyLocalGameSign = -(target.y - mySoldier.y);

                  const slope = dxLocalPixels !== 0 ? dyLocalGameSign / dxLocalPixels : 0;
                  const m = Math.round(clamp(slope, -6, 6) * 10) / 10;
                  const a = dyLocalGameSign >= 0 ? 0.02 : -0.02;

                  setFunctionString(`${a}*x^2 + ${m}*x`);
                  setChat((prev) =>
                    prev.concat({
                      from: "hint",
                      text: `Manual hint (degree 2): try ${a}*x^2 + ${m}*x (adds curvature).`,
                      ts: Date.now(),
                    }),
                  );
                }}
                disabled={!connected || (inGame && !isMyTurn)}
              >
                Degree 2
              </button>

              <button
                onClick={() => {
                  if (!room?.game || !clientId) return;
                  const g = room.game;
                  const me = g.players.find((p) => p.clientId === clientId);
                  const mySoldier = me?.soldiers?.[me?.currentTurnSoldier ?? 0];
                  if (!me || !mySoldier) return;

                  let target: { x: number; y: number } | null = null;
                  let best = Number.POSITIVE_INFINITY;
                  for (const p of g.players) {
                    if (p.team === me.team) continue;
                    for (const s of p.soldiers) {
                      if (!s.alive) continue;
                      const d = distSq({ x: mySoldier.x, y: mySoldier.y }, { x: s.x, y: s.y });
                      if (d < best) {
                        best = d;
                        target = { x: s.x, y: s.y };
                      }
                    }
                  }
                  if (!target) return;

                  const inverted = me.team === 2;
                  const dxLocalPixels = inverted ? mySoldier.x - target.x : target.x - mySoldier.x;
                  const dyLocalGameSign = -(target.y - mySoldier.y);

                  const slope = dxLocalPixels !== 0 ? dyLocalGameSign / dxLocalPixels : 0;
                  const m = Math.round(clamp(slope, -6, 6) * 10) / 10;
                  const a2 = dyLocalGameSign >= 0 ? 0.01 : -0.01;
                  const a4 = dyLocalGameSign >= 0 ? 0.0002 : -0.0002;

                  setFunctionString(`${a4}*x^4 + ${a2}*x^2 + ${m}*x`);
                  setChat((prev) =>
                    prev.concat({
                      from: "hint",
                      text: `Manual hint (degree 4): try ${a4}*x^4 + ${a2}*x^2 + ${m}*x (stronger curvature).`,
                      ts: Date.now(),
                    }),
                  );
                }}
                disabled={!connected || (inGame && !isMyTurn)}
              >
                Degree 4
              </button>

              <button
                onClick={() => {
                  if (!room?.game || !clientId) return;
                  const g = room.game;
                  const me = g.players.find((p) => p.clientId === clientId);
                  const mySoldier = me?.soldiers?.[me?.currentTurnSoldier ?? 0];
                  if (!me || !mySoldier) return;

                  // Pick nearest enemy alive soldier as target.
                  let target: { x: number; y: number } | null = null;
                  let best = Number.POSITIVE_INFINITY;
                  for (const p of g.players) {
                    if (p.team === me.team) continue;
                    for (const s of p.soldiers) {
                      if (!s.alive) continue;
                      const d = distSq({ x: mySoldier.x, y: mySoldier.y }, { x: s.x, y: s.y });
                      if (d < best) {
                        best = d;
                        target = { x: s.x, y: s.y };
                      }
                    }
                  }
                  if (!target) return;

                  send({
                    type: "hint.request",
                    payload: { shooter: { x: mySoldier.x, y: mySoldier.y }, target, debug: debugGemini },
                  });
                }}
                disabled={!connected || (inGame && !isMyTurn)}
              >
                Ask bot (Gemini)
              </button>
            </div>

            {hintThinking ? (
              <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                AI thinking: {hintThinking.attempt}/{hintThinking.maxAttempts}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.75 }}>Hard mode: hints disabled.</div>
        )}

        <button onClick={() => send({ type: "game.fire", functionString })} disabled={!connected || (inGame && !isMyTurn)}>
          Fire
        </button>
      </div>
    </div>
  );

  return (
    <div className="gw-app" style={{ fontFamily: "system-ui" }}>
      <h1 style={{ marginTop: 0, marginBottom: 8 }}>Graphwar Web</h1>
      {topBar}
      <hr style={{ margin: "12px 0" }} />
      <div className="gw-content">{inPostGame ? postGameScreen : inGame ? gameScreen : lobbyScreen}</div>
    </div>
  );
}
