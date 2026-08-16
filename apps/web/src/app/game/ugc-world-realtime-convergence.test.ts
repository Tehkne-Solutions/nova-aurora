import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const hookSource = readFileSync(new URL("./use-ugc-world-realtime.ts", import.meta.url), "utf8");
const cityWorld = readFileSync(new URL("./city-world.tsx", import.meta.url), "utf8");

test("city world consumes realtime placement updates without removing polling fallback", () => {
  assert.match(cityWorld, /useUgcWorldRealtime\(currentLocationCode/);
  assert.match(cityWorld, /item\.id === placementId \? \{ \.\.\.item, animationState \} : item/);
  assert.match(cityWorld, /UGC_WORLD_REFRESH_INTERVAL_MS = 5000/);
  assert.match(cityWorld, /window\.setInterval\(\(\) => void refreshWorldPlacements\(\), UGC_WORLD_REFRESH_INTERVAL_MS\)/);
});

test("realtime hook authenticates with one-time ticket and opens websocket endpoint", () => {
  assert.match(hookSource, /\/v1\/auth\/realtime-ticket/);
  assert.match(hookSource, /method: "POST"/);
  assert.match(hookSource, /API_URL\.replace\(\/\^http\/, "ws"\)/);
  assert.match(hookSource, /\/v1\/realtime\?ticket=\$\{encodeURIComponent\(ticketPayload\.ticket\)\}/);
  assert.match(hookSource, /new WebSocket\(socketUrl\)/);
});

test("realtime hook accepts only canonical placement state events", () => {
  assert.match(hookSource, /event\.eventType !== "ugc\.world\.placement\.updated"/);
  assert.match(hookSource, /normalizeAnimationState\(event\.payload\?\.animationState\)/);
  assert.match(hookSource, /typeof placementId !== "string" \|\| !animationState/);
  assert.match(hookSource, /handlerRef\.current\(placementId, animationState\)/);
  assert.match(hookSource, /\["idle", "open", "close", "activate", "deactivate", "spin"\]/);
});

test("game realtime carries current location presence and bounded reconnect", () => {
  assert.match(hookSource, /eventType: "presence\.heartbeat"/);
  assert.match(hookSource, /locationCode: locationRef\.current/);
  assert.match(hookSource, /REALTIME_HEARTBEAT_MS = 30_000/);
  assert.match(hookSource, /REALTIME_RECONNECT_BASE_MS = 1_000/);
  assert.match(hookSource, /REALTIME_RECONNECT_MAX_MS = 15_000/);
  assert.match(hookSource, /Math\.min\(\s*REALTIME_RECONNECT_MAX_MS/s);
});

test("realtime hook suspends while hidden and fully cleans resources", () => {
  assert.match(hookSource, /document\.visibilityState === "hidden"/);
  assert.match(hookSource, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(hookSource, /document\.removeEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(hookSource, /window\.clearTimeout\(reconnectTimer\)/);
  assert.match(hookSource, /clearHeartbeat\(\)/);
  assert.match(hookSource, /socket\?\.close\(1000, "Componente desmontado"\)/);
});

// Tehkné Solutions
