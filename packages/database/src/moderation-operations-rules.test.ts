import test from "node:test";
import assert from "node:assert/strict";
import { evaluateModerationReadiness } from "./moderation-operations-rules.js";

test("moderation readiness passes with coverage and no overdue priority reports", () => {
  const state = evaluateModerationReadiness({
    activeOrUpcomingModerators: 2,
    overdueCriticalReports: 0,
    overdueHighReports: 0,
    pendingAppeals: 3
  });
  assert.equal(state.ready, true);
  assert.deepEqual(state.blockers, []);
});

test("moderation readiness blocks missing coverage", () => {
  const state = evaluateModerationReadiness({
    activeOrUpcomingModerators: 0,
    overdueCriticalReports: 0,
    overdueHighReports: 0,
    pendingAppeals: 0
  });
  assert.equal(state.ready, false);
  assert.match(state.blockers[0] ?? "", /cobertura/i);
});

test("moderation readiness blocks overdue critical and high reports", () => {
  const state = evaluateModerationReadiness({
    activeOrUpcomingModerators: 1,
    overdueCriticalReports: 1,
    overdueHighReports: 2,
    pendingAppeals: 0
  });
  assert.equal(state.ready, false);
  assert.equal(state.blockers.length, 2);
});
