import React, { useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONSTANTS, type RoomState, type ShotResult } from "@graphwar/shared";

const COLORS = {
  backgroundTop: "#1a1a2e",
  backgroundBottom: "#16213e",
  vignette: "rgba(0,0,0,0.25)",

  text: "#e5e7eb",

  terrainFill: "#8b7355",
  terrainStroke: "#a08060",
  terrainGradient1: "#6b5344",
  terrainGradient2: "#9a8365",

  teamBlue: "#4ecdc4",
  teamBlueGlow: "rgba(78, 205, 196, 0.35)",
  teamRed: "#ff6b6b",
  teamRedGlow: "rgba(255, 107, 107, 0.35)",

  selectionRing: "#ffffff",
  selectionRingAlt: "#ffcc00",

  trajectory: "rgba(251, 191, 36, 0.85)",
  trajectoryGlow: "rgba(251, 191, 36, 0.25)",
  explosion: "#ff9f43",
} as const;

function hashToUnit(n: string): number {
  let h = 2166136261;
  for (let i = 0; i < n.length; i++) {
    h ^= n.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function dprClamped(): number {
  return Math.max(1, Math.min(3, window.devicePixelRatio || 1));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

export function GameCanvas({
  room,
  previewShot,
  showCoordinates,
}: {
  room: RoomState | null;
  previewShot?: ShotResult | null;
  showCoordinates?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [animT, setAnimT] = useState(0);
  const [cssSize, setCssSize] = useState<{ w: number; h: number }>(() => ({ w: 0, h: 0 }));

  const assetsRef = useRef<{
    soldier?: HTMLImageElement;
    currentPlayer: HTMLImageElement[];
    explosion: HTMLImageElement[];
    soldierExplosionSmall: HTMLImageElement[];
  }>({ currentPlayer: [], explosion: [], soldierExplosionSmall: [] });
  const [assetsReady, setAssetsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [soldier, ...rest] = await Promise.all([
          loadImage("/rsc/soldiers/soldierNormal.png"),
          loadImage("/rsc/soldiers/currentPlayer0.png"),
          loadImage("/rsc/soldiers/currentPlayer1.png"),
          loadImage("/rsc/soldiers/currentPlayer2.png"),
          loadImage("/rsc/explosions/explosion0.png"),
          loadImage("/rsc/explosions/explosion1.png"),
          loadImage("/rsc/explosions/explosion2.png"),
          loadImage("/rsc/explosions/explosion3.png"),
          loadImage("/rsc/explosions/explosion4.png"),
          loadImage("/rsc/explosions/explosion5.png"),
          loadImage("/rsc/soldiers/soldierExplosion1Small.png"),
          loadImage("/rsc/soldiers/soldierExplosion2Small.png"),
          loadImage("/rsc/soldiers/soldierExplosion3Small.png"),
          loadImage("/rsc/soldiers/soldierExplosion4Small.png"),
          loadImage("/rsc/soldiers/soldierExplosion5Small.png"),
        ]);

        if (cancelled) return;

        const currentPlayer = rest.slice(0, 3);
        const explosion = rest.slice(3, 9);
        const soldierExplosionSmall = rest.slice(9);

        assetsRef.current = {
          soldier,
          currentPlayer,
          explosion,
          soldierExplosionSmall,
        };
        setAssetsReady(true);
      } catch {
        // If sprites fail to load (offline, wrong path, etc.), fallback to primitive shapes.
        if (!cancelled) setAssetsReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const players = room?.players ?? [];
  const points = useMemo(() => {
    return players.map((p) => {
      const x = hashToUnit(p.clientId) * 0.8 + 0.1;
      const y = hashToUnit(p.clientId + "y") * 0.6 + 0.2;
      return { ...p, x, y };
    });
  }, [players]);

  useEffect(() => {
    let raf = 0;
    let start = performance.now();
    const tick = (t: number) => {
      setAnimT(t - start);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [room?.game?.lastShot?.startedAtMs, room?.game?.lastShot?.functionString]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ro = new ResizeObserver(() => {
      const w = Math.floor(canvas.clientWidth);
      const h = Math.floor(canvas.clientHeight);
      setCssSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });

    ro.observe(canvas);
    setCssSize({ w: Math.floor(canvas.clientWidth), h: Math.floor(canvas.clientHeight) });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (cssSize.w <= 0 || cssSize.h <= 0) return;

    const dpr = dprClamped();
    const w = Math.max(1, Math.floor(cssSize.w * dpr));
    const h = Math.max(1, Math.floor(cssSize.h * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
  }, [cssSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (cssSize.w <= 0 || cssSize.h <= 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    void animT;

    const dpr = dprClamped();
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const bg = ctx.createLinearGradient(0, 0, 0, cssH);
    bg.addColorStop(0, COLORS.backgroundTop);
    bg.addColorStop(1, COLORS.backgroundBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const vignette = ctx.createRadialGradient(
      cssW / 2,
      cssH / 2,
      Math.min(cssW, cssH) * 0.2,
      cssW / 2,
      cssH / 2,
      Math.max(cssW, cssH) * 0.75,
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, COLORS.vignette);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.fillStyle = COLORS.text;
    ctx.font = "14px system-ui";
    const label = room ? `Room: ${room.name} (${room.gameState})` : "No room";
    ctx.fillText(label, 10, 18);

    const planeW = GAME_CONSTANTS.PLANE_LENGTH;
    const planeH = GAME_CONSTANTS.PLANE_HEIGHT;
    const scale = Math.min(cssW / planeW, cssH / planeH);
    const offX = (cssW - planeW * scale) / 2;
    const offY = (cssH - planeH * scale) / 2;

    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);

    if (!room?.game) {
      for (const p of points) {
        const px = 40 + p.x * (planeW - 80);
        const py = 20 + (1 - p.y) * (planeH - 80);
        ctx.beginPath();
        ctx.fillStyle = p.ready ? COLORS.teamBlue : COLORS.teamRed;
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLORS.text;
        ctx.font = "12px system-ui";
        ctx.fillText(p.name, px + 12, py + 4);
      }
      ctx.restore();
      return;
    }

    const g = room.game;
    const lastShot = g.lastShot;
    const nowMs = Date.now();

    for (const c of g.terrain.circles) {
      const grad = ctx.createRadialGradient(c.x - c.r * 0.3, c.y - c.r * 0.3, 0, c.x, c.y, c.r);
      grad.addColorStop(0, COLORS.terrainGradient2);
      grad.addColorStop(0.7, COLORS.terrainFill);
      grad.addColorStop(1, COLORS.terrainGradient1);
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = COLORS.terrainStroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const holesToDraw = g.terrain.holes.slice();
    if (lastShot && g.phase === "animating_shot" && lastShot.path.length > 0 && lastShot.functionVelocity > 0) {
      const drawDurationMs = Math.floor((lastShot.path.length * 1000) / lastShot.functionVelocity);
      const explodeAt = lastShot.startedAtMs + drawDurationMs;
      if (nowMs >= explodeAt) holesToDraw.push(lastShot.explosion);
    }

    ctx.globalCompositeOperation = "destination-out";
    for (const hole of holesToDraw) {
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    const turnId = g.currentTurnClientId;
    const shotNow = lastShot ? nowMs : 0;
    const markerFrames = assetsRef.current.currentPlayer;
    const markerIdx = markerFrames.length ? Math.floor((nowMs / 180) % markerFrames.length) : 0;
    const markerImg = markerFrames[markerIdx];

    const soldierSprite = assetsRef.current.soldier;
    const soldierSize = Math.max(20, GAME_CONSTANTS.SOLDIER_RADIUS * 3.2);
    for (const p of g.players) {
      for (let i = 0; i < p.soldiers.length; i++) {
        const s = p.soldiers[i]!;
        let alive = s.alive;
        if (alive && lastShot && g.phase === "animating_shot") {
          const hit = lastShot.hits.find((h) => h.targetClientId === p.clientId && h.soldierIndex === i);
          if (hit) {
            const killAt = lastShot.startedAtMs + Math.floor((hit.killStep * 1000) / lastShot.functionVelocity);
            if (shotNow >= killAt) alive = false;
          }
        }
        if (!alive) continue;

        const teamColor = p.team === 1 ? COLORS.teamBlue : COLORS.teamRed;
        const glowColor = p.team === 1 ? COLORS.teamBlueGlow : COLORS.teamRedGlow;

        if (p.clientId === turnId && i === p.currentTurnSoldier) {
          const rg = ctx.createRadialGradient(s.x, s.y, 3, s.x, s.y, 26);
          rg.addColorStop(0, glowColor);
          rg.addColorStop(1, "transparent");
          ctx.beginPath();
          ctx.arc(s.x, s.y, 26, 0, Math.PI * 2);
          ctx.fillStyle = rg;
          ctx.fill();
        }

        if (assetsReady && soldierSprite) {
          ctx.drawImage(soldierSprite, s.x - soldierSize / 2, s.y - soldierSize / 2, soldierSize, soldierSize);
        } else {
          ctx.beginPath();
          ctx.fillStyle = teamColor;
          ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
          ctx.fill();
        }

        // subtle outline ring for visibility
        ctx.strokeStyle = COLORS.selectionRing;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 8.5, 0, Math.PI * 2);
        ctx.stroke();

        if (p.clientId === turnId && i === p.currentTurnSoldier) {
          ctx.strokeStyle = COLORS.selectionRingAlt;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 11, 0, Math.PI * 2);
          ctx.stroke();

          // current player marker (sprite)
          if (assetsReady && markerImg) {
            const mw = Math.max(18, Math.min(32, markerImg.naturalWidth || 24));
            const mh = Math.max(18, Math.min(32, markerImg.naturalHeight || 24));
            ctx.drawImage(markerImg, s.x - mw / 2, s.y - soldierSize / 2 - mh - 4, mw, mh);
          }
        }

        ctx.fillStyle = COLORS.text;
        ctx.font = "12px system-ui";
        ctx.fillText(p.name, s.x + 10, s.y + 4);

        if (showCoordinates) {
          ctx.fillStyle = "rgba(229,231,235,0.85)";
          ctx.font = "11px system-ui";
          ctx.fillText(`(${Math.round(s.x)}, ${Math.round(s.y)})`, s.x + 10, s.y + 18);
        }
      }
    }

    if (previewShot?.path?.length && g.phase !== "animating_shot") {
      ctx.save();

      ctx.strokeStyle = COLORS.trajectoryGlow;
      ctx.lineWidth = 6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      const p0 = previewShot.path[0]!;
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < previewShot.path.length; i++) {
        const p = previewShot.path[i]!;
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      ctx.strokeStyle = COLORS.trajectory;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < previewShot.path.length; i++) {
        const p = previewShot.path[i]!;
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      ctx.restore();
    }

    if (lastShot?.path?.length) {
      const speed = lastShot.functionVelocity;
      const elapsedMs = nowMs - lastShot.startedAtMs;
      const stepsToDraw = Math.min(lastShot.path.length, Math.floor((elapsedMs * speed) / 1000));
      const drawDurationMs = Math.floor((lastShot.path.length * 1000) / speed);

      if (elapsedMs < drawDurationMs) {
        ctx.strokeStyle = COLORS.trajectoryGlow;
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        const p0 = lastShot.path[0]!;
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < stepsToDraw; i++) {
          const p = lastShot.path[i]!;
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();

        ctx.strokeStyle = COLORS.trajectory;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < stepsToDraw; i++) {
          const p = lastShot.path[i]!;
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }

      // projectile dot (makes the shot feel alive)
      if (elapsedMs < drawDurationMs && stepsToDraw > 0) {
        const p = lastShot.path[Math.max(0, stepsToDraw - 1)]!;
        ctx.save();
        ctx.fillStyle = COLORS.trajectory;
        ctx.shadowColor = COLORS.trajectoryGlow;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // soldier hit mini-explosions
      if (g.phase === "animating_shot" && assetsReady && lastShot.functionVelocity > 0) {
        const frames = assetsRef.current.soldierExplosionSmall;
        const frameDuration = 60;
        for (const hit of lastShot.hits) {
          const target = g.players.find((pl) => pl.clientId === hit.targetClientId);
          const s = target?.soldiers[hit.soldierIndex];
          if (!s) continue;
          const killAt = lastShot.startedAtMs + Math.floor((hit.killStep * 1000) / lastShot.functionVelocity);
          const t = nowMs - killAt;
          if (t < 0 || t > frames.length * frameDuration) continue;
          const idx = Math.min(frames.length - 1, Math.floor(t / frameDuration));
          const img = frames[idx];
          if (!img) continue;
          const size = Math.max(16, GAME_CONSTANTS.SOLDIER_RADIUS * 4);
          ctx.drawImage(img, s.x - size / 2, s.y - size / 2, size, size);
        }
      }

      // big explosion animation at impact
      if (assetsReady && lastShot.functionVelocity > 0) {
        const explodeAt = lastShot.startedAtMs + drawDurationMs;
        const t = nowMs - explodeAt;
        const frames = assetsRef.current.explosion;
        const frameDuration = 70;
        if (t >= 0 && frames.length && t <= frames.length * frameDuration) {
          const idx = Math.min(frames.length - 1, Math.floor(t / frameDuration));
          const img = frames[idx];
          if (img) {
            const size = Math.max(lastShot.explosion.r * 4, GAME_CONSTANTS.EXPLOSION_RADIUS * 4);
            ctx.drawImage(img, lastShot.explosion.x - size / 2, lastShot.explosion.y - size / 2, size, size);
          }
        }
      } else if (stepsToDraw >= lastShot.path.length) {
        // fallback outline
        ctx.strokeStyle = COLORS.explosion;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(lastShot.explosion.x, lastShot.explosion.y, lastShot.explosion.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [room, points, animT, previewShot, cssSize]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
