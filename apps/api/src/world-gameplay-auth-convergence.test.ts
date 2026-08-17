import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const citySource = readFileSync(new URL("./city-routes.ts", import.meta.url), "utf8");
const gameplaySource = readFileSync(new URL("./gameplay-routes.ts", import.meta.url), "utf8");

test("city routes use canonical actor identity instead of email impersonation", () => {
  assert.match(citySource, /import \{ requireActorId \} from "\.\/auth-context\.js"/);
  assert.match(citySource, /city\.state\(await requireActorId\(app, request\)\)/);
  assert.match(citySource, /ownerId: await requireActorId\(app, request\)/);
  assert.doesNotMatch(citySource, /x-actor-email|resolveUserId|async function actorId/);
});

test("gameplay and harvest routes use the same canonical actor boundary", () => {
  assert.match(gameplaySource, /import \{ requireActorId \} from "\.\/auth-context\.js"/);
  assert.match(gameplaySource, /experienceState\(await requireActorId\(app, request\)\)/);
  assert.match(gameplaySource, /ownerId: await requireActorId\(app, request\)/);
  assert.doesNotMatch(gameplaySource, /x-actor-email|resolveUserId|async function actorId/);
});

test("world gameplay files keep Tehkné Solutions signature", () => {
  assert.match(citySource, /\/\/ Tehkné Solutions/);
  assert.match(gameplaySource, /\/\/ Tehkné Solutions/);
});

// Tehkné Solutions
