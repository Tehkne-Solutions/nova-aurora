import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routeSource = readFileSync(new URL("./ugc-world-placement-routes.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../../../packages/database/sql/050_ugc_world_placement_animation_state.sql", import.meta.url),
  "utf8"
);

const states = ["idle", "open", "close", "activate", "deactivate", "spin"] as const;

test("migration 050 persists a fail-closed placement animation state", () => {
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS animation_state text NOT NULL DEFAULT 'idle'/);
  for (const state of states) assert.ok(migrationSource.includes(`'${state}'`));
  assert.match(migrationSource, /ugc_world_placements_animation_state_check/);
});

test("placement API validates, persists, selects and serializes animationState", () => {
  assert.match(routeSource, /const ANIMATION_STATES = \["idle", "open", "close", "activate", "deactivate", "spin"\] as const/);
  assert.match(routeSource, /animationState: z\.enum\(ANIMATION_STATES\)\.default\("idle"\)/);
  assert.match(routeSource, /placement\.rotation_y_degrees,placement\.animation_state/);
  assert.match(routeSource, /rotation_y_degrees,animation_state,status/);
  assert.match(routeSource, /\$\{body\.animationState\}/);
  assert.match(routeSource, /animationState: normalizeAnimationState\(row\.animation_state\)/);
  assert.match(routeSource, /animationState: normalizeAnimationState\(result\.row\.animation_state\)/);
  assert.match(routeSource, /animationStates: ANIMATION_STATES/);
});

test("owner may transition only an active clean GLB placement through canonical states", () => {
  assert.match(routeSource, /const updateAnimationStateSchema = z\.object\(\{\s*animationState: z\.enum\(ANIMATION_STATES\)/s);
  assert.match(routeSource, /\/v1\/ugc\/world\/placements\/:placementId\/animation-state/);
  assert.match(routeSource, /placement\.owner_user_id=\$\{actor\.userId\}::uuid/);
  assert.match(routeSource, /placement\.status='active'/);
  assert.match(routeSource, /asset\.status='clean'/);
  assert.match(routeSource, /asset\.content_type='model\/gltf-binary'/);
  assert.match(routeSource, /SET animation_state=\$\{body\.animationState\},updated_at=now\(\)/);
  assert.match(routeSource, /Placement GLB ativo e controlável não encontrado/);
});

// Tehkné Solutions
