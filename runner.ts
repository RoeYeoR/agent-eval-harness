// Drives one scenario end-to-end: the agent (production brain) and the simulated caller
// take turns until the caller signals <END>, the agent honors an opt-out, or MAX_TURNS.
// Returns the full transcript + the mock's final state + tool log for the scorers.
import type Anthropic from "@anthropic-ai/sdk";
import { createAgent } from "./agent";
import { createToolRunnerAgent } from "./agent-toolrunner";
import { createCaller } from "./caller";
import { createMockTools } from "./tools";
import { AGENT_IMPL, BASE_SYSTEM_PROMPT, MAX_TURNS, ensureAiDisclosure } from "./config";
import { composeSystemPrompt, loadSkill } from "./skills";
import type { RunResult, Scenario, Turn } from "./types";

export async function runScenario(anthropic: Anthropic, scenario: Scenario): Promise<RunResult> {
  const { tools, state } = createMockTools(scenario);

  // #6: load the vertical's skill on demand and compose it onto the generic base prompt.
  const systemPrompt = composeSystemPrompt(BASE_SYSTEM_PROMPT, loadSkill(scenario.skill));

  // #1: run the same agent via the hand-written loop or the Tool Runner framework.
  const agent =
    AGENT_IMPL === "toolrunner"
      ? createToolRunnerAgent(anthropic, systemPrompt, tools)
      : createAgent(anthropic, systemPrompt, tools);

  const caller = createCaller(anthropic, scenario);
  const transcript: Turn[] = [];

  // Outbound call: the agent speaks first. Mirror production's code-enforced backstop
  // (src/lib/claude.ts ensureAiDisclosure) on the greeting — a prompt instruction alone isn't
  // a reliable guarantee, so the product (and now the harness) enforces disclosure in code.
  let a = await agent.respond("[המתקשר ענה לטלפון. פתחי את השיחה בברכה קצרה.]");
  a = { ...a, text: ensureAiDisclosure(a.text) };
  transcript.push({ role: "agent", text: a.text, tools: a.tools });

  for (let t = 0; t < MAX_TURNS; t++) {
    const raw = await caller.next(a.text);
    const callerText = raw.replace(/<END>/g, "").trim();
    transcript.push({ role: "caller", text: callerText });

    // Always let the agent respond to what the caller just said — even when the caller is
    // hanging up — so a last-moment opt-out still gets handled (mark_do_not_call fires).
    a = await agent.respond(callerText);
    transcript.push({ role: "agent", text: a.text, tools: a.tools });

    if (/<END>/.test(raw) || state.doNotCall) break;
  }

  return {
    scenario,
    transcript,
    state,
    callerTurns: transcript.filter((x) => x.role === "caller").length,
  };
}
