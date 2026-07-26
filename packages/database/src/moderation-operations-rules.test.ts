import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateContinuousCoverageMinutes,
  evaluateModerationReadiness
} from "./moderation-operations-rules.js";

test("moderation readiness passes with continuous coverage and no overdue reports", () => {
  const state = evaluateModerationReadiness({
    coveredMinutes: 1440,
    activeOrUpcomingModerators: 2,
    overdueCriticalReports: 0,
    overdueHighReports: 0,
    pendingAppeals: 3
  });
  assert.equal(state.ready, true);
  assert.deepEqual(state.blockers, []);
});

test("moderation readiness blocks a gap in the 24 hour window", () => {
  const state = evaluateModerationReadiness({
    coveredMinutes: 1439,
    activeOrUpcomingModerators: 2,
    overdueCriticalReports: 0,
    overdueHighReports: 0,
    pendingAppeals: 0
  });
  assert.equal(state.ready, false);
  assert.match(state.blockers[0] ?? "", /cobertura/i);
});

test("moderation readiness blocks overdue critical and high reports", () => {
  const state = evaluateModerationReadiness({
    coveredMinutes: 1440,
    activeOrUpcomingModerators: 1,
    overdueCriticalReports: 1,
    overdueHighReports: 2,
    pendingAppeals: 0
  });
  assert.equal(state.ready, false);
  assert.equal(state.blockers.length, 2);
});

test("coverage calculator stops at the first gap", () => {
  const start = new Date("2026-07-26T00:00:00.000Z");
  const end = new Date("2026-07-27T00:00:00.000Z");
  const covered = calculateContinuousCoverageMinutes([
    {
      startsAt: "2026-07-25T23:00:00.000Z",
      endsAt: "2026-07-26T08:00:00.000Z"
    },
    {
      startsAt: "2026-07-26T08:30:00.000Z",
      endsAt: "2026-07-27T01:00:00.000Z"
    }
  ], start, end);
  assert.equal(covered, 480);
});
