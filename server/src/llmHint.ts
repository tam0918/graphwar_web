import OpenAI from "openai";
import { GAME_CONSTANTS } from "@graphwar/shared";

export type LlmHintArgs = {
  mode: string;
  shooterTeam: 1 | 2;
  shooter: { x: number; y: number };
  target: { x: number; y: number };
  obstacles: {
    circles: Array<{ x: number; y: number; r: number }>;
    holes: Array<{ x: number; y: number; r: number }>;
  };
  dxLocalPixels: number;
  dyLocalGameSign: number;
  validationFeedback?: string;
};

export type LlmHintDebugEvent =
  | { type: "request"; attempt: number; url: string; method: string; headers: Record<string, string>; body: string }
  | { type: "response"; attempt: number; status: number; rawBody: string }
  | { type: "attempt"; attempt: number; prompt: string; text: string }
  | { type: "parsed"; attempt: number; hint: { functionString: string; explanation?: string } }
  | { type: "error"; message: string };

function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

function extractJsonStringField(text: string, field: string): string | undefined {
  const re = new RegExp(`\"${field}\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"`, "i");
  const m = text.match(re);
  if (!m) return undefined;
  try {
    return JSON.parse(`\"${m[1]}\"`);
  } catch {
    return m[1];
  }
}

export function parseLlmJson(text: string): { functionString: string; explanation?: string } {
  const direct = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();

  const parsed = direct && typeof direct === "object" ? direct : extractFirstJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    const fnLoose = extractJsonStringField(text, "functionString");
    const expLoose = extractJsonStringField(text, "explanation");
    if (typeof fnLoose === "string" && fnLoose.trim()) {
      return {
        functionString: fnLoose.trim().slice(0, 2000),
        explanation:
          typeof expLoose === "string" && expLoose.trim()
            ? expLoose.trim().slice(0, 2000)
            : "LLM response was truncated; using extracted functionString.",
      };
    }
    throw new Error("LLM returned an invalid response");
  }

  const fn = (parsed as any).functionString;
  const explanation = (parsed as any).explanation;
  if (typeof fn !== "string" || !fn.trim()) throw new Error("LLM did not return functionString");

  return {
    functionString: fn.trim().slice(0, 2000),
    explanation: typeof explanation === "string" ? explanation.trim().slice(0, 2000) : undefined,
  };
}

function safeOneLine(s: string, maxLen = 8000) {
  return String(s).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function toGameCoordsFromPixels(p: { x: number; y: number }, inverted: boolean): { x: number; y: number } {
  const { PLANE_LENGTH, PLANE_HEIGHT, PLANE_GAME_LENGTH } = GAME_CONSTANTS;
  let x = p.x;
  const y = p.y;
  if (inverted) x = PLANE_LENGTH - x;
  return {
    x: (PLANE_GAME_LENGTH * (x - PLANE_LENGTH / 2)) / PLANE_LENGTH,
    y: (PLANE_GAME_LENGTH * (-y + PLANE_HEIGHT / 2)) / PLANE_LENGTH,
  };
}

function pixelRadiusToGameRadius(rPx: number): number {
  const { PLANE_LENGTH, PLANE_GAME_LENGTH } = GAME_CONSTANTS;
  return (PLANE_GAME_LENGTH * rPx) / PLANE_LENGTH;
}

function distPointToSegmentSq(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq <= 1e-12) {
    return apx * apx + apy * apy;
  }
  let t = (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseRetryAfterSeconds(err: any): number | null {
  const h = err?.headers ?? err?.response?.headers;
  const ra = typeof h?.get === "function" ? h.get("retry-after") : h?.["retry-after"];
  if (typeof ra === "string" && ra.trim()) {
    const n = Number(ra.trim());
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export async function generateLlmHint(
  args: LlmHintArgs,
  onDebugEvent?: (ev: LlmHintDebugEvent) => void,
): Promise<{ functionString: string; explanation?: string }> {
  const apiKey = process.env.FPT_API_KEY;
  if (!apiKey) throw new Error("FPT_API_KEY is not configured on the server");

  const baseURLRaw = process.env.FPT_BASE_URL || "https://mkp-api.fptcloud.com/v1";
  const baseURL = (() => {
    const trimmed = baseURLRaw.replace(/\/+$/g, "");
    return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
  })();
  const model = process.env.FPT_MODEL || "GLM-4.5";
  const timeoutMs = (() => {
    const raw = process.env.FPT_TIMEOUT_MS;
    if (!raw) return 60_000;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 60_000;
  })();

  const makeClient = (attempt: 1 | 2) => {
    const debugFetch: typeof fetch = async (url, init) => {
      const method = (init?.method || "GET").toString();

      // Best-effort stringify headers (mask auth).
      const headers: Record<string, string> = {};
      const h: any = init?.headers;
      if (h && typeof h.forEach === "function") {
        h.forEach((v: any, k: any) => {
          headers[String(k).toLowerCase()] = String(v);
        });
      } else if (h && typeof h === "object") {
        for (const [k, v] of Object.entries(h)) headers[String(k).toLowerCase()] = String(v);
      }
      if (headers["authorization"]) headers["authorization"] = "Bearer <redacted>";

      const body = typeof init?.body === "string" ? init.body : "";
      onDebugEvent?.({
        type: "request",
        attempt,
        url: String(url),
        method,
        headers,
        body: safeOneLine(body, 12000),
      });

      const resp = await fetch(url as any, init as any);
      const text = await resp.text().catch(() => "");
      onDebugEvent?.({ type: "response", attempt, status: resp.status, rawBody: safeOneLine(text, 12000) });

      // Re-create response because we consumed the body.
      return new Response(text, { status: resp.status, headers: resp.headers });
    };

    return new OpenAI({ apiKey, baseURL, fetch: debugFetch });
  };

  const systemInstruction =
    "You are an expert prompt-following assistant. " +
    "You must output VALID JSON only, with keys functionString and explanation. " +
    "No markdown, no code fences, no commentary. " +
    "The functionString MUST be usable in Graphwar and should avoid terrain circles.";

  const inverted = args.shooterTeam === 2;
  const shooterGame = toGameCoordsFromPixels(args.shooter, inverted);
  const targetGame = toGameCoordsFromPixels(args.target, inverted);
  const targetLocalGame = { x: targetGame.x - shooterGame.x, y: targetGame.y - shooterGame.y };

  const circlesAllLocal = args.obstacles.circles.map((c) => {
    const cg = toGameCoordsFromPixels({ x: c.x, y: c.y }, inverted);
    const local = { x: cg.x - shooterGame.x, y: cg.y - shooterGame.y };
    const r = pixelRadiusToGameRadius(c.r);
    return { x: Number(local.x.toFixed(4)), y: Number(local.y.toFixed(4)), r: Number(r.toFixed(4)) };
  });

  // Provide a small ranked list of the most blocking circles to focus the model.
  const circlesCritical = circlesAllLocal
    .map((c) => {
      const d = Math.sqrt(distPointToSegmentSq({ x: 0, y: 0 }, targetLocalGame, c));
      const clearance = d - c.r;
      return { ...c, dLine: Number(d.toFixed(4)), clearance: Number(clearance.toFixed(4)) };
    })
    .sort((a, b) => a.clearance - b.clearance)
    .slice(0, 20);

  const holesAllLocal = args.obstacles.holes.map((h) => {
    const hg = toGameCoordsFromPixels({ x: h.x, y: h.y }, inverted);
    const local = { x: hg.x - shooterGame.x, y: hg.y - shooterGame.y };
    const r = pixelRadiusToGameRadius(h.r);
    return { x: Number(local.x.toFixed(4)), y: Number(local.y.toFixed(4)), r: Number(r.toFixed(4)) };
  });

  const basePrompt =
    `Task: Suggest ONE functionString the player can type to shoot AND avoid terrain circles.\n` +
    `Return ONLY JSON.\n` +
    `IMPORTANT: The FIRST character of your reply must be '{'.\n` +
    `\n` +
    `CRITICAL: In Graphwar normal mode, your function is evaluated in LOCAL GAME COORDINATES with the shooter at (0,0).\n` +
    `So you must reason in local-game units (not pixels).\n` +
    `TargetLocalGame=(dx,dy) shown below; a good function roughly satisfies y(0)=0 and y(dx)=dy.\n` +
    `You MAY use placeholders 'dx', 'dy', and 'dy/dx' in your functionString; the server will substitute numeric values.\n` +
    `\n` +
    `LocalGame:\n` +
    `dx=${targetLocalGame.x.toFixed(4)}\n` +
    `dy=${targetLocalGame.y.toFixed(4)} (positive up)\n` +
    `\n` +
    `ObstaclesLocalGame: solid circles MUST be avoided.\n` +
    `Full obstacle list (x,y,r in LOCAL GAME units):\n` +
    `${JSON.stringify({ circles: circlesAllLocal, holes: holesAllLocal })}\n` +
    `\n` +
    `Most blocking circles (sorted by smallest clearance to the straight line):\n` +
    `${JSON.stringify({ circlesCritical })}\n` +
    (args.validationFeedback
      ? `\nSimulation feedback from the game engine about your previous suggestion:\n${safeOneLine(args.validationFeedback, 2000)}\n`
      : ``) +
    `\n` +
    `Guidance: You may use ANY valid expression (not only parabolas).\n` +
    `If any circle has clearance < 0.15 (straight line would hit/clip), prefer a curved function.\n` +
    `Common safe template (example only): y = m*x + a*x*(x-dx), where m=dy/dx (preserves endpoints).\n` +
    `But you can also use other smooth curves (e.g. add sin-bumps, higher-degree polynomials, etc.) as long as it stays valid and avoids circles.\n` +
    `You are allowed to use exp/ln/log/sqrt/trig if it helps (keep values finite over x in [0,dx]).\n` +
    `Avoid piecewise/conditionals (not supported). Prefer smooth, stable expressions.\n` +
    `\n` +
    `How to reason (do this explicitly):\n` +
    `1) Ensure y(0)=0 and y(dx)=dy (endpoints).\n` +
    `2) For each critical circle (xc,yc,r): ensure |y(xc)-yc| >= r + 0.08 (safety margin).\n` +
    `3) Also sanity-check 10-20 sample x values between 0..dx against nearby circles.\n` +
    `Note: The engine checks collision along the drawn path, so do not rely on "threading" between circles with tiny gaps.\n` +
    `\n` +
    `Tokens supported: numbers, x, y, y', + - * / ^, parentheses, sin cos tan abs sqrt log ln exp, pi, e.\n` +
    `If unsure: return {"functionString":"x","explanation":"Simple baseline."}.\n` +
    `\n` +
    `Output schema EXACTLY:\n` +
    `{"functionString":"...","explanation":"..."}`;

  const callOnce = async (attempt: 1 | 2, prompt: string) => {
    const payload: any = {
      model,
      messages: [{ role: "user", content: prompt }],
      system_prompt: systemInstruction,
      // FPT API supports these fields per provided snippet
      streaming: false,
      temperature: 0,
      top_p: 0.1,
      top_k: 40,
      presence_penalty: 0,
      frequency_penalty: 0,
      // Keep this large to avoid truncation; provider still enforces its own cap.
      max_tokens: 4096,
    };

    const client = makeClient(attempt);

    // One bounded retry for transient 429.
    for (let netTry = 1; netTry <= 2; netTry++) {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);
        let resp: any;
        try {
          resp = await (client.chat.completions.create(payload, { signal: controller.signal }) as any);
        } finally {
          clearTimeout(t);
        }
        const text =
          (resp?.choices?.[0]?.message?.content && String(resp.choices[0].message.content)) ||
          (resp?.choices?.[0]?.delta?.content && String(resp.choices[0].delta.content)) ||
          "";

        onDebugEvent?.({ type: "attempt", attempt, prompt, text });
        if (!text.trim()) throw new Error("LLM returned empty content");
        return { text };
      } catch (e: any) {
        const msg = safeOneLine(e?.message || String(e), 1200);
        const looksAborted = e?.name === "AbortError" || /\babort(ed)?\b/i.test(msg);
        if (looksAborted) throw new Error(`LLM request timeout after ${timeoutMs}ms`);
        const status = typeof e?.status === "number" ? e.status : typeof e?.response?.status === "number" ? e.response.status : 0;
        const bodyText = safeOneLine(JSON.stringify(e?.error ?? e?.response?.data ?? {}), 4000);
        onDebugEvent?.({ type: "response", attempt, status: status || 500, rawBody: `${msg} ${bodyText}`.trim() });

        if (status === 429 && netTry === 1) {
          const ra = parseRetryAfterSeconds(e);
          if (ra !== null && ra >= 0 && ra <= 60) {
            await sleep(Math.ceil(ra * 1000));
            continue;
          }
        }

        throw new Error(status ? `LLM request failed (${status}): ${msg}` : `LLM request failed: ${msg}`);
      }
    }

    throw new Error("LLM request failed");
  };

  const first = await callOnce(1, basePrompt);
  try {
    const hint = parseLlmJson(first.text);
    onDebugEvent?.({ type: "parsed", attempt: 1, hint });
    return hint;
  } catch {
    const repairPrompt =
      basePrompt +
      `\n\nYour previous output was INVALID. Fix it. ` +
      `Return ONLY valid JSON, no extra text. ` +
      `Previous output:\n` +
      first.text.slice(0, 1200);
    const second = await callOnce(2, repairPrompt);
    const hint = parseLlmJson(second.text);
    onDebugEvent?.({ type: "parsed", attempt: 2, hint });
    return hint;
  }
}
