import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";
import type { ProductionOrderView } from "./economy-types.js";

export class ProductionRepository extends EconomyRepositoryBase {
  async startProduction(input: {
    ownerId: string;
    recipeCode: string;
    batches: number;
    idempotencyKey: string;
  }): Promise<ProductionOrderView> {
    if (!Number.isInteger(input.batches) || input.batches <= 0 || input.batches > 20) {
      throw new Error("Quantidade de lotes inválida.");
    }

    return this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const recipes = await tx`
        SELECT * FROM production_recipes WHERE code=${input.recipeCode} AND active=true
      `;
      const recipe = recipes[0];
      if (!recipe) throw new Error("Receita não encontrada.");

      const orderId = randomUUID();
      const completesAt = new Date(
        Date.now() + Number(recipe.duration_seconds) * input.batches * 1000
      );
      await tx`
        INSERT INTO production_orders (
          id,owner_id,company_id,recipe_id,batches,status,idempotency_key,
          seed,starts_at,completes_at
        ) VALUES (
          ${orderId}::uuid,${input.ownerId}::uuid,
          (SELECT id FROM companies WHERE owner_id=${input.ownerId}::uuid ORDER BY created_at LIMIT 1),
          ${String(recipe.id)}::uuid,${input.batches},'queued',${input.idempotencyKey},
          ${Date.now()},now(),${completesAt}
        )
      `;

      const inputs = await tx`
        SELECT item_id,quantity_minor FROM production_recipe_inputs
        WHERE recipe_id=${String(recipe.id)}::uuid
      `;
      for (let index = 0; index < inputs.length; index += 1) {
        const row = inputs[index];
        if (!row) continue;
        await this.reserveInventory(tx, {
          ownerId: input.ownerId,
          itemId: String(row.item_id),
          quantityMinor: Number(row.quantity_minor) * input.batches,
          productionOrderId: orderId,
          idempotencyKey: `${input.idempotencyKey}:input:${index}`
        });
      }

      const energyMinor = Number(recipe.energy_cost_minor) * input.batches;
      if (energyMinor > 0) {
        const account = await this.walletAccount(tx, input.ownerId);
        await this.reserveBalance(tx, {
          accountId: account.id,
          ownerId: input.ownerId,
          quantityMinor: energyMinor,
          productionOrderId: orderId,
          idempotencyKey: `${input.idempotencyKey}:energy`
        });
      }

      await this.outbox(tx, orderId, "production.order.queued", {
        orderId,
        ownerId: input.ownerId,
        recipeCode: input.recipeCode,
        batches: input.batches,
        completesAt: completesAt.toISOString()
      });
      return this.productionView(tx, orderId);
    });
  }

  async completeProduction(orderId: string, force = false): Promise<ProductionOrderView> {
    return this.sql.begin("isolation level serializable", async (tx) => {
      const rows = await tx`
        SELECT o.*,r.code recipe_code,r.output_item_id,r.output_quantity_minor
        FROM production_orders o JOIN production_recipes r ON r.id=o.recipe_id
        WHERE o.id=${orderId}::uuid FOR UPDATE
      `;
      const order = rows[0];
      if (!order) throw new Error("Ordem de produção não encontrada.");
      if (String(order.status) === "completed") return this.productionView(tx, orderId);
      if (String(order.status) !== "queued") throw new Error("Ordem de produção não está na fila.");
      if (!force && new Date(String(order.completes_at)).getTime() > Date.now()) {
        return this.productionView(tx, orderId);
      }

      await tx`UPDATE production_orders SET status='processing',updated_at=now() WHERE id=${orderId}::uuid`;
      const reservations = await tx`
        SELECT * FROM reservations
        WHERE production_order_id=${orderId}::uuid AND status='active'
        ORDER BY created_at FOR UPDATE
      `;

      for (const reservation of reservations) {
        if (String(reservation.resource_type) !== "inventory") continue;
        const quantity = Number(reservation.remaining_minor);
        const updated = await tx`
          UPDATE inventory_lots
          SET quantity_minor=quantity_minor-${quantity},reserved_minor=reserved_minor-${quantity}
          WHERE id=${String(reservation.resource_id)}::uuid
            AND quantity_minor>=${quantity} AND reserved_minor>=${quantity}
          RETURNING id
        `;
        if (!updated[0]) throw new Error("Reserva de insumo inconsistente.");
      }

      const balanceReservation = reservations.find(
        (reservation) => String(reservation.resource_type) === "balance"
      );
      if (balanceReservation) {
        const energyMinor = Number(balanceReservation.remaining_minor);
        await tx`
          UPDATE reservations SET remaining_minor=0,status='captured',updated_at=now()
          WHERE id=${String(balanceReservation.id)}::uuid
        `;
        const cityAccountId = await this.cityAccountId(tx);
        await this.postLedger(tx, {
          key: `production:${orderId}:energy`,
          type: "production-energy",
          entries: [
            {
              accountId: String(balanceReservation.resource_id),
              amount: -energyMinor,
              memo: "Energia de produção"
            },
            { accountId: cityAccountId, amount: energyMinor, memo: "Energia de produção" }
          ]
        });
      }

      await tx`
        UPDATE reservations SET remaining_minor=0,status='captured',updated_at=now()
        WHERE production_order_id=${orderId}::uuid AND status='active'
      `;

      const outputMinor = Number(order.output_quantity_minor) * Number(order.batches);
      await this.addInventory(
        tx,
        String(order.owner_id),
        String(order.output_item_id),
        outputMinor,
        65
      );
      await tx`
        UPDATE production_orders
        SET status='completed',completed_at=now(),updated_at=now()
        WHERE id=${orderId}::uuid
      `;
      await this.outbox(tx, orderId, "production.order.completed", {
        orderId,
        ownerId: String(order.owner_id),
        recipeCode: String(order.recipe_code),
        outputQuantityMinor: outputMinor
      });
      return this.productionView(tx, orderId);
    });
  }

  async cancelProduction(input: {
    ownerId: string;
    orderId: string;
    idempotencyKey: string;
  }): Promise<ProductionOrderView> {
    return this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const rows = await tx`SELECT * FROM production_orders WHERE id=${input.orderId}::uuid FOR UPDATE`;
      const order = rows[0];
      if (!order) throw new Error("Ordem de produção não encontrada.");
      if (String(order.owner_id) !== input.ownerId) throw new Error("Ordem pertence a outro usuário.");
      if (String(order.status) !== "queued") throw new Error("Produção não pode mais ser cancelada.");

      await this.releaseReservations(tx, null, input.orderId);
      await tx`
        UPDATE production_orders SET status='cancelled',cancelled_at=now(),updated_at=now()
        WHERE id=${input.orderId}::uuid
      `;
      await this.outbox(tx, input.orderId, "production.order.cancelled", {
        orderId: input.orderId,
        ownerId: input.ownerId
      });
      return this.productionView(tx, input.orderId);
    });
  }

  async dueProductionIds(limit = 50): Promise<readonly string[]> {
    const rows = await this.sql.begin(async (tx) => tx`
      SELECT id FROM production_orders
      WHERE status='queued' AND completes_at<=now()
      ORDER BY completes_at,id LIMIT ${Math.min(Math.max(limit, 1), 200)}
      FOR UPDATE SKIP LOCKED
    `);
    return rows.map((row) => String(row.id));
  }

  async productionOrders(ownerId: string): Promise<readonly ProductionOrderView[]> {
    const rows = await this.sql`
      SELECT o.*,r.code recipe_code FROM production_orders o
      JOIN production_recipes r ON r.id=o.recipe_id
      WHERE o.owner_id=${ownerId}::uuid ORDER BY o.created_at DESC
    `;
    return rows.map((row) => this.mapProduction(row));
  }

  private async productionView(
    tx: Tx,
    orderId: string
  ): Promise<ProductionOrderView> {
    const rows = await tx`
      SELECT o.*,r.code recipe_code FROM production_orders o
      JOIN production_recipes r ON r.id=o.recipe_id WHERE o.id=${orderId}::uuid
    `;
    if (!rows[0]) throw new Error("Ordem de produção não encontrada.");
    return this.mapProduction(rows[0]);
  }

  private mapProduction(row: Record<string, unknown>): ProductionOrderView {
    return {
      id: String(row.id),
      ownerId: String(row.owner_id),
      recipeCode: String(row.recipe_code),
      batches: Number(row.batches),
      status: row.status as ProductionOrderView["status"],
      startsAt: new Date(String(row.starts_at)).toISOString(),
      completesAt: new Date(String(row.completes_at)).toISOString(),
      completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null
    };
  }
}
