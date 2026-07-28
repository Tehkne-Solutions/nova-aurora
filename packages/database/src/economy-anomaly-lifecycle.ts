import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase } from "./economy-base.js";

export type EconomyAnomalyActionView=Readonly<{
  id:string;anomalyId:string;snapshotId:string;action:"resolved"|"reopened";
  actorUserId:string;reason:string;occurredAt:string;
}>;

export type EconomyLifecycleAnomalyView=Readonly<{
  id:string;snapshotId:string;anomalyKey:string;severity:"info"|"warning"|"critical";
  resolvedAt:string|null;resolvedBy:string|null;resolutionReason:string|null;
}>;

function iso(value:unknown):string{return new Date(String(value)).toISOString();}

export class EconomyAnomalyLifecycleService extends EconomyRepositoryBase {
  async history(anomalyId:string,limit=100,offset=0):Promise<readonly EconomyAnomalyActionView[]>{
    const safeLimit=Math.min(Math.max(Math.trunc(limit),1),200);
    const safeOffset=Math.max(Math.trunc(offset),0);
    const rows=await this.sql`SELECT * FROM economy_anomaly_actions WHERE anomaly_id=${anomalyId}::uuid ORDER BY occurred_at DESC,id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;
    return rows.map((row)=>this.mapAction(row));
  }

  async reopen(anomalyId:string,actorUserId:string,reason:string):Promise<EconomyLifecycleAnomalyView>{
    const normalizedReason=reason.trim();
    if(normalizedReason.length<10||normalizedReason.length>1000)throw new Error("A justificativa deve ter entre 10 e 1.000 caracteres.");
    return this.sql.begin("isolation level serializable",async(tx)=>{
      const rows=await tx`SELECT * FROM economy_snapshot_anomalies WHERE id=${anomalyId}::uuid FOR UPDATE`;
      const current=rows[0];
      if(!current)throw new Error("Anomalia econômica não encontrada.");
      if(!current.resolved_at)return this.mapAnomaly(current);
      await tx`INSERT INTO economy_anomaly_actions(id,anomaly_id,snapshot_id,action,actor_user_id,reason) VALUES(${randomUUID()}::uuid,${anomalyId}::uuid,${String(current.snapshot_id)}::uuid,'reopened',${actorUserId}::uuid,${normalizedReason})`;
      const updated=await tx`UPDATE economy_snapshot_anomalies SET resolved_at=NULL,resolved_by=NULL,resolution_reason=NULL WHERE id=${anomalyId}::uuid AND resolved_at IS NOT NULL RETURNING *`;
      const row=updated[0];if(!row)throw new Error("Anomalia econômica não reaberta.");
      await this.outbox(tx,String(row.snapshot_id),"economy.snapshot.anomaly_reopened",{anomalyId:String(row.id),snapshotId:String(row.snapshot_id),anomalyKey:String(row.anomaly_key),severity:String(row.severity),reopenedBy:actorUserId,reason:normalizedReason});
      return this.mapAnomaly(row);
    });
  }

  private mapAction(row:Record<string,unknown>):EconomyAnomalyActionView{return{id:String(row.id),anomalyId:String(row.anomaly_id),snapshotId:String(row.snapshot_id),action:String(row.action) as EconomyAnomalyActionView["action"],actorUserId:String(row.actor_user_id),reason:String(row.reason),occurredAt:iso(row.occurred_at)};}
  private mapAnomaly(row:Record<string,unknown>):EconomyLifecycleAnomalyView{return{id:String(row.id),snapshotId:String(row.snapshot_id),anomalyKey:String(row.anomaly_key),severity:String(row.severity) as EconomyLifecycleAnomalyView["severity"],resolvedAt:row.resolved_at?iso(row.resolved_at):null,resolvedBy:row.resolved_by?String(row.resolved_by):null,resolutionReason:row.resolution_reason?String(row.resolution_reason):null};}
}

// Tehkné Solutions
