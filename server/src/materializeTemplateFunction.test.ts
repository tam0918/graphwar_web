import { describe, expect, it } from "vitest";

function materializeTemplateFunction(fnRaw: string, dxLocalGame: number, dyLocalGame: number) {
  let fn = String(fnRaw || "");
  const dx = dxLocalGame;
  const dy = dyLocalGame;
  const m = Number.isFinite(dx) && Math.abs(dx) > 1e-12 ? dy / dx : 0;

  fn = fn.replace(/\bdy\s*\/\s*dx\b/gi, `(${m.toFixed(8)})`);
  fn = fn.replace(/\bdy\b/gi, `(${dy.toFixed(8)})`);
  fn = fn.replace(/\bdx\b/gi, `(${dx.toFixed(8)})`);

  return fn.replace(/\s+/g, " ").trim();
}

describe("materializeTemplateFunction", () => {
  it("substitutes dx and dy/dx templates", () => {
    const dx = 10;
    const dy = 5;
    const fn = "(dy/dx)*x + 0.05*x*(x - dx) + 0.02*sin(0.5*x)";
    const out = materializeTemplateFunction(fn, dx, dy);
    expect(out).toContain("(0.50000000)");
    expect(out).toContain("(10.00000000)");
    expect(out).toContain("sin(0.5*x)");
  });

  it("does not break plain functions", () => {
    const fn = "0.1*x + 0.01*x*(x-2)";
    const out = materializeTemplateFunction(fn, 3, 4);
    expect(out).toBe(fn);
  });
});
