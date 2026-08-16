import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const worldSource = readFileSync(new URL("./city-world.tsx", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("./ugc-world.module.css", import.meta.url), "utf8");
const authSource = readFileSync(new URL("../auth-provider.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../../../api/src/ugc-world-placement-routes.ts", import.meta.url), "utf8");

test("AuthProvider supplies Bearer to protected game API requests and strips legacy actor header", () => {
  assert.match(authSource, /"\/game"/);
  assert.match(authSource, /headers\.delete\("x-actor-email"\)/);
  assert.match(authSource, /headers\.set\("authorization",`Bearer \$\{activeToken\}`\)/);
});

test("placement API distinguishes anonymous closed from authenticated opt-in capability", () => {
  assert.match(apiSource, /anonymousVisitorMutationEnabled: false/);
  assert.match(apiSource, /authenticatedVisitorMutationEnabled: true/);
  assert.match(apiSource, /authenticatedEndpoint: "\/v1\/ugc\/world\/placements\/:placementId\/interactions"/);
  assert.match(apiSource, /cooldownMs: 2000/);
  assert.match(apiSource, /visitorMutationEnabled: false/);
});

test("map exposes interaction only for authenticated GLB at current player location", () => {
  assert.match(worldSource, /interactionScope\?: "owner_only" \| "authenticated"/);
  assert.match(worldSource, /const interactive = current && isGlb && placement\.interactionScope === "authenticated"/);
  assert.match(worldSource, /data-interaction-scope=\{placement\.interactionScope \?\? "owner_only"\}/);
  assert.match(worldSource, /const verb = interactionVerb\(placement\.animationState \?\? "idle"\)/);
  assert.match(worldSource, /aria-label=\{interactionLabel\}/);
  assert.match(worldSource, /className=\{styles\.ugcInteractionButton\}/);
  assert.match(worldSource, /coolingDown \? `Aguarde \$\{cooldownRemainingSeconds\}s` : verb/);
});

test("player interaction posts canonical next state and immediately updates rendered state", () => {
  assert.match(worldSource, /function nextInteractiveState\(current: AnimationState\): AnimationState/);
  assert.match(worldSource, /if \(current === "open"\) return "close"/);
  assert.match(worldSource, /if \(current === "close"\) return "open"/);
  assert.match(worldSource, /if \(current === "activate"\) return "deactivate"/);
  assert.match(worldSource, /if \(current === "deactivate"\) return "activate"/);
  assert.match(worldSource, /\/v1\/ugc\/world\/placements\/\$\{placement\.id\}\/interactions/);
  assert.match(worldSource, /body: JSON\.stringify\(\{ animationState: next \}\)/);
  assert.match(worldSource, /const returnedState = payload\.animationState/);
  assert.match(worldSource, /\{ \.\.\.item, animationState: returnedState \}/);
});

test("client consumes server-authoritative cooldown without globally blocking other placements", () => {
  assert.match(worldSource, /cooldownUntilByPlacement/);
  assert.match(worldSource, /normalizeServerCooldownMs\(payload\.cooldownMs\)/);
  assert.match(worldSource, /normalizeServerCooldownMs\(payload\.retryAfterMs\) \?\? retryAfterHeaderMs\(response\)/);
  assert.match(worldSource, /response\.headers\.get\("retry-after"\)/);
  assert.match(worldSource, /applyServerCooldown\(placement\.id, retryMs\)/);
  assert.match(worldSource, /applyServerCooldown\(placement\.id, normalizeServerCooldownMs\(payload\.cooldownMs\)\)/);
  assert.match(worldSource, /existingCooldownUntil > Date\.now\(\)/);
  assert.match(worldSource, /disabled=\{busy \|\| interactionBusyId !== null \|\| coolingDown\}/);
  assert.doesNotMatch(worldSource, /const \[globalCooldown/);
});

test("cooldown countdown is bounded, accessible and releases expired placement timers", () => {
  assert.match(worldSource, /UGC_COOLDOWN_MAX_CLIENT_MS = 60_000/);
  assert.match(worldSource, /Math\.min\(UGC_COOLDOWN_MAX_CLIENT_MS, Math\.ceil\(value\)\)/);
  assert.match(worldSource, /UGC_COOLDOWN_TICK_MS = 250/);
  assert.match(worldSource, /Object\.entries\(current\)\.filter\(\(\[, until\]\) => until > now\)/);
  assert.match(worldSource, /return \(\) => window\.clearInterval\(timer\)/);
  assert.match(worldSource, /Aguarde \$\{cooldownRemainingSeconds\}s para/);
  assert.match(worldSource, /aria-live="polite" className=\{styles\.ugcInteractionStatus\}/);
});

test("interactive UGC enables pointer action while retaining visible status and keyboard focus", () => {
  assert.match(styleSource, /\.ugcWorldInteractive\{pointer-events:auto\}/);
  assert.match(styleSource, /\.ugcInteractionButton:focus-visible/);
  assert.match(worldSource, /aria-live="polite" className=\{styles\.ugcInteractionStatus\}/);
});

// Tehkné Solutions
