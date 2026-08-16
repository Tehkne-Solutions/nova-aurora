import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const marketplaceRoutes = readFileSync(new URL("./business-operations-routes.ts", import.meta.url), "utf8");
const propertyRoutes = readFileSync(new URL("./property-business-routes.ts", import.meta.url), "utf8");

for (const [surface, source] of [
  ["marketplace", marketplaceRoutes],
  ["property-business", propertyRoutes]
] as const) {
  test(`${surface} resolves actor from authenticated session`, () => {
    assert.match(source, /import \{ requireActorId \} from "\.\/auth-context\.js"/);
    assert.match(source, /await requireActorId\(app, request\)/);
    assert.doesNotMatch(source, /x-actor-email/);
    assert.doesNotMatch(source, /resolveUserId\(/);
    assert.doesNotMatch(source, /Cabeçalho x-actor-email/);
  });
}

test("every marketplace mutation uses the authenticated actor boundary", () => {
  const mutations = [
    "configureCatalog",
    "runDemandCycle",
    "createJobOpening",
    "acceptJob",
    "runPayroll",
    "createShareListing",
    "buyShareListing"
  ];
  for (const mutation of mutations) {
    const index = marketplaceRoutes.indexOf(`operations.${mutation}(`);
    assert.ok(index >= 0, `${mutation} route missing`);
    assert.match(marketplaceRoutes.slice(index, index + 520), /ownerId: await requireActorId\(app, request\)/);
  }
});

test("every property and business mutation uses the authenticated actor boundary", () => {
  const mutations = [
    "acquirePlot",
    "constructBuilding",
    "visitProperty",
    "runOperatingCycle",
    "upgradeBuilding",
    "createShareOffering",
    "invest",
    "distributeResults"
  ];
  for (const mutation of mutations) {
    const index = propertyRoutes.indexOf(`business.${mutation}(`);
    assert.ok(index >= 0, `${mutation} route missing`);
    assert.match(propertyRoutes.slice(index, index + 520), /ownerId: await requireActorId\(app, request\)/);
  }
});

// Tehkné Solutions
