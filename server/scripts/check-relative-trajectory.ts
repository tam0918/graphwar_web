import { simulateShot, type PlayerGameState, type TerrainState } from "@graphwar/shared";

const terrain: TerrainState = { circles: [], holes: [] };

function mkPlayers(px: number, py: number): PlayerGameState[] {
  return [
    {
      clientId: "a",
      name: "A",
      team: 1,
      soldiers: [{ x: px, y: py, angle: 0, alive: true }],
      currentTurnSoldier: 0,
    },
    {
      clientId: "b",
      name: "B",
      team: 2,
      soldiers: [{ x: 700, y: 20, angle: 0, alive: true }],
      currentTurnSoldier: 0,
    },
  ];
}

function compare(func: string) {
  const base1 = { x: 120, y: 220 };
  const base2 = { x: 360, y: 220 };

  const shot1 = simulateShot({
    mode: "normal",
    functionString: func,
    terrain,
    players: mkPlayers(base1.x, base1.y),
    currentTurnIndex: 0,
  });

  const shot2 = simulateShot({
    mode: "normal",
    functionString: func,
    terrain,
    players: mkPlayers(base2.x, base2.y),
    currentTurnIndex: 0,
  });

  const n = Math.min(200, shot1.path.length, shot2.path.length);

  let maxDx = 0;
  let maxDy = 0;
  let nonFinite = 0;

  for (let i = 0; i < n; i++) {
    const p1 = shot1.path[i]!;
    const p2 = shot2.path[i]!;

    const d1x = p1.x - base1.x;
    const d1y = p1.y - base1.y;
    const d2x = p2.x - base2.x;
    const d2y = p2.y - base2.y;

    if (![d1x, d1y, d2x, d2y].every(Number.isFinite)) {
      nonFinite++;
      continue;
    }

    maxDx = Math.max(maxDx, Math.abs(d1x - d2x));
    maxDy = Math.max(maxDy, Math.abs(d1y - d2y));
  }

  // If relative-coordinate interpretation is correct, maxDx/maxDy should be ~0
  // (allowing only tiny float differences).
  console.log(
    func.padEnd(12),
    "steps",
    n,
    "maxDx",
    maxDx.toFixed(6),
    "maxDy",
    maxDy.toFixed(6),
    "nonFinite",
    nonFinite,
  );
}

[
  "x",
  "x^2",
  "exp(x)",
  "e^x",
  "sin(x)",
  "cos(x)",
  "abs(x)",
  "sqrt(x)",
  "log(x)",
].forEach(compare);
