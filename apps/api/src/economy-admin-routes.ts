import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EconomySnapshotService } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";

const economySnapshots=new EconomySnapshotService();
const historyQuery=z.object({limit:z.coerce.number().int().min(1).max(200).default(30),offset:z.coerce.number().int().min(0).default(0)});
const anomalyQuery=historyQuery.extend({
  code:z.enum(["high_inflation","critical_inflation","deflation","low_money_velocity","frozen_money_velocity","activity_contraction","activity_shock","ledger_divergence"]).optional(),
  severity:z.enum(["info","warning","critical"]).optional(),
  resolved:z.enum(["true","false"]).transform((value)=>value==="true").optional(),
  snapshotId:z.string().uuid().optional()
});
const reasonSchema=z.object({reason:z.string().trim().min(10).max(1000)});
const computeSchema=z.object({day:z.coerce.date().optional(),toleranceMinor:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)});

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
