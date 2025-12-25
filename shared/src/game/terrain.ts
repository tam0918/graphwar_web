import { GAME_CONSTANTS } from "../gameConstants";
import type { Point } from "../math/types";

export type TerrainCircle = { x: number; y: number; r: number };
export type ExplosionHole = { x: number; y: number; r: number };

export type TerrainState = {
  circles: TerrainCircle[];
  holes: ExplosionHole[];
};

export function collidePoint(terrain: TerrainState, p: Point): boolean {
  const { PLANE_LENGTH, PLANE_HEIGHT } = GAME_CONSTANTS;

  if (p.x < 0 || p.x >= PLANE_LENGTH) return true;
  if (p.y < 0 || p.y >= PLANE_HEIGHT) return true;

  // Java terrain is a bitmap where obstacles are filled circles.
  // We approximate it as geometric circles minus explosion holes.
  for (const c of terrain.circles) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    if (dx * dx + dy * dy <= c.r * c.r) {
      // inside obstacle circle; check if carved by any hole
      for (const h of terrain.holes) {
        const hx = p.x - h.x;
        const hy = p.y - h.y;
        if (hx * hx + hy * hy <= h.r * h.r) {
          return false;
        }
      }
      return true;
    }
  }

  return false;
}
