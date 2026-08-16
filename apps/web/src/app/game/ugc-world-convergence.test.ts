import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const cityWorld = readFileSync(new URL("./city-world.tsx", import.meta.url), "utf8");

test("shared UGC world refresh is bounded and only runs while the page is visible", () => {
  assert.match(cityWorld, /UGC_WORLD_REFRESH_INTERVAL_MS = 5000/);
  assert.match(cityWorld, /document\.visibilityState === "hidden"/);
  assert.match(cityWorld, /window\.setInterval\(\(\) => void refreshWorldPlacements\(\), UGC_WORLD_REFRESH_INTERVAL_MS\)/);
  assert.match(cityWorld, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(cityWorld, /document\.visibilityState === "visible"/);
});

test("shared UGC world refresh avoids overlapping requests and preserves last known-good state on transient failures", () => {
  assert.match(cityWorld, /refreshInFlight/);
  assert.match(cityWorld, /if \(disposed \|\| refreshInFlight \|\| document\.visibilityState === "hidden"\) return/);
  assert.match(cityWorld, /refreshInFlight = true/);
  assert.match(cityWorld, /refreshInFlight = false/);
  assert.match(cityWorld, /Keep the last known-good world snapshot on transient refresh failures/);
  assert.doesNotMatch(cityWorld, /catch[\s\S]{0,220}setPlacements\(\[\]\)/);
});

test("shared UGC world refresh cleans timer, visibility listener and active request", () => {
  assert.match(cityWorld, /window\.clearInterval\(refreshTimer\)/);
  assert.match(cityWorld, /document\.removeEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(cityWorld, /activeController\?\.abort\(\)/);
});

// Tehkné Solutions
