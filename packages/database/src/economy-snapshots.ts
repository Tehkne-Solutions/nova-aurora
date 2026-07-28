import { createHash,randomUUID } from "node:crypto";
import { EconomyRepositoryBase } from "./economy-base.js";
import {
  deriveSnapshotMetrics,
  reconcileMoneySupply,
  type EconomySnapshotMetrics
} from "./economy-simulation-rules.js";

export type EconomyScopeType="city"|"region"|"platform";
export type EconomySnapshotView=Readonly<{
  id:string;scopeType:EconomyScopeType;scopeId:string|null;windowStart:string;windowEnd:string;
  status:"computed"|"reconciled"|"divergent"|"superseded";ledgerCutoff:string;
  moneySupplyMinor:number;transactionVolumeMinor:number;moneyVelocity:number;
  priceIndex:number|null;inflationRatePercent:number|null;production:unknown;consumption:unknown;
  employmentRatePercent:number|null;wealthConcentrationPercent:number|null;
  fiscalBalanceMinor:number;indicators:unknown;assumptions:unknown;sourceHash:string;
  computedAt:string;reconciledAt:string|null;
}>;

function iso(value:unknown):string{return new Date(String(value)).toISOString();}
function nullableNumber(value:unknown):number|null{return value===null||value===undefined?null:Number(value);}

export class EconomySnapshotService extends EconomyRepositoryBase {
  async computePlatformDailySnapshot(day:Date,toleranceMinor=0):Promise<EconomySnapshotView>{
    const windowStart=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()));
    const windowEnd=new Date(windowStart.getTime()+86_400_000);
    return this.computeSnapshot({scopeType:"platform",scopeId:null,windowStart,windowEnd,toleranceMinor});
  }

  async computeSnapshot(input:{
    scopeType:EconomyScopeType;scopeId:string|null;windowStart:Date;windowEnd:Date;
    toleranceMinor?:number;priceIndex?:number|null;production?:Record<string,number>;
    consumption?:Record<string,number>;employmentRatePercent?:number|null;
    wealthConcentrationPercent?:number|null;fiscalBalanceMinor?:number;
    indicators?:Record<string,unknown>;assumptions?:Record<string,unknown>;
  }):Promise<EconomySnapshotView>{
    if(input.windowEnd<=input.windowStart)throw new Error("Janela econômica inválida.");
    if(input.scopeType==="platform"&&input.scopeId!==null)throw new Error("Escopo de plataforma não aceita scopeId.");
    if(input.scopeType!=="platform"&&!input.scopeId)throw new Error("Escopo regional exige scopeId.");
    const toleranceMinor=Math.max(0,Math.trunc(input.toleranceMinor??0));

    return this.sql.begin("isolation level serializable",async(tx)=>{
      const ledgerCutoff=input.windowEnd;
      const balanceRows=await tx`
        SELECT coalesce(sum(greatest(balance.available_minor+balance.reserved_minor,0)),0)::bigint total
        FROM ledger_account_balances balance
        JOIN ledger_accounts account ON account.id=balance.account_id
      `;
      const volumeRows=await tx`
        SELECT coalesce(sum(abs(entry.amount_minor)),0)::bigint / 2 AS total
        FROM ledger_entries entry
        JOIN ledger_transactions transaction ON transaction.id=entry.transaction_id
        WHERE transaction.created_at>=${input.windowStart.toISOString()}::timestamptz
          AND transaction.created_at<${input.windowEnd.toISOString()}::timestamptz
      `;
      const previousRows=await tx`
        SELECT price_index FROM economy_snapshots
        WHERE scope_type=${input.scopeType}
          AND (${input.scopeId}::uuid IS NULL AND scope_id IS NULL OR scope_id=${input.scopeId}::uuid)
          AND window_end<=${input.windowStart.toISOString()}::timestamptz
          AND price_index IS NOT NULL
        ORDER BY window_end DESC LIMIT 1
      `;
      const ledgerTotalMinor=Number(balanceRows[0]?.total??0);
      const transactionVolumeMinor=Number(volumeRows[0]?.total??0);
      const metrics:EconomySnapshotMetrics=deriveSnapshotMetrics({
        moneySupplyMinor:ledgerTotalMinor,
        transactionVolumeMinor,
        previousPriceIndex:nullableNumber(previousRows[0]?.price_index),
        currentPriceIndex:input.priceIndex??null
      });
      const reconciliation=reconcileMoneySupply({
        ledgerTotalMinor,
        snapshotTotalMinor:metrics.moneySupplyMinor,
        toleranceMinor
      });
      const canonical={...input,windowStart:input.windowStart.toISOString(),windowEnd:input.windowEnd.toISOString(),ledgerCutoff:ledgerCutoff.toISOString(),metrics};
      const sourceHash=createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
      const id=randomUUID();
      const rows=await tx`
        INSERT INTO economy_snapshots(
          id,scope_type,scope_id,window_start,window_end,status,ledger_cutoff,
          money_supply_minor,transaction_volume_minor,money_velocity,price_index,
          inflation_rate_percent,production,consumption,employment_rate_percent,
          wealth_concentration_percent,fiscal_balance_minor,indicators,assumptions,source_hash,
          reconciled_at
        ) VALUES (
          ${id}::uuid,${input.scopeType},${input.scopeId}::uuid,
          ${input.windowStart.toISOString()}::timestamptz,${input.windowEnd.toISOString()}::timestamptz,
          ${reconciliation.isBalanced?"reconciled":"divergent"},${ledgerCutoff.toISOString()}::timestamptz,
          ${metrics.moneySupplyMinor},${metrics.transactionVolumeMinor},${metrics.moneyVelocity},
          ${input.priceIndex??null},${metrics.inflationRatePercent},
          ${JSON.stringify(input.production??{})}::jsonb,${JSON.stringify(input.consumption??{})}::jsonb,
          ${input.employmentRatePercent??null},${input.wealthConcentrationPercent??null},
          ${Math.trunc(input.fiscalBalanceMinor??0)},${JSON.stringify(input.indicators??{})}::jsonb,
          ${JSON.stringify(input.assumptions??{})}::jsonb,${sourceHash},now()
        ) ON CONFLICT(scope_type,scope_id,window_start,window_end,source_hash)
        DO UPDATE SET source_hash=excluded.source_hash
        RETURNING *
      `;
      const row=rows[0];if(!row)throw new Error("Snapshot econômico não gerado.");
      await tx`
        INSERT INTO economy_snapshot_reconciliations(
          id,snapshot_id,ledger_total_minor,snapshot_total_minor,difference_minor,
          tolerance_minor,is_balanced,evidence
        ) VALUES (
          ${randomUUID()}::uuid,${String(row.id)}::uuid,${ledgerTotalMinor},${metrics.moneySupplyMinor},
          ${reconciliation.differenceMinor},${toleranceMinor},${reconciliation.isBalanced},
          ${JSON.stringify({ledgerCutoff:ledgerCutoff.toISOString(),sourceHash})}::jsonb
        ) ON CONFLICT(snapshot_id) DO NOTHING
      `;
      if(!reconciliation.isBalanced){
        await tx`
          INSERT INTO economy_snapshot_anomalies(
            id,snapshot_id,anomaly_key,severity,metric_key,observed_value,expected_min,expected_max,evidence
          ) VALUES (
            ${randomUUID()}::uuid,${String(row.id)}::uuid,'ledger-divergence','critical','money-supply',
            ${reconciliation.differenceMinor},${-toleranceMinor},${toleranceMinor},
            ${JSON.stringify(reconciliation)}::jsonb
          ) ON CONFLICT(snapshot_id,anomaly_key) DO NOTHING
        `;
      }
      await this.outbox(tx,String(row.id),"economy.snapshot.computed",{
        scopeType:input.scopeType,scopeId:input.scopeId,windowStart:input.windowStart,
        windowEnd:input.windowEnd,status:String(row.status),sourceHash
      });
      return this.map(row);
    });
  }

  async latest(scopeType:EconomyScopeType,scopeId:string|null):Promise<EconomySnapshotView|null>{
    const rows=await this.sql`
      SELECT * FROM economy_snapshots WHERE scope_type=${scopeType}
        AND (${scopeId}::uuid IS NULL AND scope_id IS NULL OR scope_id=${scopeId}::uuid)
      ORDER BY window_end DESC,computed_at DESC LIMIT 1
    `;
    return rows[0]?this.map(rows[0]):null;
  }

  private map(row:Record<string,unknown>):EconomySnapshotView{return{
    id:String(row.id),scopeType:String(row.scope_type) as EconomyScopeType,
    scopeId:row.scope_id===null?null:String(row.scope_id),windowStart:iso(row.window_start),windowEnd:iso(row.window_end),
    status:String(row.status) as EconomySnapshotView["status"],ledgerCutoff:iso(row.ledger_cutoff),
    moneySupplyMinor:Number(row.money_supply_minor),transactionVolumeMinor:Number(row.transaction_volume_minor),
    moneyVelocity:Number(row.money_velocity),priceIndex:nullableNumber(row.price_index),
    inflationRatePercent:nullableNumber(row.inflation_rate_percent),production:row.production,consumption:row.consumption,
    employmentRatePercent:nullableNumber(row.employment_rate_percent),wealthConcentrationPercent:nullableNumber(row.wealth_concentration_percent),
    fiscalBalanceMinor:Number(row.fiscal_balance_minor),indicators:row.indicators,assumptions:row.assumptions,
    sourceHash:String(row.source_hash),computedAt:iso(row.computed_at),reconciledAt:row.reconciled_at?iso(row.reconciled_at):null
  };}
}
