// #1 — the SAME agent, driven by a DEDICATED FRAMEWORK instead of the hand-written loop in
// agent.ts: Anthropic's Tool Runner (anthropic.beta.messages.toolRunner). Each tool is
// registered with its handler via betaZodTool (which also validates the model's args against
// the Zod schema), and the runner drives the tool_use -> tool_result loop for us.
//
// A ToolRunner is single-pass (it runs one input to completion), so for a multi-turn call we
// keep the conversation ourselves and spin a fresh runner each turn seeded with the full
// history — the framework still owns the within-turn tool loop. Same {respond} interface as
// agent.ts (selectable with EVAL_AGENT_IMPL=toolrunner), so runner.ts can run either.
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { AGENT_MODEL } from "./config";
import type { MockTools } from "./tools";
import type { ToolInvocation } from "./types";

export function createToolRunnerAgent(anthropic: Anthropic, systemPrompt: string, mockTools: MockTools) {
  const tools = [
    betaZodTool({
      name: "check_availability",
      description: "Look up real open slots so you can offer 2-3 concrete options. Call before offering any time.",
      inputSchema: z.object({}),
      run: async () => mockTools.check_availability({}),
    }),
    betaZodTool({
      name: "book_meeting",
      description:
        "Reserve a meeting. Only after the contact picked an exact slot from check_availability — reuse that ISO timestamp.",
      inputSchema: z.object({
        leadName: z.string(),
        startTime: z.string(),
        notes: z.string().optional(),
      }),
      run: async (args) => mockTools.book_meeting(args as Record<string, unknown>),
    }),
    betaZodTool({
      name: "mark_do_not_call",
      description: "Call the moment the contact opts out, then acknowledge once and end the call.",
      inputSchema: z.object({}),
      run: async () => mockTools.mark_do_not_call({}),
    }),
  ];

  // We own the cross-turn history; the runner owns the within-turn tool loop.
  let history: Anthropic.Beta.BetaMessageParam[] = [];

  async function respond(callerText: string): Promise<{ text: string; tools: ToolInvocation[] }> {
    history.push({ role: "user", content: callerText });

    const runner = anthropic.beta.messages.toolRunner({
      model: AGENT_MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages: history,
      tools,
    });
    const final = await runner.runUntilDone();

    // Adopt the runner's full conversation (assistant turns + tool_use/tool_result) so the
    // next turn has complete context.
    history = [...(runner.params.messages as Anthropic.Beta.BetaMessageParam[])];

    const text = final.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    // Tool calls were recorded in the mock's state.log by the run() handlers (what the scorers
    // read), so nothing to collect per-turn here.
    return { text, tools: [] };
  }

  return { respond };
}
