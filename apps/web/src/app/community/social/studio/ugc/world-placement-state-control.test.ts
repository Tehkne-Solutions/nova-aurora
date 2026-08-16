import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./world-placement-studio.tsx", import.meta.url), "utf8");

const states = ["idle", "open", "close", "activate", "deactivate", "spin"] as const;

test("Creator Studio exposes the canonical GLB object states", () => {
  assert.match(source, /const ANIMATION_STATES = \["idle", "open", "close", "activate", "deactivate", "spin"\] as const/);
  for (const state of states) assert.ok(source.includes(`${state}:`));
  assert.match(source, /id="ugc-world-animation-state"/);
  assert.match(source, /animationState: selectedIsGlb \? animationState : "idle"/);
});

test("active GLB placements can transition state through the authenticated owner endpoint", () => {
  assert.match(source, /async function updateAnimationState\(placementId: string, nextState: AnimationState\)/);
  assert.match(source, /\/v1\/ugc\/world\/placements\/\$\{placementId\}\/animation-state/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /JSON\.stringify\(\{ animationState: nextState \}\)/);
  assert.match(source, /setPlacements\(\(current\) => current\.map/);
  assert.match(source, /<GlbPlacement animationState=\{currentState\}/);
});

// Tehkné Solutions
