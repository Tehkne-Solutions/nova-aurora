import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./world-placement-studio.tsx", import.meta.url), "utf8");

test("Creator Studio exposes owner_only by default and authenticated only as explicit opt-in", () => {
  assert.match(source, /const INTERACTION_SCOPES = \["owner_only", "authenticated"\] as const/);
  assert.match(source, /useState<InteractionScope>\("owner_only"\)/);
  assert.match(source, /interactionScope: selectedIsGlb \? interactionScope : "owner_only"/);
  assert.match(source, /id="ugc-world-interaction-scope"/);
  assert.match(source, /A ação de visitante permanece desligada/);
});

test("owner can update declared interaction scope without enabling visitor mutation in the UI contract", () => {
  assert.match(source, /async function updateInteractionScope\(placementId: string, nextScope: InteractionScope\)/);
  assert.match(source, /\/v1\/ugc\/world\/placements\/\$\{placementId\}\/interaction-scope/);
  assert.match(source, /visitorMutationEnabled: false/);
  assert.match(source, /Ação de visitante continua desabilitada até o gate próprio/);
  assert.match(source, /Quem poderá interagir/);
});

// Tehkné Solutions
