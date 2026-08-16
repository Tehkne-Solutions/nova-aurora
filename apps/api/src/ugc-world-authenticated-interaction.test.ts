import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routeSource = readFileSync(new URL("./ugc-world-interaction-routes.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../../../packages/database/sql/052_ugc_authenticated_interactions.sql", import.meta.url),
  "utf8"
);

test("migration 052 creates append-only interaction audit indexes and canonical state checks", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS ugc_world_placement_interactions/);
  assert.match(migrationSource, /placement_id uuid NOT NULL REFERENCES ugc_world_placements\(id\) ON DELETE CASCADE/);
  assert.match(migrationSource, /actor_user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migrationSource, /previous_animation_state text NOT NULL CHECK/);
  assert.match(migrationSource, /requested_animation_state text NOT NULL CHECK/);
  assert.match(migrationSource, /interaction_source text NOT NULL DEFAULT 'authenticated-visitor'/);
  assert.match(migrationSource, /ugc_world_placement_interactions_actor_cooldown_idx/);
  assert.match(migrationSource, /ugc_world_placement_interactions_audit_idx/);
});

test("authenticated interaction route is registered behind the main security stack", () => {
  assert.match(serverSource, /registerUgcWorldInteractionRoutes/);
  assert.match(serverSource, /await registerSecurity\(app\);\s*await registerUgcWorldInteractionRoutes\(app\);/s);
  assert.match(routeSource, /\/v1\/ugc\/world\/placements\/:placementId\/interactions/);
  assert.match(routeSource, /const actor = await requireActor\(app, request\)/);
});

test("visitor interaction is fail-closed to active clean authenticated GLB placements", () => {
  assert.match(routeSource, /String\(placement\.status\) !== "active"/);
  assert.match(routeSource, /String\(placement\.asset_status\) !== "clean"/);
  assert.match(routeSource, /String\(placement\.content_type\) !== "model\/gltf-binary"/);
  assert.match(routeSource, /String\(placement\.interaction_scope\) !== "authenticated"/);
  assert.match(routeSource, /O criador não habilitou interação autenticada neste objeto/);
});

test("visitor interaction applies per-user per-placement cooldown and records state transition", () => {
  assert.match(routeSource, /actor_user_id=\$\{actor\.userId\}::uuid/);
  assert.match(routeSource, /created_at > now\(\) - interval '2 seconds'/);
  assert.match(routeSource, /retry_after_ms/);
  assert.match(routeSource, /reply\.header\("retry-after", String\(retryAfterSeconds\)\)/);
  assert.match(routeSource, /reply\.code\(429\)\.send/);
  assert.match(routeSource, /retryAfterMs: result\.retryAfterMs/);
  assert.match(routeSource, /cooldownMs: INTERACTION_COOLDOWN_MS/);
  assert.match(routeSource, /SET animation_state=\$\{body\.animationState\},updated_at=now\(\)/);
  assert.match(routeSource, /INSERT INTO ugc_world_placement_interactions/);
  assert.match(routeSource, /\$\{previousState\},\$\{body\.animationState\},'authenticated-visitor'/);
});

// Tehkné Solutions
