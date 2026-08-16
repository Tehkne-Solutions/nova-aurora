import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

test("core market and production use the canonical authenticated actor boundary", () => {
  assert.match(serverSource, /import \{ authSecurity, requireActorId \} from "\.\/auth-context\.js"/);
  assert.doesNotMatch(serverSource, /function actorId\(/);
  assert.doesNotMatch(serverSource, /x-actor-email/);
  assert.doesNotMatch(serverSource, /economy\.resolveUserId\(/);
});

test("all private market and production operations bind ownership to requireActorId", () => {
  const privateOperations = [
    "economy.createMarketOrder({",
    "economy.cancelMarketOrder({",
    "economy.startProduction({",
    "economy.cancelProduction({"
  ];
  for (const operation of privateOperations) {
    const index = serverSource.indexOf(operation);
    assert.ok(index >= 0, `${operation} missing`);
    assert.match(
      serverSource.slice(index, index + 520),
      /ownerId: await requireActorId\(app, request\)/
    );
  }
  assert.match(
    serverSource,
    /economy\.productionOrders\(await requireActorId\(app, request\)\)/
  );
});

test("public market reads stay public and matching semantics are unchanged", () => {
  assert.match(serverSource, /"\/v1\/market\/order-book\/:itemCode"/);
  assert.match(serverSource, /economy\.orderBook\(request\.params\.itemCode\)/);
  assert.match(serverSource, /"\/v1\/market\/trades\/:itemCode"/);
  assert.match(serverSource, /economy\.recentTrades\(/);
});

test("production queue handoff and idempotency remain intact", () => {
  assert.match(serverSource, /idempotencyKey: idempotencyKey\(request\)/);
  assert.match(serverSource, /await enqueueProductionCompletion\(\{/);
  assert.match(serverSource, /orderId: order\.id/);
  assert.match(serverSource, /completesAt: order\.completesAt/);
  assert.match(serverSource, /production\.queue\.unavailable/);
});

test("CORS exposes only canonical auth and administrative context headers", () => {
  assert.match(serverSource, /"authorization"/);
  assert.match(serverSource, /"x-actor-context"/);
  assert.doesNotMatch(serverSource, /"x-actor-email"/);
});

// Tehkné Solutions
