import "dotenv/config";
import { generateGeminiHint } from "../src/geminiHint";

// Usage:
//   GEMINI_API_KEY=... npm run gemini:debug
// or PowerShell:
//   $env:GEMINI_API_KEY="..."; npm run gemini:debug

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
    const hint = await generateGeminiHint(args, fetch, (ev) => {
      events.push(ev);
    });
    console.log("\nFINAL HINT:\n", hint);
  } catch (e) {
    console.error("\nGEMINI DEBUG FAILED:\n", e);
  } finally {
    for (const ev of events) {
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
