import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const realtimeSource = readFileSync(new URL("./realtime.ts", import.meta.url), "utf8");

test("live sockets start unlocated and adopt bounded location from presence heartbeat", () => {
  assert.match(realtimeSource, /locationCode: string \| null/);
  assert.match(realtimeSource, /const connection: LiveSocket = \{ socket, identity, locationCode: null \}/);
  assert.match(realtimeSource, /message\.locationCode\.trim\(\)\.slice\(0, 80\)/);
  assert.match(realtimeSource, /if \(locationCode\) connection\.locationCode = locationCode/);
  assert.match(realtimeSource, /\.\.\.\(locationCode \? \{ locationCode \} : \{\}\)/);
});

test("UGC world broadcasts are routed by payload location", () => {
  assert.match(realtimeSource, /function realtimeRoute\(payload: string\): RealtimeRoute/);
  assert.match(realtimeSource, /value\.locationCode \?\? value\.payload\?\.locationCode/);
  assert.match(realtimeSource, /route\.eventType === "ugc\.world\.placement\.updated"/);
  assert.match(realtimeSource, /route\.locationCode/);
  assert.match(realtimeSource, /connection\.locationCode !== route\.locationCode/);
});

test("private audiences bypass spatial filtering while unrelated global events remain global", () => {
  assert.match(realtimeSource, /if \(audience && audience !== connection\.identity\.userId\) continue/);
  assert.match(realtimeSource, /!audience\s*&& route\.eventType === "ugc\.world\.placement\.updated"/s);
  assert.doesNotMatch(realtimeSource, /if \(route\.locationCode && connection\.locationCode !== route\.locationCode\) continue/);
});

test("location route parsing fails closed without breaking subscriber delivery", () => {
  assert.match(realtimeSource, /return \{ eventType: null, locationCode: null \}/);
  assert.match(realtimeSource, /if \(connection\.socket\.readyState === 1\) connection\.socket\.send\(payload\)/);
});

// Tehkné Solutions
