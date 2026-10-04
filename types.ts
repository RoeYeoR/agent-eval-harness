// Shared types for the eval harness.

export type FaultCode = "500" | "empty" | "flaky"; // 500=persistent, flaky=fails twice then recovers

export type Scenario = {
  id: string;
  skill?: string; // which vertical skill to load (dental | gym); defaults to dental
  persona: string; // who the simulated caller role-plays
  goal: string; // what the caller is trying to achieve
  availableSlots: string[]; // ISO timestamps the mock calendar returns
  inject?: { check_availability?: FaultCode; book_meeting?: "500" }; // fault injection
  expect: {
    outcome: "booked" | "callback" | "opted_out";
    noDoubleBook?: boolean;
  };
};

export type ToolInvocation = { name: string; args: Record<string, unknown>; result: string };

export type Turn = { role: "agent" | "caller"; text: string; tools?: ToolInvocation[] };

export type MockState = {
  bookings: { startTime: string; leadName: string }[];
  doNotCall: boolean;
  log: ToolInvocation[]; // ordered record of every tool call
  attempts: Record<string, number>; // per-backend call attempts (so "flaky" can recover)
};

export type RunResult = {
  scenario: Scenario;
  transcript: Turn[];
  state: MockState;
  callerTurns: number;
};

export type Check = { name: string; pass: boolean; detail?: string };

export type ScenarioScore = {
  id: string;
  deterministic: Check[];
  judge: { pass: boolean; reason: string };
  pass: boolean;
};
