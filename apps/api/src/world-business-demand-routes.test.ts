import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const worldSource = readFileSync(new URL("./world-economy-routes.ts", import.meta.url), "utf8");
const propertyRoutesSource = readFileSync(new URL("./property-business-routes.ts", import.meta.url), "utf8");

test("world context derives active businesses from the player's current city location", () => {
  assert.match(worldSource, /async function localBusinesses\(locationCode: string\)/);
  assert.match(worldSource, /FROM property_buildings building/);
  assert.match(worldSource, /JOIN property_plots plot ON plot\.id=building\.plot_id/);
  assert.match(worldSource, /JOIN city_locations location ON location\.id=plot\.location_id/);
  assert.match(worldSource, /WHERE location\.code=\$\{locationCode\} AND building\.status='active'/);
  assert.match(worldSource, /localBusinesses: businesses/);
});

test("local business view exposes reputation physical visits demand customers revenue and catalog", () => {
  for (const contract of [
    /reputationScore: Number\(row\.reputation_score\)/,
    /recentWorldVisits: Number\(row\.recent_world_visits\)/,
    /recentDemandVisitors: Number\(row\.recent_demand_visitors\)/,
    /recentCustomers: Number\(row\.recent_customers\)/,
    /recentRevenueMinor: Number\(row\.recent_revenue_minor\)/,
    /catalog: catalogByBuilding\.get\(String\(row\.id\)\) \?\? \[\]/
  ]) assert.match(worldSource, contract);
});

test("world visit requires physical presence and delegates to property visit ledger-safe domain", () => {
  assert.match(worldSource, /\/v1\/world\/businesses\/:buildingId\/visit/);
  assert.match(worldSource, /await assertLocation\(app, ownerId, building\.locationCode\)/);
  assert.match(worldSource, /await propertyBusiness\.visitProperty\(/);
  assert.match(worldSource, /plotCode: building\.plotCode/);
  assert.match(worldSource, /O proprietário não registra visita na própria empresa/);
});

test("world demand cycle requires owner presence and delegates to existing demand engine", () => {
  assert.match(worldSource, /\/v1\/world\/businesses\/:buildingId\/demand-cycle/);
  assert.match(worldSource, /await assertLocation\(app, ownerId, building\.locationCode\)/);
  assert.match(worldSource, /building\.ownerId !== ownerId/);
  assert.match(worldSource, /await businessOperations\.runDemandCycle\(/);
  assert.match(worldSource, /candidate\.buildingId === building\.buildingId/);
});

test("global property visit also rejects owner self-traffic inflation", () => {
  assert.match(propertyRoutesSource, /const state = await business\.state\(ownerId\)/);
  assert.match(propertyRoutesSource, /plot\.ownerCompanyId === state\.company\.id/);
  assert.match(propertyRoutesSource, /O proprietário não registra visita na própria empresa/);
  assert.match(propertyRoutesSource, /return business\.visitProperty\(/);
});

test("world business integration keeps Tehkné Solutions signature", () => {
  assert.match(worldSource, /signature: "Tehkné Solutions"/);
  assert.match(worldSource, /\/\/ Tehkné Solutions/);
  assert.match(propertyRoutesSource, /\/\/ Tehkné Solutions/);
});

// Tehkné Solutions
