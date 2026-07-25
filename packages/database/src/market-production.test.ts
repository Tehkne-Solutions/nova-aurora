import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  closeDb,
  MarketProductionService,
  tradeGrossMinor,
  tradeTaxMinor
} from "./index.js";

test("calcula liquidação em centavos de Crédito Aurora", () => {
  assert.equal(tradeGrossMinor(200, 2_200), 4_400);
  assert.equal(tradeTaxMinor(4_400), 88);
});

test("matching usa preço da ordem em repouso e permite preenchimento parcial", async () => {
  const service = new MarketProductionService();
  const aliceId = await service.resolveUserId("alice@nova-aurora.local");
  const bobId = await service.resolveUserId("bob@nova-aurora.local");
  const run = crypto.randomUUID();

  const sell = await service.createMarketOrder({
    ownerId: aliceId,
    side: "sell",
    itemCode: "bread",
    quantity: 6,
    unitPriceMinor: 2_200,
    idempotencyKey: `test:${run}:sell`
  });
  assert.equal(sell.order.status, "open");

  const buy = await service.createMarketOrder({
    ownerId: bobId,
    side: "buy",
    itemCode: "bread",
    quantity: 2,
    unitPriceMinor: 2_300,
    idempotencyKey: `test:${run}:buy`
  });

  assert.equal(buy.order.status, "filled");
  assert.equal(buy.trades.length, 1);
  assert.equal(buy.trades[0]?.unitPriceMinor, 2_200);
  assert.equal(buy.trades[0]?.quantityMinor, 200);

  const book = await service.orderBook("bread");
  const remaining = book.sells.find((order) => order.id === sell.order.id);
  assert.equal(remaining?.status, "partial");
  assert.equal(remaining?.remainingMinor, 400);

  const cancelled = await service.cancelMarketOrder({
    ownerId: aliceId,
    orderId: sell.order.id,
    idempotencyKey: `test:${run}:cancel`
  });
  assert.equal(cancelled.status, "cancelled");
});

test("produção temporizada reserva insumos e conclui de forma idempotente", async () => {
  const service = new MarketProductionService();
  const aliceId = await service.resolveUserId("alice@nova-aurora.local");
  const run = crypto.randomUUID();
  const order = await service.startProduction({
    ownerId: aliceId,
    recipeCode: "flour",
    batches: 1,
    idempotencyKey: `test:${run}:production`
  });
  assert.equal(order.status, "queued");

  const completed = await service.completeProduction(order.id, true);
  assert.equal(completed.status, "completed");
  const repeated = await service.completeProduction(order.id, true);
  assert.equal(repeated.status, "completed");
});

after(async () => closeDb());
