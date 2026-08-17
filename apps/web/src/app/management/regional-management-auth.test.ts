import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./regional-management-game.tsx", import.meta.url), "utf8");

test("regional management no longer fabricates Alice Bob or actor email headers", () => {
  assert.doesNotMatch(source, /alice@nova-aurora\.local|bob@nova-aurora\.local|x-actor-email/);
  assert.doesNotMatch(source, /ActorMode|setMode|actorEmail/);
});

test("regional management is an authenticated product surface", () => {
  assert.match(source, /aria-label="Gestão regional autenticada de Nova Aurora"/);
  assert.match(source, /data-authenticated="true"/);
  assert.match(source, /Operador autenticado/);
  assert.match(source, /state\.actor\.displayName/);
});

test("regional campaign UI exposes all existing media channels", () => {
  for (const channel of ["local", "social", "outdoor", "influencer"]) {
    assert.match(source, new RegExp(`<option value="${channel}">`));
  }
  assert.match(source, /channel: campaignChannel/);
  assert.match(source, /visitorBoostPct: 30/);
  assert.match(source, /durationDays: 7/);
});

test("regional management keeps B2B goals team cycles alerts and Tehkné Solutions signature", () => {
  assert.match(source, /\/v1\/management\/supplier-offers/);
  assert.match(source, /\/v1\/management\/goals/);
  assert.match(source, /\/v1\/management\/regional-cycles/);
  assert.match(source, /\/v1\/management\/alerts\/\$\{alert\.id\}\/acknowledge/);
  assert.match(source, /<footer>Tehkné Solutions<\/footer>/);
});

// Tehkné Solutions
