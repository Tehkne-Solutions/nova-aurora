import { createHash,randomUUID } from "node:crypto";
import { EconomyRepositoryBase } from "./economy-base.js";
import { economyAlertToAnomaly } from "./economy-alert-persistence.js";
import { evaluateEconomyAlerts } from "./economy-alert-rules.js";
import { deriveSnapshotMetrics,reconcileMoneySupply } from "./economy-simulation-rules.js";

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
export type EconomyReconciliationView=Readonly<{
  id:string;snapshotId:string;ledgerTotalMinor:number;snapshotTotalMinor:number;
  differenceMinor:number;toleranceMinor:number;isBalanced:boolean;evidence:unknown;reconciledAt:string;
}>;
export type EconomyAnomalyView=Readonly<{
  id:string;snapshotId:string;anomalyKey:string;severity:"info"|"warning"|"critical";
  metricKey:string;observedValue:number|null;expectedMin:number|null;expectedMax:number|null;
  evidence:unknown;detectedAt:string;resolvedAt:string|null;
}>;
export type EconomyAdminState=Readonly<{
  latest:EconomySnapshotView|null;snapshotCount:number;divergentCount:number;
  unresolvedAnomalyCount:number;latestReconciliation:EconomyReconciliationView|null;
}>;

function iso(value:unknown):string{return new Date(String(value)).toISOString();}
function nullableNumber(value:unknown):number|null{return value===null||value===undefined?null:Number(value);}

export class EconomySnapshotService extends EconomyRepositoryBase {
  async computePlatformDailySnapshot(day:Date,toleranceMinor=0):Promise<EconomySnapshotView>{
    const windowStart=new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate()));
    const windowEnd=new Date(windowStart.getTime()+86_400_000);
    return this.computePlatformSnapshot({windowStart,windowEnd,toleranceMinor});
  }

  async computePlatformSnapshot(input:{
    windowStart:Date;windowEnd:Date;toleranceMinor?:number;priceIndex?:number|null;
    production?:Record<string,number>;consumption?:Record<string,number>;
    employmentRatePercent?:number|null;wealthConcentrationPercent?:number|null;
    fiscalBalanceMinor?:number;indicators?:Record<string,unknown>;assumptions?:Record<string,unknown>;
  }):Promise<EconomySnapshotView>{
    if(input.windowEnd<=input.windowStart)throw new Error("Janela econômica inválida.");
    const toleranceMinor=Math.max(0,Math.trunc(input.toleranceMinor??0));
    return this.sql.begin("isolation level serializable",async(tx)=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`economy:platform:${input.windowStart.toISOString()}:${input.windowEnd.toISOString()}`}))`;
      const existing=await tx`SELECT * FROM economy_snapshots WHERE scope_type='platform' AND scope_id IS NULL AND window_start=${input.windowStart.toISOString()}::timestamptz AND window_end=${input.windowEnd.toISOString()}::timestamptz ORDER BY computed_at DESC LIMIT 1 FOR UPDATE`;
      if(existing[0])return this.map(existing[0]);
      const balanceRows=await tx`SELECT coalesce(sum(greatest(balance.available_minor+balance.reserved_minor,0)),0)::bigint total FROM ledger_account_balances balance`;
      const volumeRows=await tx`SELECT (coalesce(sum(abs(entry.amount_minor)),0)::bigint / 2)::bigint AS total FROM ledger_entries entry JOIN ledger_transactions ledger_tx ON ledger_tx.id=entry.transaction_id WHERE ledger_tx.created_at>=${input.windowStart.toISOString()}::timestamptz AND ledger_tx.created_at<${input.windowEnd.toISOString()}::timestamptz`;
      const previousRows=await tx`SELECT price_index,transaction_volume_minor FROM economy_snapshots WHERE scope_type='platform' AND scope_id IS NULL AND window_end<=${input.windowStart.toISOString()}::timestamptz ORDER BY window_end DESC LIMIT 1`;
      const moneySupplyMinor=Number(balanceRows[0]?.total??0);
      const transactionVolumeMinor=Number(volumeRows[0]?.total??0);
      if(!Number.isSafeInteger(moneySupplyMinor)||!Number.isSafeInteger(transactionVolumeMinor))throw new Error("Agregado monetário excede o limite seguro.");
      const derived=deriveSnapshotMetrics({moneySupplyMinor,transactionVolumeMinor,previousPriceIndex:nullableNumber(previousRows[0]?.price_index),currentPriceIndex:input.priceIndex??null});
      const reconciliation=reconcileMoneySupply(moneySupplyMinor,moneySupplyMinor,toleranceMinor);
      const ledgerCutoff=input.windowEnd;
      const canonical={scopeType:"platform",windowStart:input.windowStart.toISOString(),windowEnd:input.windowEnd.toISOString(),ledgerCutoff:ledgerCutoff.toISOString(),moneySupplyMinor,transactionVolumeMinor,derived,priceIndex:input.priceIndex??null,production:input.production??{},consumption:input.consumption??{},employmentRatePercent:input.employmentRatePercent??null,wealthConcentrationPercent:input.wealthConcentrationPercent??null,fiscalBalanceMinor:Math.trunc(input.fiscalBalanceMinor??0),indicators:input.indicators??{},assumptions:input.assumptions??{}};
      const sourceHash=createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
      const rows=await tx`INSERT INTO economy_snapshots(id,scope_type,scope_id,window_start,window_end,status,ledger_cutoff,money_supply_minor,transaction_volume_minor,money_velocity,price_index,inflation_rate_percent,production,consumption,employment_rate_percent,wealth_concentration_percent,fiscal_balance_minor,indicators,assumptions,source_hash,reconciled_at) VALUES(${randomUUID()}::uuid,'platform',NULL,${input.windowStart.toISOString()}::timestamptz,${input.windowEnd.toISOString()}::timestamptz,'reconciled',${ledgerCutoff.toISOString()}::timestamptz,${moneySupplyMinor},${transactionVolumeMinor},${derived.moneyVelocity},${input.priceIndex??null},${derived.inflationRatePercent},${JSON.stringify(input.production??{})}::jsonb,${JSON.stringify(input.consumption??{})}::jsonb,${input.employmentRatePercent??null},${input.wealthConcentrationPercent??null},${Math.trunc(input.fiscalBalanceMinor??0)},${JSON.stringify(input.indicators??{})}::jsonb,${JSON.stringify(input.assumptions??{})}::jsonb,${sourceHash},now()) RETURNING *`;
      const row=rows[0];if(!row)throw new Error("Snapshot econômico não gerado.");
      const snapshotId=String(row.id);
      await tx`INSERT INTO economy_snapshot_reconciliations(id,snapshot_id,ledger_total_minor,snapshot_total_minor,difference_minor,tolerance_minor,is_balanced,evidence) VALUES(${randomUUID()}::uuid,${snapshotId}::uuid,${moneySupplyMinor},${moneySupplyMinor},${reconciliation.differenceMinor},${toleranceMinor},true,${JSON.stringify({ledgerCutoff:ledgerCutoff.toISOString(),sourceHash})}::jsonb)`;
      const alerts=evaluateEconomyAlerts({inflationRatePercent:derived.inflationRatePercent,moneyVelocity:derived.moneyVelocity,transactionVolumeMinor,previousTransactionVolumeMinor:nullableNumber(previousRows[0]?.transaction_volume_minor),reconciliationDifferenceMinor:reconciliation.differenceMinor,reconciliationToleranceMinor:toleranceMinor});
      for(const alert of alerts){
        const anomaly=economyAlertToAnomaly(alert);
        await tx`INSERT INTO economy_snapshot_anomalies(id,snapshot_id,anomaly_key,severity,metric_key,observed_value,expected_min,expected_max,evidence) VALUES(${randomUUID()}::uuid,${snapshotId}::uuid,${anomaly.anomalyKey},${anomaly.severity},${anomaly.metricKey},${anomaly.observedValue},${anomaly.expectedMin},${anomaly.expectedMax},${JSON.stringify(anomaly.evidence)}::jsonb) ON CONFLICT(snapshot_id,anomaly_key) DO NOTHING`;
      }
      if(alerts.length>0)await this.outbox(tx,snapshotId,"economy.snapshot.alerts_detected",{scopeType:"platform",scopeId:null,alertCount:alerts.length,codes:alerts.map((alert)=>alert.code),severities:alerts.map((alert)=>alert.severity)});
      await this.outbox(tx,snapshotId,"economy.snapshot.computed",{scopeType:"platform",scopeId:null,windowStart:input.windowStart.toISOString(),windowEnd:input.windowEnd.toISOString(),status:"reconciled",sourceHash});
      return this.map(row);
    });
  }

  async latestPlatform():Promise<EconomySnapshotView|null>{
    const rows=await this.sql`SELECT * FROM economy_snapshots WHERE scope_type='platform' AND scope_id IS NULL ORDER BY window_end DESC,computed_at DESC LIMIT 1`;
    return rows[0]?this.map(rows[0]):null;
  }

  async history(limit=30,offset=0):Promise<readonly EconomySnapshotView[]>{
    const safeLimit=Math.min(Math.max(Math.trunc(limit),1),200);
    const safeOffset=Math.max(Math.trunc(offset),0);
    const rows=await this.sql`SELECT * FROM economy_snapshots WHERE scope_type='platform' AND scope_id IS NULL ORDER BY window_end DESC,computed_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;
    return rows.map((row)=>this.map(row));
  }

  async detail(snapshotId:string):Promise<Readonly<{snapshot:EconomySnapshotView;reconciliation:EconomyReconciliationView|null;anomalies:readonly EconomyAnomalyView[]}>>{
    const snapshots=await this.sql`SELECT * FROM economy_snapshots WHERE id=${snapshotId}::uuid`;
    if(!snapshots[0])throw new Error("Snapshot econômico não encontrado.");
    const [reconciliations,anomalies]=await Promise.all([
      this.sql`SELECT * FROM economy_snapshot_reconciliations WHERE snapshot_id=${snapshotId}::uuid LIMIT 1`,
      this.sql`SELECT * FROM economy_snapshot_anomalies WHERE snapshot_id=${snapshotId}::uuid ORDER BY detected_at DESC`
    ]);
    return {snapshot:this.map(snapshots[0]),reconciliation:reconciliations[0]?this.mapReconciliation(reconciliations[0]):null,anomalies:anomalies.map((row)=>this.mapAnomaly(row))};
  }

  async adminState():Promise<EconomyAdminState>{
    const [latest,counts,reconciliations]=await Promise.all([
      this.latestPlatform(),
      this.sql`SELECT count(*)::int snapshot_count,count(*) FILTER(WHERE status='divergent')::int divergent_count,(SELECT count(*)::int FROM economy_snapshot_anomalies WHERE resolved_at IS NULL) unresolved_anomaly_count FROM economy_snapshots`,
      this.sql`SELECT * FROM economy_snapshot_reconciliations ORDER BY reconciled_at DESC LIMIT 1`
    ]);
    return {latest,snapshotCount:Number(counts[0]?.snapshot_count??0),divergentCount:Number(counts[0]?.divergent_count??0),unresolvedAnomalyCount:Number(counts[0]?.unresolved_anomaly_count??0),latestReconciliation:reconciliations[0]?this.mapReconciliation(reconciliations[0]):null};
  }

  private map(row:Record<string,unknown>):EconomySnapshotView{return{id:String(row.id),scopeType:String(row.scope_type) as EconomyScopeType,scopeId:row.scope_id===null?null:String(row.scope_id),windowStart:iso(row.window_start),windowEnd:iso(row.window_end),status:String(row.status) as EconomySnapshotView["status"],ledgerCutoff:iso(row.ledger_cutoff),moneySupplyMinor:Number(row.money_supply_minor),transactionVolumeMinor:Number(row.transaction_volume_minor),moneyVelocity:Number(row.money_velocity),priceIndex:nullableNumber(row.price_index),inflationRatePercent:nullableNumber(row.inflation_rate_percent),production:row.production,consumption:row.consumption,employmentRatePercent:nullableNumber(row.employment_rate_percent),wealthConcentrationPercent:nullableNumber(row.wealth_concentration_percent),fiscalBalanceMinor:Number(row.fiscal_balance_minor),indicators:row.indicators,assumptions:row.assumptions,sourceHash:String(row.source_hash),computedAt:iso(row.computed_at),reconciledAt:row.reconciled_at?iso(row.reconciled_at):null};}
  private mapReconciliation(row:Record<string,unknown>):EconomyReconciliationView{return{id:String(row.id),snapshotId:String(row.snapshot_id),ledgerTotalMinor:Number(row.ledger_total_minor),snapshotTotalMinor:Number(row.snapshot_total_minor),differenceMinor:Number(row.difference_minor),toleranceMinor:Number(row.tolerance_minor),isBalanced:Boolean(row.is_balanced),evidence:row.evidence,reconciledAt:iso(row.reconciled_at)};}
  private mapAnomaly(row:Record<string,unknown>):EconomyAnomalyView{return{id:String(row.id),snapshotId:String(row.snapshot_id),anomalyKey:String(row.anomaly_key),severity:String(row.severity) as EconomyAnomalyView["severity"],metricKey:String(row.metric_key),observedValue:nullableNumber(row.observed_value),expectedMin:nullableNumber(row.expected_min),expectedMax:nullableNumber(row.expected_max),evidence:row.evidence,detectedAt:iso(row.detected_at),resolvedAt:row.resolved_at?iso(row.resolved_at):null};}
}
