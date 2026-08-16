import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { db } from "@nova-aurora/database";

type Tx = postgres.TransactionSql<Record<string, never>>;
const accounts = { alice: "user.alice.wallet", bob: "user.bob.wallet", city: "city.treasury" } as const;
const users = { alice: "11111111-1111-4111-8111-111111111111", bob: "22222222-2222-4222-8222-222222222222" } as const;
const bread = "b0000000-0000-4000-8000-000000000004";

async function accountId(tx: Tx, code: string): Promise<string> {
  const rows = await tx`SELECT id FROM ledger_accounts WHERE code=${code} FOR UPDATE`;
  if (!rows[0]) throw new Error(`Conta ausente: ${code}`);
  return String(rows[0].id);
}

async function balance(tx: Tx, code: string): Promise<number> {
  const rows = await tx`SELECT COALESCE(SUM(e.amount_minor),0)::bigint value FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id WHERE a.code=${code}`;
  return Number(rows[0]?.value ?? 0);
}

async function post(tx: Tx, input: { key: string; type: string; entries: { code: string; amount: number; memo: string }[] }): Promise<string> {
  const total=input.entries.reduce((sum,e)=>sum+e.amount,0);
  if(total!==0) throw new Error(`Ledger desequilibrado: ${total}`);
  const id=randomUUID();
  await tx`INSERT INTO ledger_transactions (id,idempotency_key,transaction_type) VALUES (${id}::uuid,${input.key},${input.type})`;
  for(const entry of [...input.entries].sort((a,b)=>a.code.localeCompare(b.code))){
    const idAccount=await accountId(tx,entry.code);
    if(entry.amount<0 && entry.code!=="system.issuance" && await balance(tx,entry.code)+entry.amount<0) throw new Error("Saldo insuficiente.");
    await tx`INSERT INTO ledger_entries (transaction_id,account_id,amount_minor,memo) VALUES (${id}::uuid,${idAccount}::uuid,${entry.amount},${entry.memo})`;
  }
  await tx`SELECT assert_balanced(${id}::uuid)`;
  return id;
}

export async function snapshot(ownerId: string){
  const sql=db();
  const balanceRows=await sql`
    SELECT code,posted_minor,reserved_minor,available_minor
    FROM ledger_account_balances
    WHERE owner_id=${ownerId}::uuid
    ORDER BY code
  `;
  const balances=balanceRows.map((row)=>({
    code:String(row.code),
    value:Number(row.available_minor),
    postedMinor:Number(row.posted_minor),
    reservedMinor:Number(row.reserved_minor),
    availableMinor:Number(row.available_minor)
  }));
  const inventory=await sql`
    SELECT i.code,SUM(l.quantity_minor-l.reserved_minor)::bigint quantity
    FROM inventory_lots l
    JOIN items i ON i.id=l.item_id
    WHERE l.owner_id=${ownerId}::uuid
    GROUP BY i.code ORDER BY i.code
  `;
  const orders=await sql`
    SELECT o.id,o.side,i.code item,o.remaining_minor,o.unit_price_minor,o.status
    FROM market_orders o
    JOIN items i ON i.id=o.item_id
    WHERE o.owner_id=${ownerId}::uuid
    ORDER BY o.created_at DESC
  `;
  return { adapter:"postgres", balances, inventory, orders, signature:"Tehkné Solutions" };
}

export async function verticalSlice(key:string){
  const sql=db();
  return sql.begin("isolation level serializable",async(tx)=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const old=await tx`SELECT response FROM idempotency_records WHERE key=${key}`;
    if(old[0]) return old[0].response;
    await post(tx,{key:`${key}:reward`,type:"public-job",entries:[{code:accounts.city,amount:-3000,memo:"Apoio à colheita"},{code:accounts.alice,amount:3000,memo:"Apoio à colheita"}]});
    await tx`INSERT INTO inventory_lots (owner_id,item_id,quantity_minor,quality) VALUES (${users.alice}::uuid,${bread}::uuid,1000,60)`;
    const orderId=randomUUID();
    await tx`INSERT INTO market_orders (id,owner_id,side,item_id,quantity_minor,remaining_minor,unit_price_minor,status,idempotency_key) VALUES (${orderId}::uuid,${users.alice}::uuid,'sell',${bread}::uuid,600,400,2200,'open',${`${key}:sell`})`;
    await post(tx,{key:`${key}:trade`,type:"market-settlement",entries:[{code:accounts.bob,amount:-4400,memo:"Compra de pão"},{code:accounts.alice,amount:4312,memo:"Venda de pão"},{code:accounts.city,amount:88,memo:"Taxa de mercado"}]});
    await tx`UPDATE inventory_lots SET quantity_minor=quantity_minor-200 WHERE owner_id=${users.alice}::uuid AND item_id=${bread}::uuid`;
    await tx`INSERT INTO inventory_lots (owner_id,item_id,quantity_minor,quality) VALUES (${users.bob}::uuid,${bread}::uuid,200,60)`;
    const eventId=randomUUID();
    await tx`INSERT INTO outbox_events (id,event_type,aggregate_id,payload) VALUES (${eventId}::uuid,'market.trade.settled',${orderId}::uuid,${JSON.stringify({buyer:"bob",seller:"alice",quantity:2,grossMinor:4400})}::jsonb)`;
    const response={ok:true,orderId,grossMinor:4400,taxMinor:88,sellerNetMinor:4312};
    const hash=createHash("sha256").update(key).digest("hex");
    await tx`INSERT INTO idempotency_records (key,request_hash,response) VALUES (${key},${hash},${JSON.stringify(response)}::jsonb)`;
    return response;
  });
}

// Tehkné Solutions
