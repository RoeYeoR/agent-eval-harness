// Entrypoint: load scenarios, run + score each, print a report, and exit non-zero if the
// pass rate is below threshold (so it gates CI). Run with:  npm run eval
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { runScenario } from "./runner";
import { deterministicChecks, judgeConversation } from "./scorers";
import { PASS_THRESHOLD, RUNS_PER_SCENARIO } from "./config";
import type { Scenario, ScenarioScore } from "./types";

// Minimal .env loader so the script runs standalone (no dotenv dependency).
function loadEnv() {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env file — rely on the real environment */
  }
}

function loadScenarios(): Scenario[] {
  return readFileSync("scenarios.jsonl", "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Scenario);
}

async function scoreOnce(anthropic: Anthropic, scenario: Scenario): Promise<ScenarioScore> {
  const result = await runScenario(anthropic, scenario);
  const deterministic = deterministicChecks(result);
  const judge = await judgeConversation(anthropic, result);
  const pass = deterministic.every((c) => c.pass) && judge.pass;
  return { id: scenario.id, deterministic, judge, pass };
}

async function main() {
  loadEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY (put it in .env). Aborting.");
    process.exit(2);
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const only = process.env.EVAL_ONLY; // run just the scenarios whose id contains this
  const scenarios = loadScenarios().filter((s) => !only || s.id.includes(only));

  console.log(`\nRunning ${scenarios.length} scenario(s) x ${RUNS_PER_SCENARIO} run(s)\n`);
  const scores: ScenarioScore[] = [];
  for (const s of scenarios) {
    for (let i = 0; i < RUNS_PER_SCENARIO; i++) {
      const sc = await scoreOnce(anthropic, s);
      scores.push(sc);
      const failedChecks = sc.deterministic.filter((c) => !c.pass).map((c) => c.name);
      const line = sc.pass
        ? sc.judge.reason
        : [...failedChecks, sc.judge.pass ? "" : `judge: ${sc.judge.reason}`].filter(Boolean).join("; ");
      console.log(`  [${sc.pass ? "PASS" : "FAIL"}] ${s.id.padEnd(16)} ${line}`);
    }
  }

  const passed = scores.filter((s) => s.pass).length;
  const rate = passed / scores.length;
  console.log("\n── results ──");
  console.log(`Pass rate: ${passed}/${scores.length} (${Math.round(rate * 100)}%)   threshold: ${Math.round(PASS_THRESHOLD * 100)}%`);
  const ok = rate >= PASS_THRESHOLD;
  console.log(ok ? "OK" : "BELOW THRESHOLD");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
