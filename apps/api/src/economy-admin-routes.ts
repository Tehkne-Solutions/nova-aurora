import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db,EconomySnapshotService } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";

const economySnapshots=new EconomySnapshotService();
const economySql=db();
const historyQuery=z.object({limit:z.coerce.number().int().min(1).max(200).default(30),offset:z.coerce.number().int().min(0).default(0)});
const anomalyQuery=historyQuery.extend({
  code:z.enum(["high_inflation","critical_inflation","deflation","low_money_velocity","frozen_money_velocity","activity_contraction","activity_shock","ledger_divergence"]).optional(),
  severity:z.enum(["info","warning","critical"]).optional(),
  resolved:z.enum(["true","false"]).transform((value)=>value==="true").optional(),
  snapshotId:z.string().uuid().optional()
});
const reasonSchema=z.object({reason:z.string().trim().min(10).max(1000)});
const computeSchema=z.object({day:z.coerce.date().optional(),toleranceMinor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)});

function numberValue(value:unknown):number{return Number(value??0);}
function nullableNumber(value:unknown):number|null{return value===null||value===undefined?null:Number(value);}

async function anomalyMetrics(){
  const [summaryRows,severityRows,reopenRows]=await Promise.all([
    economySql`SELECT count(*)::int total,count(*) FILTER(WHERE resolved_at IS NULL)::int open_count,count(*) FILTER(WHERE resolved_at IS NOT NULL)::int resolved_count,avg(extract(epoch FROM (resolved_at-detected_at))/60.0) FILTER(WHERE resolved_at IS NOT NULL) average_resolution_minutes,max(extract(epoch FROM (now()-detected_at))/60.0) FILTER(WHERE resolved_at IS NULL) oldest_open_age_minutes FROM economy_snapshot_anomalies`,
    economySql`SELECT severity,count(*)::int total,count(*) FILTER(WHERE resolved_at IS NULL)::int open_count FROM economy_snapshot_anomalies GROUP BY severity`,
    economySql`SELECT count(*)::int reopened_actions FROM economy_anomaly_actions WHERE action='reopened'`
  ]);
  const summary=summaryRows[0]??{};
  const total=numberValue(summary.total);
  const resolved=numberValue(summary.resolved_count);
  const bySeverity={info:0,warning:0,critical:0};
  const openBySeverity={info:0,warning:0,critical:0};
  for(const row of severityRows){
    const severity=String(row.severity) as keyof typeof bySeverity;
    if(severity in bySeverity){
      bySeverity[severity]=numberValue(row.total);
      openBySeverity[severity]=numberValue(row.open_count);
    }
  }
  return {
    total,
    open:numberValue(summary.open_count),
    resolved,
    resolutionRatePercent:total===0?0:Number(((resolved/total)*100).toFixed(2)),
    reopenedActions:numberValue(reopenRows[0]?.reopened_actions),
    averageResolutionMinutes:nullableNumber(summary.average_resolution_minutes),
    oldestOpenAgeMinutes:nullableNumber(summary.oldest_open_age_minutes),
    bySeverity,
    openBySeverity
  };
}

export async function registerEconomyAdminRoutes(app:FastifyInstance):Promise<void>{
  app.get("/v1/admin/economy/state",async(request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    return {...await economySnapshots.adminState(),signature:"Tehkné Solutions"};
  });

  app.get<{Querystring:{limit?:string;offset?:string}}>("/v1/admin/economy/snapshots",async(request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    const query=historyQuery.parse(request.query);
    return {snapshots:await economySnapshots.history(query.limit,query.offset),pagination:query,signature:"Tehkné Solutions"};
  });

  app.get("/v1/admin/economy/anomalies",async(request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    const query=anomalyQuery.parse(request.query);
    return {anomalies:await economySnapshots.listAnomalies(query),filters:query,signature:"Tehkné Solutions"};
  });

  app.get("/v1/admin/economy/anomalies/metrics",async(request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    return {metrics:await anomalyMetrics(),generatedAt:new Date().toISOString(),signature:"Tehkné Solutions"};
  });

  app.get<{Params:{anomalyId:string}}>("/v1/admin/economy/anomalies/:anomalyId/history",async(request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const query=historyQuery.parse(request.query);
    return {actions:await economySnapshots.anomalyHistory(anomalyId,query.limit,query.offset),pagination:query,signature:"Tehkné Solutions"};
  });

  app.patch<{Params:{anomalyId:string}}>("/v1/admin/economy/anomalies/:anomalyId/resolve",async(request)=>{
    const identity=await requireRole(app,request,["platform-admin"]);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const body=reasonSchema.parse(request.body);
    return {anomaly:await economySnapshots.resolveAnomaly(anomalyId,identity.userId,body.reason),signature:"Tehkné Solutions"};
  });

  app.patch<{Params:{anomalyId:string}}>("/v1/admin/economy/anomalies/:anomalyId/reopen",async(request)=>{
    const identity=await requireRole(app,request,["platform-admin"]);
    const anomalyId=z.string().uuid().parse(request.params.anomalyId);
    const body=reasonSchema.parse(request.body);
    return {anomaly:await economySnapshots.reopenAnomaly(anomalyId,identity.userId,body.reason),signature:"Tehkné Solutions"};
  });

  app.get<{Params:{snapshotId:string}}>("/v1/admin/economy/snapshots/:snapshotId",async(request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    const snapshotId=z.string().uuid().parse(request.params.snapshotId);
    return {...await economySnapshots.detail(snapshotId),signature:"Tehkné Solutions"};
  });

  app.post("/v1/admin/economy/compute",async(request)=>{
    await requireRole(app,request,["platform-admin"]);
    const body=computeSchema.parse(request.body);
    const day=body.day??new Date(Date.now()-86_400_000);
    return {snapshot:await economySnapshots.computePlatformDailySnapshot(day,body.toleranceMinor),signature:"Tehkné Solutions"};
  });
}

// Tehkné Solutions
