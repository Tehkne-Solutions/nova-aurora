import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const interactionSource = readFileSync(new URL("./ugc-world-interaction-routes.ts", import.meta.url), "utf8");
const realtimeSource = readFileSync(new URL("./realtime.ts", import.meta.url), "utf8");

test("successful UGC interaction publishes canonical world state after persistence", () => {
  assert.match(interactionSource, /SET animation_state=\$\{body\.animationState\},updated_at=now\(\)/);
  assert.match(interactionSource, /INSERT INTO ugc_world_placement_interactions/);
  assert.match(interactionSource, /publishRealtimeEvent\(\{/);
  assert.match(interactionSource, /eventType: "ugc\.world\.placement\.updated"/);
  assert.match(interactionSource, /interactionId,\s*placementId,\s*locationCode: result\.locationCode/s);
  assert.match(interactionSource, /previousAnimationState: result\.previousState/);
  assert.match(interactionSource, /animationState: result\.animationState/);
  assert.match(interactionSource, /updatedAt: result\.updatedAt/);
});

test("cooldown rejection returns before realtime publication", () => {
  const cooldownReturn = interactionSource.indexOf("return reply.code(429).send");
  const publishCall = interactionSource.indexOf("void publishRealtimeEvent");
  assert.ok(cooldownReturn >= 0);
  assert.ok(publishCall > cooldownReturn);
});

test("realtime publication is best-effort and never rolls back durable interaction state", () => {
  assert.match(interactionSource, /void publishRealtimeEvent/);
  assert.match(interactionSource, /if \(!published\)/);
  assert.match(interactionSource, /ugc\.realtime\.publish\.unavailable/);
  assert.match(realtimeSource, /connectTimeout: REALTIME_PUBLISH_CONNECT_TIMEOUT_MS/);
  assert.match(realtimeSource, /enableOfflineQueue: false/);
  assert.match(realtimeSource, /maxRetriesPerRequest: 1/);
  assert.match(realtimeSource, /retryStrategy: \(\) => null/);
  assert.match(realtimeSource, /return false/);
});

test("events without user audience broadcast to every authenticated live socket", () => {
  assert.match(realtimeSource, /const audience = audienceUserId\(payload\)/);
  assert.match(realtimeSource, /if \(audience && audience !== connection\.identity\.userId\) continue/);
  assert.match(realtimeSource, /connection\.socket\.readyState === 1/);
  assert.match(realtimeSource, /connection\.socket\.send\(payload\)/);
  assert.match(realtimeSource, /subscriber\.subscribe\(REALTIME_CHANNEL\)/);
});

test("realtime Redis connections are cleaned up with API shutdown", () => {
  assert.match(realtimeSource, /app\.addHook\("onClose"/);
  assert.match(realtimeSource, /subscriber\.disconnect\(\)/);
  assert.match(realtimeSource, /publisher\?\.disconnect\(\)/);
  assert.match(realtimeSource, /sockets\.clear\(\)/);
});

// Tehkné Solutions
