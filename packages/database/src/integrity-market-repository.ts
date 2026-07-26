import { MarketRepository } from "./market-repository.js";
import {
  EconomyIntegrityService,
  evaluateMarketOrderIntegrity,
  recordTradeSurveillance
} from "./economy-integrity.js";
import { toItemMinor, type OrderSide } from "./economy-types.js";

export class IntegrityMarketRepository extends MarketRepository {
  private readonly integrity = new EconomyIntegrityService();

  override async createMarketOrder(input: {
    ownerId: string;
    side: OrderSide;
    itemCode: string;
    quantity: number;
    unitPriceMinor: number;
    idempotencyKey: string;
  }) {
    const items = await this.sql`SELECT id FROM items WHERE code=${input.itemCode}`;
    const item = items[0];
    if (!item) throw new Error("Item não encontrado.");
    const itemId = String(item.id);
    const quantityMinor = toItemMinor(input.quantity);
    const preflight = await this.integrity.preflightOrder({
      ownerId: input.ownerId,
      itemId,
      side: input.side,
      quantityMinor,
      unitPriceMinor: input.unitPriceMinor
    });
    if (!preflight.allowed) {
      await this.integrity.recordOrderDecision({
        ownerId: input.ownerId,
        itemId,
        decision: preflight,
        details: {
          itemCode: input.itemCode,
          side: input.side,
          quantityMinor,
          unitPriceMinor: input.unitPriceMinor
        }
      });
      throw new Error(preflight.reason ?? "Ordem recusada pelos controles de integridade.");
    }

    const result = await super.createMarketOrder(input);
    await this.integrity.recordOrderDecision({
      ownerId: input.ownerId,
      itemId,
      orderId: result.order.id,
      decision: preflight,
      details: {
        itemCode: input.itemCode,
        side: input.side,
        quantityMinor,
        unitPriceMinor: input.unitPriceMinor
      }
    });
    for (const trade of result.trades) {
      await this.sql.begin(async (tx) => recordTradeSurveillance(tx, {
        tradeId: trade.id,
        itemId,
        buyerId: trade.buyerId,
        sellerId: trade.sellerId,
        unitPriceMinor: trade.unitPriceMinor,
        grossMinor: trade.grossMinor
      }));
    }
    return result;
  }

  async atomicPreflight(input: {
    ownerId: string;
    itemId: string;
    side: OrderSide;
    quantityMinor: number;
    unitPriceMinor: number;
  }) {
    return this.sql.begin(async (tx) => evaluateMarketOrderIntegrity(tx, {
      ...input,
      lock: true
    }));
  }
}
