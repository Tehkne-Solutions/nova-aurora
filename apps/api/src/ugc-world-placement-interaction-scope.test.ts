import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const routeSource = readFileSync(new URL("./ugc-world-placement-routes.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(
  new URL("../../../packages/database/sql/051_ugc_world_placement_interaction_scope.sql", import.meta.url),
  "utf8"
);

test("migration 051 defaults every placement to owner_only and accepts only explicit authenticated opt-in", () => {
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS interaction_scope text NOT NULL DEFAULT 'owner_only'/);
  assert.match(migrationSource, /CHECK \(interaction_scope IN \('owner_only','authenticated'\)\)/);
  assert.match(migrationSource, /does not itself expose a visitor mutation endpoint/);
});

test("placement API persists and serializes interaction scope while keeping visitor mutation disabled", () => {
  assert.match(routeSource, /const INTERACTION_SCOPES = \["owner_only", "authenticated"\] as const/);
  assert.match(routeSource, /interactionScope: z\.enum\(INTERACTION_SCOPES\)\.default\("owner_only"\)/);
  assert.match(routeSource, /interactionScope: normalizeInteractionScope\(row\.interaction_scope\)/);
  assert.match(routeSource, /visitorMutationEnabled: false/);
  assert.doesNotMatch(routeSource, /\/visitor-interact/);
});

test("only the owner may change the declared interaction scope of an active clean GLB", () => {
  assert.match(routeSource, /\/v1\/ugc\/world\/placements\/:placementId\/interaction-scope/);
  assert.match(routeSource, /interactionScope: z\.enum\(INTERACTION_SCOPES\)/);
  assert.match(routeSource, /placement\.owner_user_id=\$\{actor\.userId\}::uuid/);
  assert.match(routeSource, /placement\.status='active'/);
  assert.match(routeSource, /asset\.status='clean'/);
  assert.match(routeSource, /asset\.content_type='model\/gltf-binary'/);
  assert.match(routeSource, /SET interaction_scope=\$\{body\.interactionScope\},updated_at=now\(\)/);
});

// Tehkné Solutions
