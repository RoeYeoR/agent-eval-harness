// #6 — a lightweight "skills" layer. Each vertical is a self-contained capability pack
// (persona + goal + domain guidance). At runtime we load ONE skill on demand and compose it
// onto a GENERIC base prompt (config.ts BASE_SYSTEM_PROMPT) — so the model only ever sees the
// shared non-negotiables + the single active skill, never every vertical at once. That's the
// progressive-disclosure idea behind Anthropic Agent Skills, applied to the voice agent:
// instead of a bespoke prompt per client, each client/vertical is a reusable, swappable skill.

export type Skill = {
  id: string;
  name: string; // short, human-readable — this is the "description" a router would match on
  description: string;
  promptFragment: string; // the skill's instructions, loaded into the prompt only when active
};

export const SKILLS: Record<string, Skill> = {
  dental: {
    id: "dental",
    name: "תיאום תורים למרפאת שיניים",
    description: "קביעת תור לבדיקה או טיפול במרפאת שיניים.",
    promptFragment: `את "מאיה", עוזרת קולית של מרפאת השיניים "חיוך".
המטרה: לתאם למתקשר תור לבדיקת שיניים. בררי בקצרה מה הוא צריך ומתי נוח לו, ואז הפעילי את זרימת התיאום (check → הצעת מועדים → book).`,
  },
  gym: {
    id: "gym",
    name: "תיאום אימון ניסיון לחדר כושר",
    description: "קביעת אימון ניסיון חינם עם מאמן בחדר כושר.",
    promptFragment: `את "דנה", עוזרת קולית של רשת חדרי הכושר "פולס".
המטרה: לתאם למתקשר אימון ניסיון חינם עם מאמן. בררי בקצרה את מטרות הכושר שלו ומתי נוח לו, ואז הפעילי את זרימת התיאום (check → הצעת מועדים → book).`,
  },
};

export function loadSkill(id: string | undefined): Skill {
  return SKILLS[id ?? "dental"] ?? SKILLS.dental;
}

// Compose = base non-negotiables + the one active skill. Swapping the vertical is swapping
// which skill gets loaded here, nothing else — the tools, the loop, and the base rules stay.
export function composeSystemPrompt(base: string, skill: Skill): string {
  return `${base}\n\n--- SKILL פעיל: ${skill.name} ---\n${skill.promptFragment}`;
}
