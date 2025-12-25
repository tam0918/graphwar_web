export type GeminiHintArgs = {
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
};

export type GeminiHintDebugEvent =
  | { type: "attempt"; attempt: 1 | 2; prompt: string; text: string }
  | { type: "response"; attempt: 1 | 2; status: number; rawBody: string }
  | { type: "parsed"; attempt: 1 | 2; hint: { functionString: string; explanation?: string } };

function summarizeGeminiResponse(data: any): string {
  const finishReason = data?.candidates?.[0]?.finishReason;
  const safety = data?.promptFeedback?.safetyRatings;
  const candidateSafety = data?.candidates?.[0]?.safetyRatings;
  const reason = typeof finishReason === "string" ? finishReason : "unknown";
  const safetyStr = (x: any) => {
    if (!Array.isArray(x)) return "[]";
    return JSON.stringify(
      x.map((r) => ({ category: r?.category, probability: r?.probability, blocked: r?.blocked })),
    );
  };
  return `finishReason=${reason} promptSafety=${safetyStr(safety)} candidateSafety=${safetyStr(candidateSafety)}`;
}

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

export function getGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  const extracted: string[] = [];
  for (const p of parts) {
    if (typeof p?.text === "string" && p.text.trim()) {
      extracted.push(p.text);
      continue;
    }

    const inline = p?.inlineData;
    const b64 = inline?.data;
    if (typeof b64 === "string" && b64.length > 0) {
      try {
        const decoded = Buffer.from(b64, "base64").toString("utf-8").trim();
        if (decoded) extracted.push(decoded);
      } catch {
        // ignore
      }
    }
  }

  return extracted.join("\n").trim();
}

export function parseGeminiJson(text: string): { functionString: string; explanation?: string } {
  const direct = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  })();

  const parsed = direct && typeof direct === "object" ? direct : extractFirstJsonObject(text);
  if (!parsed || typeof parsed !== "object") {
    // Common failure mode: the model starts outputting JSON but gets cut off (e.g. MAX_TOKENS)
    // Example: { "functionString": "0.12 * x", "explanation":
    const extractJsonStringField = (field: string): string | undefined => {
      const re = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
      const m = text.match(re);
      if (!m) return undefined;
      try {
        // Unescape JSON string content safely
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return m[1];
      }
    };

    const fnLoose = extractJsonStringField("functionString");
    const expLoose = extractJsonStringField("explanation");
    if (typeof fnLoose === "string" && fnLoose.trim()) {
      return {
        functionString: fnLoose.trim().slice(0, 2000),
        explanation:
          typeof expLoose === "string" && expLoose.trim()
            ? expLoose.trim().slice(0, 2000)
            : "Gemini response was truncated; using extracted functionString.",
      };
    }

    throw new Error("Gemini returned an invalid response");
  }

  const fn = (parsed as any).functionString;
  const explanation = (parsed as any).explanation;
  if (typeof fn !== "string" || !fn.trim()) throw new Error("Gemini did not return functionString");

  return {
    functionString: fn.trim().slice(0, 2000),
    explanation: typeof explanation === "string" ? explanation.trim().slice(0, 2000) : undefined,
  };
}

export async function generateGeminiHint(
  args: GeminiHintArgs,
  fetchImpl: typeof fetch = fetch,
  onDebugEvent?: (ev: GeminiHintDebugEvent) => void,
): Promise<{ functionString: string; explanation?: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not configured on the server");

  const systemInstruction =
    "You are an expert prompt-following assistant. " +
    "You must output VALID JSON only, with keys functionString and explanation. " +
    "No markdown, no code fences, no commentary.";

  const basePrompt =
    `Task: Suggest ONE functionString the user can type to shoot.\n` +
    `Return ONLY JSON.\n` +
    `IMPORTANT: The FIRST character of your reply must be '{'.\n` +
    `\n` +
    `Context (PIXELS):\n` +
    `mode=${args.mode}\n` +
    `shooterTeam=${args.shooterTeam} (team 2 mirrored; local x is forward)\n` +
    `shooterPos={"x":${args.shooter.x.toFixed(1)},"y":${args.shooter.y.toFixed(1)}}\n` +
    `targetPos={"x":${args.target.x.toFixed(1)},"y":${args.target.y.toFixed(1)}}\n` +
    `obstacles=${JSON.stringify({
      circles: args.obstacles.circles.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), r: Math.round(c.r) })),
      holes: args.obstacles.holes.map((h) => ({ x: Math.round(h.x), y: Math.round(h.y), r: Math.round(h.r) })),
    })}\n` +
    `dx_local_pixels=${args.dxLocalPixels.toFixed(1)}\n` +
    `dy_local_game=${args.dyLocalGameSign.toFixed(1)} (positive up)\n` +
    `\n` +
    `Allowed tokens: numbers, x, y, dy, + - * / ^, parentheses.\n` +
    `Obstacles: circles are solid terrain; holes are removed terrain. Avoid colliding with circles.\n` +
    `If unsure: return {"functionString":"x","explanation":"Simple baseline."}.\n` +
    `\n` +
    `Output schema EXACTLY:\n` +
    `{"functionString":"...","explanation":"..."}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(
    key,
  )}`;

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  const parseRetryDelayMs = (resp: any, bodyText: string): number | null => {
    const ra = resp?.headers?.get?.("retry-after");
    if (typeof ra === "string" && ra.trim()) {
      const n = Number(ra.trim());
      if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
    }

    try {
      const body = JSON.parse(bodyText);
      const details = body?.error?.details;
      if (Array.isArray(details)) {
        for (const d of details) {
          const delay = d?.retryDelay;
          if (typeof delay === "string") {
            const m = delay.trim().match(/^([0-9]+(?:\.[0-9]+)?)s$/i);
            if (m) return Math.round(Number(m[1]) * 1000);
          }
        }
      }
    } catch {
      // ignore
    }

    return null;
  };

  const summarizeNonOkForThrow = (status: number, bodyText: string, retryDelayMs: number | null): string => {
    const retrySuffix =
      typeof retryDelayMs === "number" && Number.isFinite(retryDelayMs) && retryDelayMs >= 0
        ? ` Please retry in ${Math.max(0, Math.ceil(retryDelayMs / 1000))}s.`
        : "";

    let msg = "";
    try {
      const data = JSON.parse(bodyText);
      const m = data?.error?.message;
      if (typeof m === "string") msg = m.replace(/\s+/g, " ").trim();
    } catch {
      // ignore
    }

    const msgSuffix = msg ? `: ${msg.slice(0, 220)}` : "";
    return `Gemini request failed (${status})${msgSuffix}.${retrySuffix}`;
  };

  const callGemini = async (attempt: 1 | 2, prompt: string) => {
    const requestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          // gemini-3-flash-preview can spend a large budget on "thoughts"; keep enough room for the actual JSON.
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
    } as const;

    // One bounded retry for transient quota/overload responses.
    let resp: any;
    let fullBody = "";
    const sanitizeForDebug = (bodyText: string): string => {
      try {
        const data = JSON.parse(bodyText);
        const parts = data?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            const sig = p?.thoughtSignature;
            if (typeof sig === "string" && sig.length > 200) {
              p.thoughtSignature = `<omitted thoughtSignature ${sig.length} chars>`;
            }
          }
        }
        return JSON.stringify(data, null, 2);
      } catch {
        return bodyText;
      }
    };

    const MAX_TRANSIENT_RETRY_DELAY_MS = 60_000;
    for (let netTry = 1; netTry <= 2; netTry++) {
      resp = await fetchImpl(url, requestInit as any);
      fullBody = await resp.text().catch(() => "");
      onDebugEvent?.({ type: "response", attempt, status: resp.status, rawBody: sanitizeForDebug(fullBody) });

      if (resp.ok) break;

      const transient = resp.status === 429 || resp.status === 503;
      if (transient && netTry === 1) {
        const delayMs = parseRetryDelayMs(resp, fullBody);
        // Don't sleep unbounded; keep it a single bounded retry.
        if (delayMs !== null && delayMs >= 0 && delayMs <= MAX_TRANSIENT_RETRY_DELAY_MS) {
          await sleep(delayMs);
          continue;
        }
      }

      const delayMs = parseRetryDelayMs(resp, fullBody);
      throw new Error(summarizeNonOkForThrow(resp.status, fullBody, delayMs));
    }

    let data: any;
    try {
      data = JSON.parse(fullBody);
    } catch {
      throw new Error(`Gemini returned non-JSON HTTP body (${resp.status}): ${fullBody.slice(0, 300)}`);
    }
    const text = getGeminiText(data);
    onDebugEvent?.({ type: "attempt", attempt, prompt, text });
    if (!text) {
      throw new Error(`Gemini returned empty content (${summarizeGeminiResponse(data)})`);
    }
    return { text };
  };

  const first = await callGemini(1, basePrompt);
  try {
    const hint = parseGeminiJson(first.text);
    onDebugEvent?.({ type: "parsed", attempt: 1, hint });
    return hint;
  } catch {
    const repairPrompt =
      basePrompt +
      `\n\nYour previous output was INVALID. Fix it. ` +
      `Return ONLY valid JSON, no extra text. ` +
      `Previous output:\n` +
      first.text.slice(0, 800);
    const second = await callGemini(2, repairPrompt);
    const hint = parseGeminiJson(second.text);
    onDebugEvent?.({ type: "parsed", attempt: 2, hint });
    return hint;
  }
}
