import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { db } from "./index.js";

export type Tx = postgres.TransactionSql<Record<string, never>>;
const CITY_ACCOUNT = "city.treasury";

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export abstract class EconomyRepositoryBase {
  protected readonly sql = db();

  async resolveUserId(email: string): Promise<string> {
    const rows = await this.sql`SELECT id FROM users WHERE email=${email.trim().toLowerCase()}`;
    if (!rows[0]) throw new Error("Usuário não encontrado.");
    return String(rows[0].id);
  }

  async dispatchOutbox(
    publisher: (event: Readonly<{ eventType: string; payload: unknown }>) => Promise<void>,
    limit = 100
  ): Promise<number> {
    return this.sql.begin(async (tx) => {
      const rows = await tx`
        SELECT id,event_type,payload FROM outbox_events
        WHERE published_at IS NULL ORDER BY occurred_at
        LIMIT ${Math.min(Math.max(limit, 1), 500)} FOR UPDATE SKIP LOCKED
      `;
      for (const row of rows) {
        await publisher({ eventType: String(row.event_type), payload: row.payload });
        await tx`UPDATE outbox_events SET published_at=now() WHERE id=${String(row.id)}::uuid`;
      }
      return rows.length;
    });
  }

  protected async idempotent<T>(
    key: string,
    actorId: string,
    request: unknown,
    operation: (tx: Tx) => Promise<T>
  ): Promise<T> {
    const hash = requestHash(request);
    const result = await this.sql.begin("isolation level serializable", async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const old = await tx`SELECT request_hash,response FROM idempotency_records WHERE key=${key} FOR UPDATE`;
      if (old[0]) {
        if (String(old[0].request_hash) !== hash) {
          throw new Error("Idempotency-Key reutilizada com outro payload.");
        }
        return old[0].response as T;
      }
      const response = await operation(tx);
      await tx`
        INSERT INTO idempotency_records (key,actor_id,request_hash,response)
        VALUES (${key},${actorId}::uuid,${hash},${JSON.stringify(response)}::jsonb)
      `;
      return response;
    });
    return result as T;
  }

  protected async reserveInventory(tx: Tx, input: {
    ownerId: string;
    itemId: string;
    quantityMinor: number;
    idempotencyKey: string;
    marketOrderId?: string;
    productionOrderId?: string;
  }): Promise<void> {
    const lots = await tx`
      SELECT id,quantity_minor,reserved_minor FROM inventory_lots
      WHERE owner_id=${input.ownerId}::uuid AND item_id=${input.itemId}::uuid
        AND quantity_minor>reserved_minor
      ORDER BY created_at,id FOR UPDATE
    `;
    const available = lots.reduce(
      (sum, lot) => sum + Number(lot.quantity_minor) - Number(lot.reserved_minor),
      0
    );
    if (available < input.quantityMinor) throw new Error("Estoque disponível insuficiente.");

    let remaining = input.quantityMinor;
    for (let index = 0; index < lots.length && remaining > 0; index += 1) {
      const lot = lots[index];
      if (!lot) break;
      const availableInLot = Number(lot.quantity_minor) - Number(lot.reserved_minor);
      const take = Math.min(remaining, availableInLot);
      await tx`UPDATE inventory_lots SET reserved_minor=reserved_minor+${take} WHERE id=${String(lot.id)}::uuid`;
      await tx`
        INSERT INTO reservations (
          id,resource_type,resource_id,quantity_minor,remaining_minor,status,
          expires_at,idempotency_key,owner_id,market_order_id,production_order_id
        ) VALUES (
          ${randomUUID()}::uuid,'inventory',${String(lot.id)}::uuid,${take},${take},'active',
          now()+interval '30 days',${`${input.idempotencyKey}:${index}`},${input.ownerId}::uuid,
          ${input.marketOrderId ?? null}::uuid,${input.productionOrderId ?? null}::uuid
        )
      `;
      remaining -= take;
    }
  }

  protected async reserveBalance(tx: Tx, input: {
    accountId: string;
    ownerId: string;
    quantityMinor: number;
    idempotencyKey: string;
    marketOrderId?: string;
    productionOrderId?: string;
  }): Promise<void> {
    await tx`SELECT id FROM ledger_accounts WHERE id=${input.accountId}::uuid FOR UPDATE`;
    const balances = await tx`
      SELECT available_minor FROM ledger_account_balances WHERE account_id=${input.accountId}::uuid
    `;
    if (Number(balances[0]?.available_minor ?? 0) < input.quantityMinor) {
      throw new Error("Saldo disponível insuficiente.");
    }
    await tx`
      INSERT INTO reservations (
        id,resource_type,resource_id,quantity_minor,remaining_minor,status,
        expires_at,idempotency_key,owner_id,market_order_id,production_order_id
      ) VALUES (
        ${randomUUID()}::uuid,'balance',${input.accountId}::uuid,${input.quantityMinor},${input.quantityMinor},'active',
        now()+interval '30 days',${input.idempotencyKey},${input.ownerId}::uuid,
        ${input.marketOrderId ?? null}::uuid,${input.productionOrderId ?? null}::uuid
      )
    `;
  }

  protected async releaseReservations(
    tx: Tx,
    marketOrderId: string | null,
    productionOrderId: string | null
  ): Promise<void> {
    const reservations = marketOrderId
      ? await tx`SELECT * FROM reservations WHERE market_order_id=${marketOrderId}::uuid AND status='active' FOR UPDATE`
      : await tx`SELECT * FROM reservations WHERE production_order_id=${productionOrderId}::uuid AND status='active' FOR UPDATE`;

    for (const reservation of reservations) {
      if (String(reservation.resource_type) === "inventory") {
        const quantity = Number(reservation.remaining_minor);
        await tx`
          UPDATE inventory_lots SET reserved_minor=reserved_minor-${quantity}
          WHERE id=${String(reservation.resource_id)}::uuid AND reserved_minor>=${quantity}
        `;
      }
      await tx`
        UPDATE reservations SET remaining_minor=0,status='released',updated_at=now()
        WHERE id=${String(reservation.id)}::uuid
      `;
    }
  }

  protected async addInventory(
    tx: Tx,
    ownerId: string,
    itemId: string,
    quantityMinor: number,
    quality: number
  ): Promise<void> {
    const rows = await tx`
      SELECT id FROM inventory_lots
      WHERE owner_id=${ownerId}::uuid AND item_id=${itemId}::uuid AND quality=${quality}
      ORDER BY created_at LIMIT 1 FOR UPDATE
    `;
    if (rows[0]) {
      await tx`UPDATE inventory_lots SET quantity_minor=quantity_minor+${quantityMinor} WHERE id=${String(rows[0].id)}::uuid`;
    } else {
      await tx`
        INSERT INTO inventory_lots (id,owner_id,item_id,quantity_minor,reserved_minor,quality)
        VALUES (${randomUUID()}::uuid,${ownerId}::uuid,${itemId}::uuid,${quantityMinor},0,${quality})
      `;
    }
  }

  protected async walletAccount(tx: Tx, ownerId: string): Promise<Readonly<{ id: string; code: string }>> {
    const rows = await tx`
      SELECT id,code FROM ledger_accounts
      WHERE owner_id=${ownerId}::uuid AND account_type='wallet'
      ORDER BY created_at LIMIT 1 FOR UPDATE
    `;
    if (!rows[0]) throw new Error("Conta do usuário não encontrada.");
    return { id: String(rows[0].id), code: String(rows[0].code) };
  }

  protected async postLedger(tx: Tx, input: {
    key: string;
    type: string;
    entries: readonly Readonly<{
      accountId?: string;
      accountCode?: string;
      amount: number;
      memo: string;
    }>[];
  }): Promise<string> {
    const total = input.entries.reduce((sum, entry) => sum + entry.amount, 0);
    if (total !== 0) throw new Error(`Ledger desequilibrado: ${total}.`);
    const existing = await tx`SELECT id FROM ledger_transactions WHERE idempotency_key=${input.key}`;
    if (existing[0]) return String(existing[0].id);

    const resolved: { id: string; amount: number; memo: string }[] = [];
    for (const entry of input.entries) {
      let rows;
      if (entry.accountId) {
        rows = await tx`SELECT id FROM ledger_accounts WHERE id=${entry.accountId}::uuid`;
      } else {
        if (!entry.accountCode) throw new Error("Conta do ledger não informada.");
        rows = await tx`SELECT id FROM ledger_accounts WHERE code=${entry.accountCode}`;
      }
      if (!rows[0]) throw new Error("Conta do ledger ausente.");
      resolved.push({ id: String(rows[0].id), amount: entry.amount, memo: entry.memo });
    }
    for (const accountId of [...new Set(resolved.map((entry) => entry.id))].sort()) {
      await tx`SELECT id FROM ledger_accounts WHERE id=${accountId}::uuid FOR UPDATE`;
    }

    const transactionId = randomUUID();
    await tx`
      INSERT INTO ledger_transactions (id,idempotency_key,transaction_type)
      VALUES (${transactionId}::uuid,${input.key},${input.type})
    `;
    for (const entry of resolved) {
      await tx`
        INSERT INTO ledger_entries (transaction_id,account_id,amount_minor,memo)
        VALUES (${transactionId}::uuid,${entry.id}::uuid,${entry.amount},${entry.memo})
      `;
    }
    await tx`SELECT assert_balanced(${transactionId}::uuid)`;
    return transactionId;
  }

  protected async outbox(tx: Tx, aggregateId: string, eventType: string, payload: unknown): Promise<void> {
    await tx`
      INSERT INTO outbox_events (id,event_type,aggregate_id,payload)
      VALUES (${randomUUID()}::uuid,${eventType},${aggregateId}::uuid,${JSON.stringify(payload)}::jsonb)
    `;
  }

  protected async cityAccountId(tx: Tx): Promise<string> {
    const rows = await tx`SELECT id FROM ledger_accounts WHERE code=${CITY_ACCOUNT}`;
    if (!rows[0]) throw new Error("Tesouro municipal não encontrado.");
    return String(rows[0].id);
  }
}
