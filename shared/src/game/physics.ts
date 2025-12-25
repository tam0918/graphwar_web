import { GAME_CONSTANTS, type GameMode } from "../gameConstants";
import type { Point } from "../math/types";
import { parseToPolishTokens } from "../function/parse";
import { evaluatePolish } from "../function/evaluate";
import { collidePoint, type TerrainState } from "./terrain";

export type SoldierState = {
  x: number;
  y: number;
  angle: number;
  alive: boolean;
};

export type PlayerGameState = {
  clientId: string;
  name: string;
  team: 1 | 2;
  soldiers: SoldierState[];
  currentTurnSoldier: number;
};

export type ShotResult = {
  fireAngle: number;
  path: Point[];
  lastPoint: Point;
  explosion: { x: number; y: number; r: number };
  hits: Array<{ targetClientId: string; soldierIndex: number; killStep: number }>;
};

function toGameCoords(p: Point, inverted: boolean): Point {
  const { PLANE_LENGTH, PLANE_HEIGHT, PLANE_GAME_LENGTH } = GAME_CONSTANTS;
  let x = p.x;
  const y = p.y;
  if (inverted) x = PLANE_LENGTH - x;

  return {
    x: (PLANE_GAME_LENGTH * (x - PLANE_LENGTH / 2)) / PLANE_LENGTH,
    y: (PLANE_GAME_LENGTH * (-y + PLANE_HEIGHT / 2)) / PLANE_LENGTH,
  };
}

function toPixelCoords(p: Point, inverted: boolean): Point {
  const { PLANE_LENGTH, PLANE_HEIGHT, PLANE_GAME_LENGTH } = GAME_CONSTANTS;
  let x = (PLANE_LENGTH * p.x) / PLANE_GAME_LENGTH + PLANE_LENGTH / 2;
  const y = (-PLANE_LENGTH * p.y) / PLANE_GAME_LENGTH + PLANE_HEIGHT / 2;
  if (inverted) x = PLANE_LENGTH - x;
  return { x, y };
}

function getStartAngleNormal(evalAt: (x: number) => number, x: number, radius: number): number {
  const { STEP_SIZE, ANGLE_ERROR, MAX_ANGLE_LOOPS } = GAME_CONSTANTS;
  let tangent = (evalAt(x + STEP_SIZE) - evalAt(x)) / STEP_SIZE;
  let angle = Math.atan(tangent);

  let error = 10_000;
  for (let i = 0; error > ANGLE_ERROR && i < MAX_ANGLE_LOOPS; i++) {
    const finalX = x + radius * Math.cos(angle);
    tangent = (evalAt(finalX + STEP_SIZE) - evalAt(finalX)) / STEP_SIZE;
    const newAngle = Math.atan(tangent);
    error = Math.abs(newAngle - angle);
    angle = newAngle;
  }

  return angle;
}

function getRK4StartAngle(
  f: (x: number, y: number) => number,
  x: number,
  y: number,
  radius: number,
): number {
  const { STEP_SIZE, ANGLE_ERROR, MAX_ANGLE_LOOPS } = GAME_CONSTANTS;
  let angle = 0;
  let error = 10_000;

  for (let i = 0; error > ANGLE_ERROR && i < MAX_ANGLE_LOOPS; i++) {
    const finalX = x + radius * Math.cos(angle);
    const finalY = y + radius * Math.sin(angle);

    const h = STEP_SIZE;
    const k1 = f(finalX, finalY);
    const k2 = f(finalX + 0.5 * h, finalY + 0.5 * h * k1);
    const k3 = f(finalX + 0.5 * h, finalY + 0.5 * h * k2);
    const k4 = f(finalX + h, finalY + h * k3);

    const nextY = finalY + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    const nextX = finalX + h;

    const tangent = (nextY - finalY) / (nextX - finalX);
    const newAngle = Math.atan(tangent);

    error = Math.abs(newAngle - angle);
    angle = newAngle;
  }

  return angle;
}

function alreadyHit(hits: ShotResult["hits"], targetClientId: string, soldierIndex: number): boolean {
  return hits.some((h) => h.targetClientId === targetClientId && h.soldierIndex === soldierIndex);
}

export function simulateShot(args: {
  mode: GameMode;
  functionString: string;
  terrain: TerrainState;
  players: PlayerGameState[];
  currentTurnIndex: number;
  maxSteps?: number;
}): ShotResult {
  const { mode, functionString, terrain, players, currentTurnIndex } = args;
  const {
    FUNC_MAX_STEPS,
    FUNC_MAX_STEP_DISTANCE_SQUARED,
    FUNC_MIN_X_STEP_DISTANCE,
    STEP_SIZE,
    SOLDIER_RADIUS,
    PLANE_GAME_LENGTH,
    PLANE_LENGTH,
    EXPLOSION_RADIUS,
  } = GAME_CONSTANTS;

  const MAX_STEPS = Math.max(1, Math.min(args.maxSteps ?? FUNC_MAX_STEPS, FUNC_MAX_STEPS));

  const shooter = players[currentTurnIndex];
  if (!shooter) throw new Error("Invalid currentTurnIndex");

  const shooterSoldier = shooter.soldiers[shooter.currentTurnSoldier];
  if (!shooterSoldier || !shooterSoldier.alive) throw new Error("Shooter has no alive soldier");

  const inverted = shooter.team === 2;
  const polish = parseToPolishTokens(functionString);

  const path: Point[] = new Array(MAX_STEPS);
  const hits: ShotResult["hits"] = [];

  const startPx: Point = { x: shooterSoldier.x, y: shooterSoldier.y };
  const originGame = toGameCoords(startPx, inverted);
  let p0 = originGame;

  const gameRadius = (PLANE_GAME_LENGTH * SOLDIER_RADIUS) / PLANE_LENGTH;

  let fireAngle = 0;

  if (mode === "normal") {
    // Interpret the user's function in LOCAL coordinates (x=0 at the shooter).
    // This matches Graphwar intuition: x^2 always gives a parabola from the soldier,
    // independent of the soldier's absolute map position.
    const evalAtLocal = (xLocal: number) => evaluatePolish(polish, xLocal, 0, 0);

    fireAngle = getStartAngleNormal(evalAtLocal, 0, gameRadius);

    let prevLocal: Point = { x: 0, y: 0 };
    if (!Number.isNaN(fireAngle) && Number.isFinite(fireAngle)) {
      prevLocal = { x: gameRadius * Math.cos(fireAngle), y: gameRadius * Math.sin(fireAngle) };
    }

    const offSet = -evalAtLocal(prevLocal.x) + prevLocal.y;

    // Keep simulation in LOCAL game coordinates; convert to world pixels for collision/render.
    path[0] = toPixelCoords({ x: originGame.x + prevLocal.x, y: originGame.y + (evalAtLocal(prevLocal.x) + offSet) }, inverted);

    let numSteps: number = MAX_STEPS;

    for (let i = 1; i < MAX_STEPS; i++) {
      let h = STEP_SIZE;
      let x = prevLocal.x + h;
      let y = evalAtLocal(x) + offSet;

      // adaptive step size to keep distance bounded
      let endFunc = false;
      for (;;) {
        const dx = x - prevLocal.x;
        const dy = y - prevLocal.y;
        if (dx * dx + dy * dy <= FUNC_MAX_STEP_DISTANCE_SQUARED) break;
        if (x - prevLocal.x > FUNC_MIN_X_STEP_DISTANCE) {
          h = h / 2;
          x = prevLocal.x + h;
          y = evalAtLocal(x) + offSet;
        } else {
          endFunc = true;
          break;
        }
      }

      if (endFunc) {
        numSteps = i;
        path.length = numSteps;
        break;
      }

      prevLocal = { x, y };
      const pixel = toPixelCoords({ x: originGame.x + x, y: originGame.y + y }, inverted);
      path[i] = pixel;

      // collisions with soldiers
      for (let pj = 0; pj < players.length; pj++) {
        const pl = players[pj]!;
        for (let si = 0; si < pl.soldiers.length; si++) {
          if (pj === currentTurnIndex && si === shooter.currentTurnSoldier) continue;
          const s = pl.soldiers[si]!;
          if (!s.alive) continue;

          const dx = s.x - pixel.x;
          const dy = s.y - pixel.y;
          if (dx * dx + dy * dy < SOLDIER_RADIUS * SOLDIER_RADIUS) {
            if (!alreadyHit(hits, pl.clientId, si)) {
              hits.push({ targetClientId: pl.clientId, soldierIndex: si, killStep: i });
            }
          }
        }
      }

      if (collidePoint(terrain, pixel)) {
        numSteps = i;
        path.length = numSteps;
        break;
      }

      if (!Number.isFinite(pixel.y)) {
        numSteps = i;
        path.length = numSteps;
        break;
      }
    }

    const lastPoint = path[path.length - 1]!;
    return {
      fireAngle,
      path: path as Point[],
      lastPoint,
      explosion: { x: lastPoint.x, y: lastPoint.y, r: EXPLOSION_RADIUS },
      hits,
    };
  }

  if (mode === "fst_ode") {
    // dy/dx = f(x, y)
    const f = (xLocal: number, yLocal: number) => evaluatePolish(polish, xLocal, yLocal, 0);

    fireAngle = getRK4StartAngle(f, 0, 0, gameRadius);

    let prev: Point = {
      x: gameRadius * Math.cos(fireAngle),
      y: gameRadius * Math.sin(fireAngle),
    };
    path[0] = toPixelCoords({ x: originGame.x + prev.x, y: originGame.y + prev.y }, inverted);

    let numSteps: number = MAX_STEPS;

    for (let i = 1; i < MAX_STEPS; i++) {
      let h = STEP_SIZE;

      const stepOnce = (hStep: number): Point => {
        const k1 = f(prev.x, prev.y);
        const k2 = f(prev.x + 0.5 * hStep, prev.y + 0.5 * hStep * k1);
        const k3 = f(prev.x + 0.5 * hStep, prev.y + 0.5 * hStep * k2);
        const k4 = f(prev.x + hStep, prev.y + hStep * k3);
        return { x: prev.x + hStep, y: prev.y + (hStep / 6) * (k1 + 2 * k2 + 2 * k3 + k4) };
      };

      let next = stepOnce(h);

      let endFunc = false;
      for (;;) {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        if (dx * dx + dy * dy <= FUNC_MAX_STEP_DISTANCE_SQUARED) break;
        if (next.x - prev.x > FUNC_MIN_X_STEP_DISTANCE) {
          h = h / 2;
          next = stepOnce(h);
        } else {
          endFunc = true;
          break;
        }
      }

      if (endFunc) {
        numSteps = i;
        path.length = numSteps;
        break;
      }

      prev = next;
      const pixel = toPixelCoords({ x: originGame.x + prev.x, y: originGame.y + prev.y }, inverted);
      path[i] = pixel;

      for (let pj = 0; pj < players.length; pj++) {
        const pl = players[pj]!;
        for (let si = 0; si < pl.soldiers.length; si++) {
          if (pj === currentTurnIndex && si === shooter.currentTurnSoldier) continue;
          const s = pl.soldiers[si]!;
          if (!s.alive) continue;
          const dx = s.x - pixel.x;
          const dy = s.y - pixel.y;
          if (dx * dx + dy * dy < SOLDIER_RADIUS * SOLDIER_RADIUS) {
            if (!alreadyHit(hits, pl.clientId, si)) {
              hits.push({ targetClientId: pl.clientId, soldierIndex: si, killStep: i });
            }
          }
        }
      }

      if (collidePoint(terrain, pixel) || !Number.isFinite(pixel.y)) {
        numSteps = i;
        path.length = numSteps;
        break;
      }
    }

    const lastPoint = path[path.length - 1]!;
    return {
      fireAngle,
      path: path as Point[],
      lastPoint,
      explosion: { x: lastPoint.x, y: lastPoint.y, r: EXPLOSION_RADIUS },
      hits,
    };
  }

  // snd_ode: y'' = f(x, y, y') with initial angle from soldier
  {
    const f = (xLocal: number, yLocal: number, dyLocal: number) => evaluatePolish(polish, xLocal, yLocal, dyLocal);

    // Use shooter-relative coordinates for consistency with other modes.
    const angle = shooterSoldier.angle;
    fireAngle = angle;

    let g: Point = {
      x: gameRadius * Math.cos(angle),
      y: gameRadius * Math.sin(angle),
    };

    let dy = Math.tan(angle);

    path[0] = toPixelCoords({ x: originGame.x + g.x, y: originGame.y + g.y }, inverted);

    let numSteps: number = MAX_STEPS;

    for (let i = 1; i < MAX_STEPS; i++) {
      let h = STEP_SIZE;

      const stepOnce = (hStep: number): { g: Point; dy: number } => {
        // System:
        // y' = dy
        // dy' = f(x, y, dy)
        let x1 = g.x;
        let y1 = g.y;
        let y2 = dy;

        const k11 = y2;
        const k12 = f(x1, y1, y2);

        x1 = g.x + hStep / 2;
        y1 = g.y + (hStep / 2) * k11;
        y2 = dy + (hStep / 2) * k12;

        const k21 = y2;
        const k22 = f(x1, y1, y2);

        y1 = g.y + (hStep / 2) * k21;
        y2 = dy + (hStep / 2) * k22;

        const k31 = y2;
        const k32 = f(x1, y1, y2);

        x1 = g.x + hStep;
        y1 = g.y + hStep * k31;
        y2 = dy + hStep * k32;

        const k41 = y2;
        const k42 = f(x1, y1, y2);

        const nextG: Point = {
          x: g.x + hStep,
          y: g.y + (hStep / 6) * (k11 + 2 * k21 + 2 * k31 + k41),
        };
        const nextDY = dy + (hStep / 6) * (k12 + 2 * k22 + 2 * k32 + k42);

        return { g: nextG, dy: nextDY };
      };

      let next = stepOnce(h);
      let endFunc = false;

      for (;;) {
        const dx = next.g.x - g.x;
        const dyDist = next.g.y - g.y;
        if (dx * dx + dyDist * dyDist <= FUNC_MAX_STEP_DISTANCE_SQUARED) break;
        if (next.g.x - g.x > FUNC_MIN_X_STEP_DISTANCE) {
          h = h / 2;
          next = stepOnce(h);
        } else {
          endFunc = true;
          break;
        }
      }

      if (endFunc) {
        numSteps = i;
        path.length = numSteps;
        break;
      }

      g = next.g;
      dy = next.dy;

      const pixel = toPixelCoords({ x: originGame.x + g.x, y: originGame.y + g.y }, inverted);
      path[i] = pixel;

      for (let pj = 0; pj < players.length; pj++) {
        const pl = players[pj]!;
        for (let si = 0; si < pl.soldiers.length; si++) {
          if (pj === currentTurnIndex && si === shooter.currentTurnSoldier) continue;
          const s = pl.soldiers[si]!;
          if (!s.alive) continue;
          const dx = s.x - pixel.x;
          const dyP = s.y - pixel.y;
          if (dx * dx + dyP * dyP < SOLDIER_RADIUS * SOLDIER_RADIUS) {
            if (!alreadyHit(hits, pl.clientId, si)) {
              hits.push({ targetClientId: pl.clientId, soldierIndex: si, killStep: i });
            }
          }
        }
      }

      if (collidePoint(terrain, pixel) || !Number.isFinite(pixel.y)) {
        numSteps = i;
        path.length = numSteps;
        break;
      }
    }

    const lastPoint = path[path.length - 1]!;
    return {
      fireAngle,
      path: path as Point[],
      lastPoint,
      explosion: { x: lastPoint.x, y: lastPoint.y, r: EXPLOSION_RADIUS },
      hits,
    };
  }
}
