import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const marketplace = readFileSync(new URL("./marketplace/marketplace-game.tsx", import.meta.url), "utf8");
const business = readFileSync(new URL("./business/business-game.tsx", import.meta.url), "utf8");
const authProvider = readFileSync(new URL("./auth-provider.tsx", import.meta.url), "utf8");

for (const [surface, source] of [
  ["marketplace", marketplace],
  ["business", business]
] as const) {
  test(`${surface} no longer fabricates demo actors`, () => {
    assert.match(source, /import \{ useAuth \} from "\.\.\/auth-provider"/);
    assert.match(source, /const \{ identity \} = useAuth\(\)/);
    assert.doesNotMatch(source, /alice@nova-aurora\.local/);
    assert.doesNotMatch(source, /bob@nova-aurora\.local/);
    assert.doesNotMatch(source, /x-actor-email/);
    assert.doesNotMatch(source, /setActor\(/);
    assert.doesNotMatch(source, /ActorMode|ActorCode|ACTORS/);
  });
}

test("authenticated marketplace exposes session-bound state", () => {
  assert.match(marketplace, /aria-label="Mercado autenticado de Nova Aurora"/);
  assert.match(marketplace, /data-authenticated="true"/);
  assert.match(marketplace, /identity\?\.displayName \?\? state\.actor\.displayName/);
  assert.match(marketplace, /request<MarketplaceState>\("\/v1\/marketplace\/state"\)/);
});

test("authenticated business world exposes session-bound state", () => {
  assert.match(business, /aria-label="Economia empresarial autenticada de Nova Aurora"/);
  assert.match(business, /data-authenticated="true"/);
  assert.match(business, /identity\?\.displayName \?\? state\.actor\.displayName/);
  assert.match(business, /api<BusinessState>\("\/v1\/business\/state"\)/);
});

test("auth provider remains the single bearer injection boundary for economy fetches", () => {
  assert.match(authProvider, /headers\.set\("authorization", `Bearer \$\{token\}`\)/);
  assert.match(authProvider, /headers\.delete\("x-actor-email"\)/);
  assert.match(authProvider, /headers\.set\("x-actor-context", legacyActor\)/);
  assert.match(authProvider, /identity\.roles\.includes\("platform-admin"\)/);
});

// Tehkné Solutions
