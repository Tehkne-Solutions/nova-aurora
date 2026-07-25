import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import {
  orderStatus,
  toItemMinor,
  tradeGrossMinor,
  tradeTaxMinor,
  type MarketOrderView,
  type MarketTradeView,
  type OrderSide
} from "./economy-types.js";

export class MarketRepository extends EconomyRepositoryBase {
  async createMarketOrder(input: {
    ownerId: string;
    side: OrderSide;
    itemCode: string;
    quantity: number;
    unitPriceMinor: number;
    idempotencyKey: string;
  }): Promise<Readonly<{ order: MarketOrderView; trades: readonly MarketTradeView[] }>> {
    const quantityMinor = toItemMinor(input.quantity);
    return this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const item = await this.itemByCode(tx, input.itemCode);
      const orderId = randomUUID();

      await tx`
        INSERT INTO market_orders (
          id, owner_id, side, item_id, quantity_minor, remaining_minor,
          filled_minor, unit_price_minor, status, idempotency_key
        ) VALUES (
          ${orderId}::uuid, ${input.ownerId}::uuid, ${input.side}, ${item.id}::uuid,
          ${quantityMinor}, ${quantityMinor}, 0, ${input.unitPriceMinor}, 'open',
          ${input.idempotencyKey}
        )
      `;

      if (input.side === "sell") {
        await this.reserveInventory(tx, {
          ownerId: input.ownerId,
          itemId: item.id,
          quantityMinor,
          marketOrderId: orderId,
          idempotencyKey: `${input.idempotencyKey}:inventory`
        });
      } else {
        const account = await this.walletAccount(tx, input.ownerId);
        await this.reserveBalance(tx, {
          accountId: account.id,
          ownerId: input.ownerId,
          quantityMinor: tradeGrossMinor(quantityMinor, input.unitPriceMinor),
          marketOrderId: orderId,
          idempotencyKey: `${input.idempotencyKey}:balance`
        });
      }

      await this.outbox(tx, orderId, "market.order.placed", {
        orderId,
        ownerId: input.ownerId,
        side: input.side,
        itemCode: input.itemCode,
        quantityMinor,
        unitPriceMinor: input.unitPriceMinor
      });

      const trades = await this.matchOrder(tx, orderId);
      return { order: await this.orderView(tx, orderId), trades };
    });
  }

  async cancelMarketOrder(input: {
    ownerId: string;
    orderId: string;
    idempotencyKey: string;
  }): Promise<MarketOrderView> {
    return this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const rows = await tx`SELECT * FROM market_orders WHERE id=${input.orderId}::uuid FOR UPDATE`;
      const order = rows[0];
      if (!order) throw new Error("Ordem não encontrada.");
      if (String(order.owner_id) !== input.ownerId) throw new Error("Ordem pertence a outro usuário.");
      if (!["open", "partial"].includes(String(order.status))) {
        throw new Error("A ordem não pode mais ser cancelada.");
      }

      await this.releaseReservations(tx, input.orderId, null);
      await tx`
        UPDATE market_orders
        SET status='cancelled',cancelled_at=now(),updated_at=now(),version=version+1
        WHERE id=${input.orderId}::uuid
      `;
      await this.outbox(tx, input.orderId, "market.order.cancelled", {
        orderId: input.orderId,
        ownerId: input.ownerId,
        remainingMinor: Number(order.remaining_minor)
      });
      return this.orderView(tx, input.orderId);
    });
  }

  async orderBook(itemCode: string): Promise<Readonly<{
    buys: readonly MarketOrderView[];
    sells: readonly MarketOrderView[];
  }>> {
    const rows = await this.sql`
      SELECT o.*,i.code item_code FROM market_orders o JOIN items i ON i.id=o.item_id
      WHERE i.code=${itemCode} AND o.status IN ('open','partial') AND o.remaining_minor>0
      ORDER BY
        CASE WHEN o.side='buy' THEN o.unit_price_minor END DESC,
        CASE WHEN o.side='sell' THEN o.unit_price_minor END ASC,
        o.created_at ASC,o.id ASC
    `;
    const views = rows.map((row) => this.mapOrder(row));
    return {
      buys: views.filter((order) => order.side === "buy"),
      sells: views.filter((order) => order.side === "sell")
    };
  }

  async recentTrades(itemCode: string, limit = 50): Promise<readonly MarketTradeView[]> {
    const rows = await this.sql`
      SELECT t.*,i.code item_code FROM market_trades t JOIN items i ON i.id=t.item_id
      WHERE i.code=${itemCode}
      ORDER BY t.created_at DESC LIMIT ${Math.min(Math.max(limit, 1), 200)}
    `;
    return rows.map((row) => this.mapTrade(row));
  }

  private async matchOrder(tx: Tx, orderId: string): Promise<readonly MarketTradeView[]> {
    const trades: MarketTradeView[] = [];
    while (true) {
      const currentRows = await tx`SELECT * FROM market_orders WHERE id=${orderId}::uuid FOR UPDATE`;
      const current = currentRows[0];
      if (!current || Number(current.remaining_minor) === 0) break;

      const counterpartRows = String(current.side) === "buy"
        ? await tx`
            SELECT * FROM market_orders
            WHERE item_id=${String(current.item_id)}::uuid
              AND side='sell' AND owner_id<>${String(current.owner_id)}::uuid
              AND status IN ('open','partial') AND remaining_minor>0
              AND unit_price_minor<=${Number(current.unit_price_minor)}
            ORDER BY unit_price_minor ASC,created_at ASC,id ASC
            LIMIT 1 FOR UPDATE SKIP LOCKED
          `
        : await tx`
            SELECT * FROM market_orders
            WHERE item_id=${String(current.item_id)}::uuid
              AND side='buy' AND owner_id<>${String(current.owner_id)}::uuid
              AND status IN ('open','partial') AND remaining_minor>0
              AND unit_price_minor>=${Number(current.unit_price_minor)}
            ORDER BY unit_price_minor DESC,created_at ASC,id ASC
            LIMIT 1 FOR UPDATE SKIP LOCKED
          `;
      const counterpart = counterpartRows[0];
      if (!counterpart) break;

      const buy = String(current.side) === "buy" ? current : counterpart;
      const sell = String(current.side) === "sell" ? current : counterpart;
      const quantityMinor = Math.min(Number(buy.remaining_minor), Number(sell.remaining_minor));
      trades.push(await this.settleTrade(
        tx,
        buy,
        sell,
        quantityMinor,
        Number(counterpart.unit_price_minor)
      ));
    }
    return trades;
  }

  private async settleTrade(
    tx: Tx,
    buy: Record<string, unknown>,
    sell: Record<string, unknown>,
    quantityMinor: number,
    unitPriceMinor: number
  ): Promise<MarketTradeView> {
    const grossMinor = tradeGrossMinor(quantityMinor, unitPriceMinor);
    const taxMinor = tradeTaxMinor(grossMinor);
    const sellerNetMinor = grossMinor - taxMinor;
    const buyerId = String(buy.owner_id);
    const sellerId = String(sell.owner_id);

    const balanceReservations = await tx`
      SELECT * FROM reservations
      WHERE market_order_id=${String(buy.id)}::uuid AND resource_type='balance' AND status='active'
      FOR UPDATE
    `;
    const balanceReservation = balanceReservations[0];
    if (!balanceReservation || Number(balanceReservation.remaining_minor) < grossMinor) {
      throw new Error("Reserva financeira insuficiente.");
    }
    await tx`
      UPDATE reservations SET remaining_minor=remaining_minor-${grossMinor},updated_at=now()
      WHERE id=${String(balanceReservation.id)}::uuid
    `;

    const buyerAccount = await this.walletAccount(tx, buyerId);
    const sellerAccount = await this.walletAccount(tx, sellerId);
    const cityAccountId = await this.cityAccountId(tx);
    const ledgerTransactionId = await this.postLedger(tx, {
      key: `trade:${buy.id}:${sell.id}:${buy.filled_minor}:${sell.filled_minor}`,
      type: "market-settlement",
      entries: [
        { accountId: buyerAccount.id, amount: -grossMinor, memo: "Compra no mercado" },
        { accountId: sellerAccount.id, amount: sellerNetMinor, memo: "Venda no mercado" },
        { accountId: cityAccountId, amount: taxMinor, memo: "Taxa municipal de mercado" }
      ]
    });

    await this.captureSellerInventory(tx, String(sell.id), buyerId, String(sell.item_id), quantityMinor);

    const buyRemaining = Number(buy.remaining_minor) - quantityMinor;
    const sellRemaining = Number(sell.remaining_minor) - quantityMinor;
    await this.updateOrderAfterFill(tx, String(buy.id), Number(buy.quantity_minor), buyRemaining, quantityMinor);
    await this.updateOrderAfterFill(tx, String(sell.id), Number(sell.quantity_minor), sellRemaining, quantityMinor);

    if (buyRemaining === 0) {
      await tx`
        UPDATE reservations SET remaining_minor=0,status='released',updated_at=now()
        WHERE market_order_id=${String(buy.id)}::uuid AND resource_type='balance' AND status='active'
      `;
    } else {
      const required = tradeGrossMinor(buyRemaining, Number(buy.unit_price_minor));
      await tx`
        UPDATE reservations SET remaining_minor=LEAST(remaining_minor,${required}),updated_at=now()
        WHERE market_order_id=${String(buy.id)}::uuid AND resource_type='balance' AND status='active'
      `;
    }

    const tradeId = randomUUID();
    await tx`
      INSERT INTO market_trades (
        id,buy_order_id,sell_order_id,item_id,buyer_id,seller_id,
        quantity_minor,unit_price_minor,gross_minor,tax_minor,seller_net_minor,
        ledger_transaction_id
      ) VALUES (
        ${tradeId}::uuid,${String(buy.id)}::uuid,${String(sell.id)}::uuid,
        ${String(sell.item_id)}::uuid,${buyerId}::uuid,${sellerId}::uuid,
        ${quantityMinor},${unitPriceMinor},${grossMinor},${taxMinor},${sellerNetMinor},
        ${ledgerTransactionId}::uuid
      )
    `;
    await tx`
      INSERT INTO market_price_history (item_id,trade_id,unit_price_minor,quantity_minor)
      VALUES (${String(sell.item_id)}::uuid,${tradeId}::uuid,${unitPriceMinor},${quantityMinor})
    `;
    await this.outbox(tx, tradeId, "market.trade.settled", {
      tradeId,
      buyOrderId: String(buy.id),
      sellOrderId: String(sell.id),
      buyerId,
      sellerId,
      quantityMinor,
      unitPriceMinor,
      grossMinor,
      taxMinor,
      sellerNetMinor
    });

    const itemRows = await tx`SELECT code FROM items WHERE id=${String(sell.item_id)}::uuid`;
    return {
      id: tradeId,
      buyOrderId: String(buy.id),
      sellOrderId: String(sell.id),
      itemCode: String(itemRows[0]?.code ?? "unknown"),
      buyerId,
      sellerId,
      quantityMinor,
      unitPriceMinor,
      grossMinor,
      taxMinor,
      sellerNetMinor,
      createdAt: new Date().toISOString()
    };
  }

  private async captureSellerInventory(
    tx: Tx,
    sellOrderId: string,
    buyerId: string,
    itemId: string,
    quantityMinor: number
  ): Promise<void> {
    let remaining = quantityMinor;
    const reservations = await tx`
      SELECT * FROM reservations
      WHERE market_order_id=${sellOrderId}::uuid AND resource_type='inventory' AND status='active'
      ORDER BY created_at FOR UPDATE
    `;
    for (const reservation of reservations) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(reservation.remaining_minor));
      const lots = await tx`
        UPDATE inventory_lots
        SET quantity_minor=quantity_minor-${take},reserved_minor=reserved_minor-${take}
        WHERE id=${String(reservation.resource_id)}::uuid
          AND quantity_minor>=${take} AND reserved_minor>=${take}
        RETURNING quality
      `;
      if (!lots[0]) throw new Error("Reserva de estoque inconsistente.");
      const left = Number(reservation.remaining_minor) - take;
      await tx`
        UPDATE reservations SET remaining_minor=${left},status=${left === 0 ? "captured" : "active"},updated_at=now()
        WHERE id=${String(reservation.id)}::uuid
      `;
      await this.addInventory(tx, buyerId, itemId, take, Number(lots[0].quality));
      remaining -= take;
    }
    if (remaining !== 0) throw new Error("Estoque reservado insuficiente para liquidação.");
  }

  private async updateOrderAfterFill(
    tx: Tx,
    orderId: string,
    quantityMinor: number,
    remainingMinor: number,
    filledNow: number
  ): Promise<void> {
    const status = orderStatus(remainingMinor, quantityMinor);
    await tx`
      UPDATE market_orders
      SET remaining_minor=${remainingMinor},filled_minor=filled_minor+${filledNow},status=${status},
          completed_at=CASE WHEN ${status}='filled' THEN now() ELSE completed_at END,
          updated_at=now(),version=version+1
      WHERE id=${orderId}::uuid
    `;
  }

  private async itemByCode(tx: Tx, itemCode: string): Promise<Readonly<{ id: string; code: string }>> {
    const rows = await tx`SELECT id,code FROM items WHERE code=${itemCode}`;
    if (!rows[0]) throw new Error("Item não encontrado.");
    return { id: String(rows[0].id), code: String(rows[0].code) };
  }

  private async orderView(tx: Tx, orderId: string): Promise<MarketOrderView> {
    const rows = await tx`
      SELECT o.*,i.code item_code FROM market_orders o JOIN items i ON i.id=o.item_id
      WHERE o.id=${orderId}::uuid
    `;
    if (!rows[0]) throw new Error("Ordem não encontrada.");
    return this.mapOrder(rows[0]);
  }

  private mapOrder(row: Record<string, unknown>): MarketOrderView {
    return {
      id: String(row.id),
      ownerId: String(row.owner_id),
      side: row.side as OrderSide,
      itemCode: String(row.item_code),
      quantityMinor: Number(row.quantity_minor),
      remainingMinor: Number(row.remaining_minor),
      filledMinor: Number(row.filled_minor),
      unitPriceMinor: Number(row.unit_price_minor),
      status: row.status as MarketOrderView["status"],
      createdAt: new Date(String(row.created_at)).toISOString()
    };
  }

  private mapTrade(row: Record<string, unknown>): MarketTradeView {
    return {
      id: String(row.id),
      buyOrderId: String(row.buy_order_id),
      sellOrderId: String(row.sell_order_id),
      itemCode: String(row.item_code),
      buyerId: String(row.buyer_id),
      sellerId: String(row.seller_id),
      quantityMinor: Number(row.quantity_minor),
      unitPriceMinor: Number(row.unit_price_minor),
      grossMinor: Number(row.gross_minor),
      taxMinor: Number(row.tax_minor),
      sellerNetMinor: Number(row.seller_net_minor),
      createdAt: new Date(String(row.created_at)).toISOString()
    };
  }
}
