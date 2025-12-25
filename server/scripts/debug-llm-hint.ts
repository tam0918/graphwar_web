import "dotenv/config";
import { generateLlmHint } from "../src/llmHint";

// Usage:
//   FPT_API_KEY=... npm run llm:debug
// or PowerShell:
//   $env:FPT_API_KEY="..."; npm run llm:debug
// Optional:
//   $env:FPT_BASE_URL="https://mkp-api.fptcloud.com";
//   $env:FPT_MODEL="GLM-4.5";

const args = {
  mode: "normal",
  shooterTeam: 1 as const,
  shooter: { x: 120, y: 280 },
  target: { x: 620, y: 220 },
  obstacles: { circles: [], holes: [] },
  dxLocalPixels: 500,
  dyLocalGameSign: 60,
};

async function main() {
  const events: any[] = [];
  try {
    const hint = await generateLlmHint(args, (ev) => events.push(ev));
    console.log("\nFINAL HINT:\n", hint);
  } catch (e) {
    console.error("\nLLM DEBUG FAILED:\n", e);
  } finally {
    for (const ev of events) {
      if (ev.type === "request") {
        console.log(`\n--- attempt ${ev.attempt} request ---\n`);
        console.log({ url: ev.url, method: ev.method, headers: ev.headers, body: ev.body });
      }
      if (ev.type === "response") {
        console.log(`\n--- attempt ${ev.attempt} http ${ev.status} rawBody ---\n`);
        console.log(ev.rawBody);
      }
      if (ev.type === "attempt") {
        console.log(`\n--- attempt ${ev.attempt} extracted text ---\n`);
        console.log(ev.text);
      }
      if (ev.type === "parsed") {
        console.log(`\n--- parsed attempt ${ev.attempt} ---\n`);
        console.log(ev.hint);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
