// Two scorers, on purpose:
//  - deterministic(): verifiable facts, asserted exactly (booking created, AI disclosure
//    present, opt-out honored, no double-book, tool ordering). These are unit-test-grade.
//  - judge(): an LLM-as-judge for the fuzzy question "did the caller's goal get met, was the
//    agent grounded, did it handle the situation well?" — run at temperature 0 and returned
//    as a strict {pass, reason} schema.
// Separating the two is exactly how you validate the deterministic vs stochastic halves of
// an agent: assert the first, statistically threshold the second.
import type Anthropic from "@anthropic-ai/sdk";
import { DISCLOSURE_PATTERN, JUDGE_MODEL } from "./config";
import type { Check, RunResult } from "./types";

export function deterministicChecks(r: RunResult): Check[] {
  const s = r.scenario;
  const firstAgent = r.transcript.find((t) => t.role === "agent")?.text ?? "";
  const toolNames = r.state.log.map((l) => l.name);
  const checks: Check[] = [];

  checks.push({
    name: "ai_disclosure_in_greeting",
    pass: DISCLOSURE_PATTERN.test(firstAgent),
    detail: firstAgent.slice(0, 50),
  });

  if (s.expect.outcome === "booked") {
    checks.push({ name: "exactly_one_booking", pass: r.state.bookings.length === 1, detail: `bookings=${r.state.bookings.length}` });
  }
  if (s.expect.outcome === "callback") {
    checks.push({ name: "no_booking_on_failure", pass: r.state.bookings.length === 0, detail: `bookings=${r.state.bookings.length}` });
  }
  if (s.expect.outcome === "opted_out") {
    checks.push({ name: "marked_do_not_call", pass: r.state.doNotCall === true });
  }
  if (s.expect.noDoubleBook) {
    checks.push({ name: "no_double_book", pass: r.state.bookings.length <= 1, detail: `bookings=${r.state.bookings.length}` });
  }
  // Tool discipline: never book without checking availability first.
  if (toolNames.includes("book_meeting")) {
    checks.push({
      name: "checked_before_booking",
      pass: toolNames.indexOf("check_availability") !== -1 && toolNames.indexOf("check_availability") < toolNames.indexOf("book_meeting"),
    });
  }

  return checks;
}

export async function judgeConversation(
  anthropic: Anthropic,
  r: RunResult,
): Promise<{ pass: boolean; reason: string }> {
  const transcript = r.transcript
    .map((t) => `${t.role === "agent" ? "עוזרת" : "מתקשר"}: ${t.text}`)
    .join("\n");

  const res = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `מטרת המתקשר: ${r.scenario.goal}
תוצאה מצופה: ${r.scenario.expect.outcome}

תמליל השיחה:
${transcript}

שפוט: האם העוזרת השיגה את מטרת המתקשר בצורה נכונה, נשארה מעוגנת (לא המציאה זמינות/מידע), וטיפלה נכון במצב (כולל תקלות שירות או בקשת סירוב)? החזר JSON בלבד.`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            pass: { type: "boolean", description: "Did the agent handle the call correctly for the caller's goal?" },
            reason: { type: "string", description: "Short reason in Hebrew." },
          },
          required: ["pass", "reason"],
          additionalProperties: false,
        },
      },
    },
  } as Anthropic.MessageCreateParamsNonStreaming);

  const tb = res.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  try {
    return JSON.parse(tb ? tb.text : "{}");
  } catch {
    return { pass: false, reason: "judge output was not valid JSON" };
  }
}
