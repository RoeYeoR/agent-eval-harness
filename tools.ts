// Deterministic mock of the production tool handlers (src/app/api/webhooks/vapi/route.ts).
// Each tool is now ASYNC and routes its "backend call" through withResilience (see http.ts) —
// so the timeout/retry/backoff path is real code the eval exercises, not a comment. Tools
// still return a STRING fed back to the model (including error strings → graceful degradation).
import { TransientError, withResilience } from "./http";
import type { MockState, Scenario, ToolInvocation } from "./types";

export type MockTools = Record<string, (args: Record<string, unknown>) => Promise<string>>;

function label(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Simulates a flaky third-party backend so the retry logic actually runs:
//  "500"   → always throws a transient error (retries exhaust → the tool degrades gracefully)
//  "flaky" → throws on the first 2 attempts, then succeeds (retry RECOVERS)
//  "empty"/none → succeeds (an empty calendar is a valid result, not a failure)
async function callBackend(kind: string, fault: string | undefined, state: MockState): Promise<void> {
  state.attempts[kind] = (state.attempts[kind] ?? 0) + 1;
  if (fault === "500") throw new TransientError(`${kind} returned 500`);
  if (fault === "flaky" && state.attempts[kind] <= 2) throw new TransientError(`${kind} returned 503`);
}

export function createMockTools(scenario: Scenario): { tools: MockTools; state: MockState } {
  const state: MockState = { bookings: [], doNotCall: false, log: [], attempts: {} };

  const record = (name: string, args: Record<string, unknown>, result: string): string => {
    const inv: ToolInvocation = { name, args, result };
    state.log.push(inv);
    return result;
  };

  const tools: MockTools = {
    async check_availability(args) {
      try {
        await withResilience(() => callBackend("check_availability", scenario.inject?.check_availability, state), {
          label: "check_availability",
          retries: 2,
        });
      } catch {
        return record("check_availability", args, "TOOL_ERROR: the calendar service is unavailable after retries (500).");
      }
      const slots = scenario.inject?.check_availability === "empty" ? [] : scenario.availableSlots;
      if (slots.length === 0) {
        return record("check_availability", args, "No open slots in the next two weeks — apologize and offer a callback.");
      }
      return record("check_availability", args, slots.slice(0, 3).map((s) => `${label(s)} (${s})`).join("; "));
    },

    async book_meeting(args) {
      try {
        await withResilience(() => callBackend("book_meeting", scenario.inject?.book_meeting, state), {
          label: "book_meeting",
          retries: 2,
        });
      } catch {
        return record("book_meeting", args, "TOOL_ERROR: the booking service is unavailable after retries (500).");
      }
      const startTime = String(args.startTime ?? "");
      if (!startTime) {
        return record("book_meeting", args, "Missing a chosen time — ask the lead to pick one of the offered slots first.");
      }
      // Idempotency: startTime IS the key — booking the same slot twice is a no-op, so a retry
      // or a double tool-call never creates two bookings.
      if (!state.bookings.some((b) => b.startTime === startTime)) {
        state.bookings.push({ startTime, leadName: String(args.leadName ?? "the lead") });
      }
      return record("book_meeting", args, `Booked for ${label(startTime)}. Confirm this out loud with the lead.`);
    },

    async mark_do_not_call(args) {
      state.doNotCall = true;
      return record("mark_do_not_call", args, "Marked — acknowledge respectfully in one sentence and end the call now.");
    },
  };

  return { tools, state };
}
