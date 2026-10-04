// The simulated caller: an LLM role-playing the person the agent is calling, driven by the
// scenario's persona + goal. It replies one short spoken turn at a time and ends its line
// with <END> when it considers the call over. Using an LLM (not a fixed script) exercises
// real conversational variability; pinning persona+goal keeps each scenario reproducible.
import type Anthropic from "@anthropic-ai/sdk";
import { CALLER_MODEL } from "./config";
import type { Scenario } from "./types";

export function createCaller(anthropic: Anthropic, scenario: Scenario) {
  const system = `את/ה משחק/ת אדם שמקבל שיחת טלפון מעוזרת AI של עסק. הישאר/י באופי לכל אורך השיחה.
דמות: ${scenario.persona}
המטרה שלך: ${scenario.goal}

הנחיות:
- דבר/י עברית טבעית, תור אחד קצר בכל פעם, כמו אדם אמיתי בטלפון.
- אם העוזרת השיגה את מטרתך (קבעה תור / טיפלה בבקשתך) — הודה/י בקצרה וסיים/י.
- אם המטרה שלך היא לסרב/לבקש שלא יתקשרו — בקש/י את זה במפורש כבר בהתחלה.
- הפלט שלך: אך ורק המשפט שאתה אומר בקול (עברית). בלי הסברים, בלי מטא-טקסט.
- אם השיחה צריכה להסתיים מצידך — סיים/י את המשפט בתו <END>.`;

  const messages: Anthropic.MessageParam[] = [];

  async function next(agentText: string): Promise<string> {
    messages.push({ role: "user", content: `העוזרת אמרה: "${agentText}"\n\nמה את/ה עונה?` });
    const res = await anthropic.messages.create({
      model: CALLER_MODEL,
      max_tokens: 200,
      system,
      messages,
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    messages.push({ role: "assistant", content: text });
    return text;
  }

  return { next };
}
