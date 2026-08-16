import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const entrypoint = readFileSync(new URL("./glb-placement.ts", import.meta.url), "utf8");
const statefulPlacement = readFileSync(new URL("./glb-stateful-placement.tsx", import.meta.url), "utf8");
const cityWorld = readFileSync(new URL("./city-world.tsx", import.meta.url), "utf8");

test("canonical GLB entrypoint routes through persisted-state adapter before v10", () => {
  assert.match(entrypoint, /export \{ GlbPlacement \} from "\.\/glb-stateful-placement"/);
  assert.doesNotMatch(entrypoint, /from "\.\/glb-node-animation-placement"/);
  assert.match(statefulPlacement, /prepareGlbForAnimationState\(buffer, normalizedState\)/);
  assert.match(statefulPlacement, /GlbPlacement as CertifiedGlbPlacement/);
  assert.match(statefulPlacement, /data-glb-state-adapter="persisted-state-clip-v1"/);
});

test("CityWorld transports persisted animationState into the canonical GLB placement", () => {
  assert.match(cityWorld, /animationState\?: string/);
  assert.match(cityWorld, /data-animation-state=\{placement\.animationState \?\? "idle"\}/);
  assert.match(cityWorld, /animationState=\{placement\.animationState\}/);
});

// Tehkné Solutions
