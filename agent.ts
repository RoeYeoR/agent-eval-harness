// The agent-under-test: the SAME brain as production (system prompt + tool schemas from
// config.ts, which mirror src/lib/vapi.ts) driven locally through the Anthropic SDK.
// One `respond(callerText)` runs the model, executes any tool calls against the mock, feeds
// the results back, and loops until the model returns a spoken reply — exactly the agentic
// loop Vapi runs in production, minus the voice layer.
import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_MODEL, AGENT_TOOLS } from "./config";
import type { MockTools } from "./tools";
import type { ToolInvocation } from "./types";

const MAX_TOOL_HOPS = 6; // safety cap on tool calls within a single turn

export function createAgent(anthropic: Anthropic, systemPrompt: string, mockTools: MockTools) {
  const messages: Anthropic.MessageParam[] = [];

  async function respond(callerText: string): Promise<{ text: string; tools: ToolInvocation[] }> {
    messages.push({ role: "user", content: callerText });
    const used: ToolInvocation[] = [];

    for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
      const res = await anthropic.messages.create({
        model: AGENT_MODEL,
        max_tokens: 500,
        system: systemPrompt,
        tools: AGENT_TOOLS,
        messages,
      });
      messages.push({ role: "assistant", content: res.content });

      const toolUses = res.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
      if (toolUses.length === 0) {
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join(" ")
          .trim();
        return { text, tools: used };
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const args = (tu.input ?? {}) as Record<string, unknown>;
        const result = mockTools[tu.name] ? await mockTools[tu.name](args) : `Unknown tool: ${tu.name}`;
        used.push({ name: tu.name, args, result });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
      }
      messages.push({ role: "user", content: toolResults });
    }

    return { text: "(the agent got stuck in a tool loop)", tools: used };
  }

  return { respond };
}
