import { describe, expect, it, vi } from "vitest";
import { generateGeminiHint, getGeminiText, parseGeminiJson } from "./geminiHint";

describe("Gemini hint parsing", () => {
  it("parses strict JSON", () => {
    expect(parseGeminiJson('{"functionString":"x^2","explanation":"Try a simple curve."}')).toEqual({
      functionString: "x^2",
      explanation: "Try a simple curve.",
    });
  });

  it("parses JSON embedded in extra text (common Gemini fail mode)", () => {
    const text =
      "Sure! Here you go:\n```json\n{\"functionString\":\"0.5*x\",\"explanation\":\"Linear shot\"}\n```\n";
    expect(parseGeminiJson(text).functionString).toBe("0.5*x");
  });

  it("throws on non-JSON plain text (common Gemini fail mode)", () => {
    expect(() => parseGeminiJson("Try x^2 and adjust")).toThrow(/invalid response/i);
  });

  it("throws on JSON missing functionString", () => {
    expect(() => parseGeminiJson('{"fn":"x"}')).toThrow(/functionString/i);
  });

  it("extracts functionString from truncated JSON (MAX_TOKENS failure mode)", () => {
    const text = '{\n  "functionString": "0.12 * x",\n  "explanation":';
    const hint = parseGeminiJson(text);
    expect(hint.functionString).toBe("0.12 * x");
    expect(hint.explanation?.toLowerCase()).toContain("truncated");
  });

  it("extracts text from inlineData base64", () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "application/json",
                  data: Buffer.from('{"functionString":"x","explanation":"ok"}', "utf-8").toString("base64"),
                },
              },
            ],
          },
        },
      ],
    };
    expect(getGeminiText(payload)).toContain("functionString");
    expect(parseGeminiJson(getGeminiText(payload)).functionString).toBe("x");
  });
});

describe("Gemini retry/repair", () => {
  it("repairs invalid first response by retrying", async () => {
    process.env.GEMINI_API_KEY = "test";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () =>
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Try x^2" }] } }],
          }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: '{"functionString":"x^2","explanation":"Simple curve"}' }],
                },
              },
            ],
          }),
      });

    const hint = await generateGeminiHint(
      {
        mode: "normal",
        shooterTeam: 1,
        shooter: { x: 10, y: 10 },
        target: { x: 110, y: 30 },
        obstacles: { circles: [], holes: [] },
        dxLocalPixels: 100,
        dyLocalGameSign: -20,
      },
      fetchMock as any,
      undefined,
    );

    expect(hint.functionString).toBe("x^2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on 429 using retryDelay", async () => {
    process.env.GEMINI_API_KEY = "test";
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        status: 429,
        ok: false,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            error: {
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.RetryInfo",
                  retryDelay: "40s",
                },
              ],
            },
          }),
      })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: '{"functionString":"x","explanation":"ok"}' }],
                },
              },
            ],
          }),
      });

    const p = generateGeminiHint(
      {
        mode: "normal",
        shooterTeam: 1,
        shooter: { x: 10, y: 10 },
        target: { x: 110, y: 30 },
        obstacles: { circles: [], holes: [] },
        dxLocalPixels: 100,
        dyLocalGameSign: -20,
      },
      fetchMock as any,
      undefined,
    );

    // Flush the retry delay timer.
    await vi.advanceTimersByTimeAsync(40_000);
    const hint = await p;
    expect(hint.functionString).toBe("x");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
