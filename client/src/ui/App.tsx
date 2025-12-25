import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  encodeMessage,
  GAME_CONSTANTS,
  type GameMode,
  simulateShot,
  type ShotResult,
  type RoomState,
  type RoomSummary,
  type ServerToClientMessage,
} from "@graphwar/shared";
import { GameCanvas } from "./GameCanvas";

const DEFAULT_WS_URL = "ws://localhost:8080/ws";

type ChatLine = { from: string; text: string; ts: number };

export function App() {
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [name, setName] = useState("Player");
  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [chat, setChat] = useState<ChatLine[]>([]);

  const [newRoomName, setNewRoomName] = useState("My Room");
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

  const turnSecondsLeft = useMemo(() => {
    if (!inGame || !room?.game) return null;
    const elapsed = nowMs - room.game.timeTurnStarted;
    const left = Math.ceil((GAME_CONSTANTS.TURN_TIME_MS - elapsed) / 1000);
    return Math.max(0, left);
  }, [inGame, room, nowMs]);

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
          <button onClick={() => send({ type: "room.create", name: newRoomName })} disabled={!connected}>
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
                  players: {r.numPlayers} • state: {r.gameState}
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
                state: {room.gameState} • players: {room.players.length}
              </div>
            </div>

            <>

                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {room.players.map((p) => (
                    <li key={p.clientId}>
                      {p.name} {p.ready ? "(ready)" : ""}
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
