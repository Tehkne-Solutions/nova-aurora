import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./world-economy-routes.ts", import.meta.url), "utf8");

test("world business context derives active non-expired campaigns for the exact location", () => {
  assert.match(source, /FROM marketing_campaigns campaign/);
  assert.match(source, /JOIN property_buildings building ON building\.id=campaign\.building_id/);
  assert.match(source, /JOIN property_plots plot ON plot\.id=building\.plot_id/);
  assert.match(source, /JOIN city_locations location ON location\.id=plot\.location_id/);
  assert.match(source, /WHERE location\.code=\$\{locationCode\}/);
  assert.match(source, /campaign\.status='active'/);
  assert.match(source, /campaign\.starts_at<=now\(\)/);
  assert.match(source, /campaign\.ends_at>now\(\)/);
});

test("campaign projection exposes attribution and world placement without inventing another engine", () => {
  assert.match(source, /budgetMinor: Number\(row\.budget_minor\)/);
  assert.match(source, /visitorBoostPct: Number\(row\.visitor_boost_pct\)/);
  assert.match(source, /conversions: Number\(row\.conversions\)/);
  assert.match(source, /attributedRevenueMinor: Number\(row\.attributed_revenue_minor\)/);
  assert.match(source, /worldPlacement: channel === "local" \|\| channel === "outdoor"/);
  assert.match(source, /activeCampaigns: campaignsByBuilding\.get\(String\(row\.id\)\) \?\? \[\]/);
});

test("world campaign context keeps Tehkné Solutions signature", () => {
  assert.match(source, /signature: "Tehkné Solutions"/);
  assert.match(source, /\/\/ Tehkné Solutions/);
});

// Tehkné Solutions
