import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  CityGameplayService,
  closeDb,
  GameplayExperienceService
} from "./index.js";

test("jogador navega, vence o minijogo e conclui o primeiro trabalho", async () => {
  const city = new CityGameplayService();
  const gameplay = new GameplayExperienceService();
  const bobId = await city.resolveUserId("bob@nova-aurora.local");
  const run = crypto.randomUUID();

  const employment = await city.movePlayer({
    ownerId: bobId,
    locationCode: "employment-center",
    idempotencyKey: `city:${run}:employment`
  });
  assert.equal(employment.player.currentLocationCode, "employment-center");

  const accepted = await city.acceptJob({
    ownerId: bobId,
    jobCode: "harvest-support",
    idempotencyKey: `city:${run}:accept`
  });
  assert.equal(
    accepted.jobs.find((job) => job.code === "harvest-support")?.assignmentStatus,
    "accepted"
  );

  await city.movePlayer({
    ownerId: bobId,
    locationCode: "harvest-fields",
    idempotencyKey: `city:${run}:fields`
  });

  const session = await gameplay.startHarvest({
    ownerId: bobId,
    idempotencyKey: `gameplay:${run}:start`
  });
  assert.equal(session.status, "active");
  assert.equal(session.challenge.length, 7);

  const harvest = await gameplay.completeHarvest({
    ownerId: bobId,
    sessionId: session.id,
    sequence: session.challenge,
    idempotencyKey: `gameplay:${run}:complete`
  });
  assert.equal(harvest.status, "completed");
  assert.ok(harvest.score >= 70);

  const completed = await city.completeJob({
    ownerId: bobId,
    jobCode: "harvest-support",
    idempotencyKey: `city:${run}:complete`
  });
  assert.equal(
    completed.jobs.find((job) => job.code === "harvest-support")?.assignmentStatus,
    "completed"
  );
  assert.ok((completed.player.inventory.wheat ?? 0) >= 400);
  assert.ok(completed.onboarding.completedSteps >= 3);

  const repeated = await city.completeJob({
    ownerId: bobId,
    jobCode: "harvest-support",
    idempotencyKey: `city:${run}:complete`
  });
  assert.deepEqual(repeated.player.inventory, completed.player.inventory);
});

after(async () => closeDb());
