import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./regional-business-management-routes.ts", import.meta.url), "utf8");

test("regional management uses canonical actor identity on state and mutations", () => {
  assert.match(source, /import \{ requireActorId \} from "\.\/auth-context\.js"/);
  assert.match(source, /management\.state\(await requireActorId\(app, request\)\)/);
  assert.match(source, /ownerId: await requireActorId\(app, request\)/);
  assert.doesNotMatch(source, /x-actor-email|resolveUserId|async function actorId/);
});

test("all campaign channels remain available through authenticated regional management", () => {
  assert.match(source, /channel: z\.enum\(\["local", "social", "outdoor", "influencer"\]\)/);
  assert.match(source, /app\.post\("\/v1\/management\/campaigns"/);
  assert.match(source, /return management\.createCampaign\(/);
});

test("B2B goals training regional cycles and alerts share the canonical actor boundary", () => {
  for (const route of [
    /\/v1\/management\/supplier-offers/,
    /\/v1\/management\/goals/,
    /\/v1\/management\/employees\/.*\/train/,
    /\/v1\/management\/regional-cycles/,
    /\/v1\/management\/alerts\/.*\/acknowledge/
  ]) assert.match(source, route);
  assert.doesNotMatch(source, /request\.headers\["x-actor-email"\]/);
});

test("regional management keeps Tehkné Solutions signature", () => {
  assert.match(source, /\/\/ Tehkné Solutions/);
});

// Tehkné Solutions
