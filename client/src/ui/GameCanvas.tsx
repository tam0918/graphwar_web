import React, { useEffect, useMemo, useRef, useState } from "react";
import { GAME_CONSTANTS, type RoomState, type ShotResult } from "@graphwar/shared";

const COLORS = {
  // Museum Display (dark)
  backgroundTop: "#0f1312",
  backgroundBottom: "#090c0c",
  vignette: "rgba(0,0,0,0.45)",

  text: "rgba(242, 239, 229, 0.95)",

  terrainFill: "#c5a05b", // muted gold
  terrainStroke: "rgba(242, 239, 229, 0.55)",
  terrainGradient1: "#b6904f",
  terrainGradient2: "#d6b67a",

  teamBlue: "#2bc3b4", // phosphor teal
  teamBlueGlow: "rgba(43, 195, 180, 0.22)",
  teamRed: "#c5a05b", // muted gold
  teamRedGlow: "rgba(197, 160, 91, 0.20)",

  selectionRing: "rgba(242, 239, 229, 0.90)",
  selectionRingAlt: "#c5a05b",

  trajectory: "rgba(185, 74, 58, 0.92)",
  trajectoryGlow: "rgba(185, 74, 58, 0.26)",
  explosion: "#b94a3a",
} as const;

function drawOutlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { font: string; fill: string; outline: string; outlineWidth: number },
) {
  ctx.save();
  ctx.font = opts.font;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = opts.outlineWidth;
  ctx.strokeStyle = opts.outline;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = opts.fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

const TEXT_OUTLINE_DARK = "rgba(0,0,0,0.75)";

function hash2i(x: number, y: number): number {
  // Deterministic 32-bit hash (fast, stable for procedural textures)
  let h = x | 0;
  h = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b);
  h ^= (y | 0) + 0x7f4a7c15 + (h << 6) + (h >> 2);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function rand01(seed: number): number {
  // xorshift32 -> [0, 1)
  let x = seed >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  // IMPORTANT: do not bitwise-AND with 0xffffffff here.
  // In JS, bitwise ops produce signed 32-bit ints, which can become negative.
  // Using >>> 0 keeps it unsigned.
  return (x >>> 0) / 0x100000000;
}

function drawStarfield(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Space backdrop (subtle, readable)
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#07090d");
  g.addColorStop(0.55, "#05070a");
  g.addColorStop(1, "#030407");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Very light nebula haze (kept restrained)
  const haze1 = ctx.createRadialGradient(w * 0.18, h * 0.22, 0, w * 0.18, h * 0.22, Math.max(w, h) * 0.65);
  haze1.addColorStop(0, "rgba(43, 195, 180, 0.05)");
  haze1.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = haze1;
  ctx.fillRect(0, 0, w, h);

  const haze2 = ctx.createRadialGradient(w * 0.82, h * 0.18, 0, w * 0.82, h * 0.18, Math.max(w, h) * 0.65);
  haze2.addColorStop(0, "rgba(197, 160, 91, 0.04)");
  haze2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = haze2;
  ctx.fillRect(0, 0, w, h);

  // Deterministic stars (stable across frames)
  const count = Math.round((w * h) / 18000);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < count; i++) {
    const s = hash2i(i * 97 + 13, i * 193 + 37);
    const x = rand01(s) * w;
    const y = rand01(s ^ 0x7a3c2d1b) * h;
    const r = 0.6 + rand01(s ^ 0x1b873593) * 1.4;
    const a = 0.10 + rand01(s ^ 0x85ebca6b) * 0.26;
    ctx.fillStyle = `rgba(230, 242, 255, ${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMoonTexture(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // Speckles + crater rings clipped to the circle. Deterministic per circle.
  const baseSeed = hash2i(Math.round(cx * 10), Math.round(cy * 10)) ^ hash2i(Math.round(r * 10), 0x1234);

  // Performance guard: most terrains have many small circles.
  // Only apply the expensive texture to medium/large rocks.
  if (r < 22) return;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Subtle directional shading (top-left lit)
  const shade = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r * 1.05);
  shade.addColorStop(0, "rgba(255,255,255,0.12)");
  shade.addColorStop(1, "rgba(0,0,0,0.20)");
  ctx.fillStyle = shade;
  ctx.fillRect(cx - r - 2, cy - r - 2, r * 2 + 4, r * 2 + 4);

  // Speckles
  // Keep counts low to avoid frame drops on maps with many circles.
  const speckCount = Math.min(42, Math.max(18, Math.round(r * 0.55)));
  for (let i = 0; i < speckCount; i++) {
    const s = baseSeed ^ hash2i(i * 131, i * 313);
    const t = rand01(s);
    const u = rand01(s ^ 0x9e3779b9);
    const ang = t * Math.PI * 2;
    const rad = Math.sqrt(u) * (r * 0.98);
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    const dotR = 0.5 + rand01(s ^ 0x7f4a7c15) * 1.6;
    const isDark = rand01(s ^ 0xc2b2ae35) < 0.72;
    const alpha = isDark ? 0.08 + rand01(s ^ 0x85ebca6b) * 0.14 : 0.05 + rand01(s ^ 0x1b873593) * 0.10;
    ctx.fillStyle = isDark
      ? `rgba(10, 12, 14, ${alpha.toFixed(3)})`
      : `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Craters (rings)
  const craterCount = Math.min(5, Math.max(2, Math.round(r / 26)));
  for (let i = 0; i < craterCount; i++) {
    const s = baseSeed ^ hash2i(i * 503, i * 877);
    const ang = rand01(s) * Math.PI * 2;
    const rad = Math.sqrt(rand01(s ^ 0x7a3c2d1b)) * (r * 0.7);
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    const cr = (0.10 + rand01(s ^ 0x1b873593) * 0.22) * r;
    const ring = Math.max(1.0, cr * 0.22);
    const rimA = 0.10 + rand01(s ^ 0x85ebca6b) * 0.16;
    const pitA = 0.10 + rand01(s ^ 0xc2b2ae35) * 0.16;

    // Rim highlight
    ctx.strokeStyle = `rgba(255,255,255, ${rimA.toFixed(3)})`;
    ctx.lineWidth = ring;
    ctx.beginPath();
    ctx.arc(x - cr * 0.10, y - cr * 0.10, cr, 0, Math.PI * 2);
    ctx.stroke();

    // Inner shadow
    ctx.strokeStyle = `rgba(0,0,0, ${pitA.toFixed(3)})`;
    ctx.lineWidth = ring * 0.9;
    ctx.beginPath();
    ctx.arc(x + cr * 0.08, y + cr * 0.08, cr * 0.78, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function hashTerrainCircles(circles: Array<{ x: number; y: number; r: number }>): number {
  // Stable-ish hash for terrain geometry. Rounded to reduce churn.
  let h = 2166136261;
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i]!;
    const x = (c.x * 10) | 0;
    const y = (c.y * 10) | 0;
    const r = (c.r * 10) | 0;
    h ^= x;
    h = Math.imul(h, 16777619);
    h ^= y;
    h = Math.imul(h, 16777619);
    h ^= r;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

  const terrainCacheRef = useRef<{
    key: number;
    w: number;
    h: number;
    canvas: HTMLCanvasElement;
  } | null>(null);

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
    // Redraw strategy:
    // - Full-speed RAF only while animating a shot.
    // - Throttled redraw otherwise (prevents heavy terrain rendering from pegging the main thread).
    if (!room?.game) return;

    const g = room.game;
    const lastShot = g.lastShot;
    const shouldAnimateShot =
      g.phase === "animating_shot" &&
      !!lastShot &&
      lastShot.path.length > 0 &&
      lastShot.functionVelocity > 0;

    if (shouldAnimateShot) {
      let raf = 0;
      let start = performance.now();
      const tick = (t: number) => {
        setAnimT(t - start);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }

    const id = window.setInterval(() => setAnimT(performance.now()), 220);
    return () => window.clearInterval(id);
  }, [room?.game?.phase, room?.game?.lastShot?.startedAtMs, room?.game?.lastShot?.functionString]);

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

    drawStarfield(ctx, cssW, cssH);

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

    const label = room ? `Room: ${room.name} (${room.gameState})` : "No room";
    drawOutlinedText(ctx, label, 10, 18, {
      font: "14px ui-serif, Georgia, serif",
      fill: COLORS.text,
      outline: TEXT_OUTLINE_DARK,
      outlineWidth: 3,
    });

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
        drawOutlinedText(ctx, p.name, px + 12, py + 4, {
          font: "12px ui-serif, Georgia, serif",
          fill: COLORS.text,
          outline: TEXT_OUTLINE_DARK,
          outlineWidth: 3,
        });
      }
      ctx.restore();
      return;
    }

    const g = room.game;
    const lastShot = g.lastShot;
    const nowMs = Date.now();

    // Terrain is expensive to draw; cache circles into an offscreen canvas.
    {
      const circles = g.terrain.circles;
      const terrainKey = hashTerrainCircles(circles);
      const cache = terrainCacheRef.current;
      const targetW = Math.max(1, Math.round(planeW));
      const targetH = Math.max(1, Math.round(planeH));

      if (!cache || cache.key !== terrainKey || cache.w !== targetW || cache.h !== targetH) {
        const off = document.createElement("canvas");
        off.width = targetW;
        off.height = targetH;
        const tctx = off.getContext("2d");

        if (tctx) {
          tctx.clearRect(0, 0, targetW, targetH);
          for (const c of circles) {
            // Lunar stone base (keep it "moon" rather than metallic gold)
            const grad = tctx.createRadialGradient(c.x - c.r * 0.3, c.y - c.r * 0.3, 0, c.x, c.y, c.r);
            grad.addColorStop(0, "#d9d1bf");
            grad.addColorStop(0.7, "#b9ac96");
            grad.addColorStop(1, "#95866d");
            tctx.beginPath();
            tctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
            tctx.fillStyle = grad;
            tctx.fill();

            drawMoonTexture(tctx, c.x, c.y, c.r);

            tctx.strokeStyle = COLORS.terrainStroke;
            tctx.lineWidth = 2;
            tctx.stroke();
          }
        }

        terrainCacheRef.current = { key: terrainKey, w: targetW, h: targetH, canvas: off };
      }

      const finalCache = terrainCacheRef.current;
      if (finalCache) {
        ctx.drawImage(finalCache.canvas, 0, 0);
      }
    }

    const holesToDraw = g.terrain.holes.slice();
    if (lastShot && g.phase === "animating_shot" && lastShot.path.length > 0 && lastShot.functionVelocity > 0) {
      const drawDurationMs = Math.floor((lastShot.path.length * 1000) / lastShot.functionVelocity);
      const explodeAt = lastShot.startedAtMs + drawDurationMs;
      if (nowMs >= explodeAt) holesToDraw.push(lastShot.explosion);
    }

    // Render explosion craters as solid black, instead of making the canvas transparent.
    // Using `destination-out` here would also punch through the background layers, which
    // can make the "hole" look washed-out depending on the page behind the canvas.
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    for (const hole of holesToDraw) {
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

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
