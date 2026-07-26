import { IntegrityMarketRepository } from "./integrity-market-repository.js";
import { ProductionRepository } from "./production-repository.js";
import type { OrderSide } from "./economy-types.js";

export class MarketProductionService {
  private readonly market = new IntegrityMarketRepository();
  private readonly production = new ProductionRepository();

  resolveUserId(email: string) {
    return this.market.resolveUserId(email);
  }

  createMarketOrder(input: {
    ownerId: string;
    side: OrderSide;
    itemCode: string;
    quantity: number;
    unitPriceMinor: number;
    idempotencyKey: string;
  }) {
    return this.market.createMarketOrder(input);
  }

  cancelMarketOrder(input: { ownerId: string; orderId: string; idempotencyKey: string }) {
    return this.market.cancelMarketOrder(input);
  }

  orderBook(itemCode: string) {
    return this.market.orderBook(itemCode);
  }

  recentTrades(itemCode: string, limit?: number) {
    return this.market.recentTrades(itemCode, limit);
  }

  startProduction(input: {
    ownerId: string;
    recipeCode: string;
    batches: number;
    idempotencyKey: string;
  }) {
    return this.production.startProduction(input);
  }

  completeProduction(orderId: string, force?: boolean) {
    return this.production.completeProduction(orderId, force);
  }

  cancelProduction(input: { ownerId: string; orderId: string; idempotencyKey: string }) {
    return this.production.cancelProduction(input);
  }

  dueProductionIds(limit?: number) {
    return this.production.dueProductionIds(limit);
  }

  productionOrders(ownerId: string) {
    return this.production.productionOrders(ownerId);
  }

  dispatchOutbox(
    publisher: (event: Readonly<{ eventType: string; payload: unknown }>) => Promise<void>,
    limit?: number
  ) {
    return this.market.dispatchOutbox(publisher, limit);
  }
}
