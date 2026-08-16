import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const consoleSource = readFileSync(new URL("./market-production-console.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("marketplace mounts the authenticated player market and production console", () => {
  assert.match(pageSource, /import \{ MarketProductionConsole \} from "\.\/market-production-console"/);
  assert.match(pageSource, /<MarketProductionConsole \/>/);
  assert.match(consoleSource, /aria-label="Console autenticada de mercado e produção de Nova Aurora"/);
  assert.match(consoleSource, /data-authenticated="true"/);
});

test("console discovers items and recipes from API catalogs", () => {
  assert.match(consoleSource, /request<\{ items: MarketItem\[\] \}>\("\/v1\/market\/catalog"\)/);
  assert.match(consoleSource, /request<\{ recipes: ProductionRecipe\[\] \}>\("\/v1\/production\/recipes"\)/);
  assert.doesNotMatch(consoleSource, /alice@nova-aurora\.local|bob@nova-aurora\.local|x-actor-email/);
  assert.doesNotMatch(consoleSource, /code: "water"|code: "wheat"|code: "flour"|code: "bread"/);
});

test("console uses authenticated private state and public market discovery", () => {
  assert.match(consoleSource, /request<EconomySnapshot>\("\/v1\/economy\/snapshot"\)/);
  assert.match(consoleSource, /request<readonly ProductionOrder\[\]>\("\/v1\/production\/orders"\)/);
  assert.match(consoleSource, /\/v1\/market\/order-book\/\$\{encodeURIComponent\(itemCode\)\}/);
  assert.match(consoleSource, /\/v1\/market\/trades\/\$\{encodeURIComponent\(itemCode\)\}\?limit=12/);
});

test("console creates and cancels real market orders with idempotency", () => {
  assert.match(consoleSource, /request\("\/v1\/market\/orders", \{/);
  assert.match(consoleSource, /side,\s*itemCode: selectedItemCode,\s*quantity: parsedQuantity,\s*unitPriceMinor: Math\.round\(parsedPrice \* 100\)/s);
  assert.match(consoleSource, /idempotencyKey: key\("market-order"\)/);
  assert.match(consoleSource, /request\(`\/v1\/market\/orders\/\$\{order\.id\}`/);
  assert.match(consoleSource, /idempotencyKey: key\("cancel-market"\)/);
});

test("console creates and cancels real production orders with bounded batches", () => {
  assert.match(consoleSource, /request\("\/v1\/production\/orders", \{/);
  assert.match(consoleSource, /recipeCode: selectedRecipeCode, batches: parsedBatches/);
  assert.match(consoleSource, /parsedBatches < 1 \|\| parsedBatches > 20/);
  assert.match(consoleSource, /idempotencyKey: key\("production-order"\)/);
  assert.match(consoleSource, /request\(`\/v1\/production\/orders\/\$\{order\.id\}`/);
  assert.match(consoleSource, /idempotencyKey: key\("cancel-production"\)/);
});

test("console keeps the Tehkné Solutions signature", () => {
  assert.match(consoleSource, /<footer className=\{styles\.signature\}>Tehkné Solutions<\/footer>/);
  assert.match(consoleSource, /\/\/ Tehkné Solutions/);
});

// Tehkné Solutions
