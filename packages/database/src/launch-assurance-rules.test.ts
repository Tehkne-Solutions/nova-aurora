import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_REHEARSAL_TYPES,
  REQUIRED_SERVICE_COMPONENTS,
  evaluateLaunchOperationsReadiness
} from "./launch-assurance-rules.js";

const operational = Object.fromEntries(
  REQUIRED_SERVICE_COMPONENTS.map((component) => [component, "operational"])
);
const now = new Date("2026-07-26T12:00:00.000Z");

test("bloqueia quando exercícios e ensaios ainda não existem", () => {
  const result = evaluateLaunchOperationsReadiness({
    componentStatuses: operational,
    latestPassedIncidentExerciseAt: null,
    latestPassedRehearsals: {},
    openCriticalReports: 0,
    now
  });
  assert.equal(result.launchReady, false);
  assert.equal(result.blockers.length, 3);
});

test("bloqueia componente degradado e denúncia crítica", () => {
  const result = evaluateLaunchOperationsReadiness({
    componentStatuses: { ...operational, market: "degraded" },
    latestPassedIncidentExerciseAt: "2026-07-20T12:00:00.000Z",
    latestPassedRehearsals: {
      [REQUIRED_REHEARSAL_TYPES[0]]: "2026-07-20T12:00:00.000Z",
      [REQUIRED_REHEARSAL_TYPES[1]]: "2026-07-20T12:00:00.000Z"
    },
    openCriticalReports: 1,
    now
  });
  assert.equal(result.launchReady, false);
  assert.ok(result.blockers.some((blocker) => blocker.includes("market")));
  assert.ok(result.blockers.some((blocker) => blocker.includes("Denúncias críticas")));
});

test("libera somente com serviços, exercício e ensaios vigentes", () => {
  const result = evaluateLaunchOperationsReadiness({
    componentStatuses: operational,
    latestPassedIncidentExerciseAt: "2026-07-20T12:00:00.000Z",
    latestPassedRehearsals: {
      "public-beta-open": "2026-07-20T12:00:00.000Z",
      rollback: "2026-07-20T12:00:00.000Z"
    },
    openCriticalReports: 0,
    now
  });
  assert.equal(result.launchReady, true);
  assert.deepEqual(result.blockers, []);
});
