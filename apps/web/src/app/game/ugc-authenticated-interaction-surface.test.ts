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
  assert.match(worldSource, /aria-label=\{`\$\{verb\} \$\{placement\.label\}`\}/);
  assert.match(worldSource, /className=\{styles\.ugcInteractionButton\}/);
  assert.match(worldSource, />\{interactionBusyId === placement\.id \? `\$\{verb\}…` : verb\}<\/button>/);
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

test("interactive UGC enables pointer action while retaining visible status and keyboard focus", () => {
  assert.match(styleSource, /\.ugcWorldInteractive\{pointer-events:auto\}/);
  assert.match(styleSource, /\.ugcInteractionButton:focus-visible/);
  assert.match(worldSource, /aria-live="polite" className=\{styles\.ugcInteractionStatus\}/);
});

// Tehkné Solutions
