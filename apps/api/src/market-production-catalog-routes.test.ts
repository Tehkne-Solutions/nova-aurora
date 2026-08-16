import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./business-operations-routes.ts", import.meta.url), "utf8");

test("market catalog is derived from persistent items instead of client constants", () => {
  assert.match(source, /app\.get\("\/v1\/market\/catalog"/);
  assert.match(source, /SELECT code,name,base_price_minor\s*FROM items/s);
  assert.match(source, /basePriceMinor: Number\(row\.base_price_minor\)/);
  assert.match(source, /signature: "Tehkné Solutions"/);
});

test("production catalog is derived from active recipe and input tables", () => {
  assert.match(source, /app\.get\("\/v1\/production\/recipes"/);
  assert.match(source, /FROM production_recipes recipe/);
  assert.match(source, /JOIN items item ON item\.id=recipe\.output_item_id/);
  assert.match(source, /WHERE recipe\.active=true/);
  assert.match(source, /FROM production_recipe_inputs input/);
  assert.match(source, /quantityMinor: Number\(input\.quantity_minor\)/);
});

test("production recipe response carries output, duration, energy and inputs", () => {
  for (const contract of [
    /outputItemCode: String\(recipe\.output_item_code\)/,
    /outputQuantityMinor: Number\(recipe\.output_quantity_minor\)/,
    /durationSeconds: Number\(recipe\.duration_seconds\)/,
    /energyCostMinor: Number\(recipe\.energy_cost_minor\)/,
    /inputs: inputs/
  ]) assert.match(source, contract);
});

test("catalog endpoints remain public discovery surfaces while marketplace state stays authenticated", () => {
  const marketCatalog = source.indexOf('app.get("/v1/market/catalog"');
  const recipeCatalog = source.indexOf('app.get("/v1/production/recipes"');
  const authenticatedState = source.indexOf('app.get("/v1/marketplace/state"');
  assert.ok(marketCatalog >= 0 && recipeCatalog > marketCatalog && authenticatedState > recipeCatalog);
  assert.doesNotMatch(source.slice(marketCatalog, recipeCatalog), /requireActorId/);
  assert.doesNotMatch(source.slice(recipeCatalog, authenticatedState), /requireActorId/);
  assert.match(source.slice(authenticatedState, authenticatedState + 240), /requireActorId\(app, request\)/);
});

// Tehkné Solutions
