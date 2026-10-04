// Central config for the harness: models, the agent-under-test's prompt + tools,
// and the compliance regex. The tools and constraints here MIRROR production
// (src/lib/vapi.ts tool schemas + the non-negotiables baked into every generated
// systemPrompt by src/lib/claude.ts) so the harness tests the real brain, not a toy.
import type Anthropic from "@anthropic-ai/sdk";

// Point these at production's exact models to test the real thing. Defaults use a
// known-good id so the skeleton runs out of the box. In production the in-call
// brain is VAPI_MODEL (src/lib/vapi.ts) — set EVAL_AGENT_MODEL to it for fidelity.
export const AGENT_MODEL = process.env.EVAL_AGENT_MODEL || "claude-sonnet-5";
export const CALLER_MODEL = process.env.EVAL_CALLER_MODEL || "claude-sonnet-5";
export const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || "claude-sonnet-5";

export const MAX_TURNS = Number(process.env.EVAL_MAX_TURNS || 8);
export const RUNS_PER_SCENARIO = Number(process.env.EVAL_RUNS || 1);
export const PASS_THRESHOLD = Number(process.env.EVAL_THRESHOLD || 0.75);

// Which agent implementation to test: "manual" = the hand-written tool loop (agent.ts),
// "toolrunner" = Anthropic's Tool Runner framework (agent-toolrunner.ts). Same behavior,
// two ways to build an agent — swap to compare.
export const AGENT_IMPL = process.env.EVAL_AGENT_IMPL || "manual";

// Copied verbatim from src/lib/claude.ts — the same compliance backstop the
// product enforces on every greeting. If this regex changes there, change it here.
export const DISCLOSURE_PATTERN =
  /\b(ai|artificial intelligence|automated|virtual assistant|voice assistant)\b|בינה מלאכותית|וירטואל(י|ית)|אוטומט(י|ית)/i;

// Mirrors src/lib/claude.ts's ensureAiDisclosure: a prompt instruction alone isn't a
// guarantee (the model skips it sometimes), so the product CODE-enforces the AI disclosure on
// the greeting. We mirror that backstop here so the harness tests the real product guarantee,
// not the model's luck — and the disclosure check becomes deterministic.
export function ensureAiDisclosure(greeting: string): string {
  if (DISCLOSURE_PATTERN.test(greeting)) return greeting;
  return `שלום, מדברת עוזרת AI מטעם העסק. ${greeting}`;
}

// The three production tools (src/lib/vapi.ts), re-expressed in the Anthropic SDK
// tool shape so we can run the same agent locally via messages.create().
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description:
      "Look up real open slots on the calendar so you can offer the contact 2-3 concrete options to choose from. Call this before offering any specific time.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "book_meeting",
    description:
      "Reserve a meeting. Only call this after the contact has explicitly picked one of the exact slot times returned by check_availability — reuse that ISO timestamp exactly.",
    input_schema: {
      type: "object",
      properties: {
        leadName: { type: "string", description: "The contact's full name." },
        startTime: {
          type: "string",
          description: "The exact ISO 8601 timestamp of the chosen slot, copied from check_availability's output.",
        },
        notes: { type: "string", description: "Anything useful to bring into the meeting." },
      },
      required: ["leadName", "startTime"],
    },
  },
  {
    name: "mark_do_not_call",
    description:
      "Call this the moment the contact asks not to be called again, opts out, or withdraws consent — even mid-sentence. After calling it, acknowledge respectfully in one short sentence and end the call. Do not keep pitching afterward.",
    input_schema: { type: "object", properties: {} },
  },
];

// The GENERIC base prompt: only the non-negotiables every agent has regardless of vertical
// (same ones src/lib/claude.ts bakes into every generated agent) — AI disclosure, the
// check -> offer -> book flow, mark_do_not_call on opt-out, graceful tool-error handling, no
// inventing facts. The vertical-specific persona + goal are layered on at runtime from a
// Skill (see evals/skills.ts), so this base is shared across all of them.
export const BASE_SYSTEM_PROMPT = `את עוזרת קולית בעברית של עסק. את מדברת אך ורק עברית טבעית, זורמת וקצרה — כמו בשיחת טלפון אמיתית.

כללים קשיחים (תקפים לכל עסק):
- פתיחה: במשפט הראשון הציגי את עצמך כ"עוזרת AI" (או אוטומטית) מטעם העסק — חובה, בקצרה וטבעי.
- זרימת תיאום: כשהמתקשר מעוניין לקבוע — קראי ל-check_availability, הקריאי בקול 2-3 מהאפשרויות שחזרו, וכשבחר מועד מדויק — קראי ל-book_meeting עם ה-ISO המדויק של אותו מועד (העתיקי אותו כפי שהוא), ואז אשרי בקול.
- אל תמציאי זמינות, מחירים או מידע. אם אינך יודעת — אמרי שתעבירי לבירור ושמישהו יחזור.
- אם כלי מחזיר שגיאה (שירות לא זמין) — אל תיתקעי ואל תמציאי מועד. התנצלי בקצרה והציעי שניצור קשר טלפוני לתיאום.
- אם המתקשר מבקש שלא יתקשרו אליו שוב / מסרב / מושך הסכמה — קראי מיד ל-mark_do_not_call, אשרי במשפט אחד ובנימוס, וסיימי בלי להמשיך לשכנע.
- שמרי על תשובות של משפט-שניים, טבעיות לדיבור.

הפרטים הספציפיים של העסק והמטרה מגיעים ב-SKILL הפעיל שלמטה.`;
