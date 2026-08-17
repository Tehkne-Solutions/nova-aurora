import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./world-economy-routes.ts", import.meta.url), "utf8");
const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

test("world economy maps the onboarding production chain to the agricultural cooperative", () => {
  assert.match(source, /\["flour", "green-cooperative"\]/);
  assert.match(source, /\["bread", "green-cooperative"\]/);
  assert.match(source, /const WORLD_MARKET_LOCATION = "municipal-market"/);
});

test("world economy context is authenticated and derived from persisted player location", () => {
  assert.match(source, /app\.get\("\/v1\/world\/economy\/context"/);
  assert.match(source, /const ownerId = await requireActorId\(app, request\)/);
  assert.match(source, /FROM player_world_state state/);
  assert.match(source, /JOIN city_locations location ON location\.id=state\.location_id/);
  assert.match(source, /JOIN city_districts district ON district\.id=state\.district_id/);
});

test("world production requires a mapped physical location and reuses the production core", () => {
  assert.match(source, /app\.post\("\/v1\/world\/production\/orders"/);
  assert.match(source, /const requiredLocationCode = WORLD_RECIPE_LOCATIONS\.get\(body\.recipeCode\)/);
  assert.match(source, /await assertLocation\(app, ownerId, requiredLocationCode\)/);
  assert.match(source, /await economy\.startProduction\(/);
  assert.match(source, /await enqueueProductionCompletion\(/);
});

test("world market requires the municipal market and reuses real matching", () => {
  assert.match(source, /app\.post\("\/v1\/world\/market\/orders"/);
  assert.match(source, /await assertLocation\(app, ownerId, WORLD_MARKET_LOCATION\)/);
  assert.match(source, /await economy\.createMarketOrder\(/);
  assert.doesNotMatch(source, /alice@nova-aurora\.local|bob@nova-aurora\.local|x-actor-email/);
});

test("server registers location-aware world economy without removing global market endpoints", () => {
  assert.match(serverSource, /import \{ registerWorldEconomyRoutes \} from "\.\/world-economy-routes\.js"/);
  assert.match(serverSource, /await registerWorldEconomyRoutes\(app\)/);
  assert.match(serverSource, /worldEconomy: "location-aware"/);
  assert.match(serverSource, /app\.post\("\/v1\/market\/orders"/);
  assert.match(serverSource, /app\.post\("\/v1\/production\/orders"/);
});

test("world economy responses carry Tehkné Solutions signature", () => {
  assert.match(source, /signature: "Tehkné Solutions"/);
  assert.match(source, /\/\/ Tehkné Solutions/);
});

// Tehkné Solutions
