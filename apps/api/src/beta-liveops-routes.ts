import type { FastifyInstance,FastifyRequest } from "fastify";
import { z } from "zod";
import { BetaLiveOpsService } from "@nova-aurora/database";
import { requireRole } from "./auth-context.js";

const liveOps=new BetaLiveOpsService();

function idempotencyKey(app:FastifyInstance,request:FastifyRequest):string {
  const value=request.headers["idempotency-key"];
  if (typeof value!=="string" || value.length<8 || value.length>160) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return value;
}

const eventSchema=z.object({
  eventKey:z.string().regex(/^[a-z0-9][a-z0-9._-]{2,119}$/),
  experimentId:z.string().uuid().optional(),
  eventType:z.enum([
    "experiment-start","experiment-review","experiment-pause","experiment-complete",
    "communication","maintenance","incident"
  ]),
  title:z.string().min(3).max(180),description:z.string().min(3).max(8000),
  status:z.enum(["scheduled","active","completed","cancelled"]).optional(),
  startsAt:z.string().datetime(),endsAt:z.string().datetime().optional(),
  severity:z.enum(["info","success","warning","critical"])
}).refine((value)=>!value.endsAt || new Date(value.endsAt)>new Date(value.startsAt),{
  message:"endsAt deve ser posterior a startsAt.",path:["endsAt"]
});
const statusSchema=z.object({
  status:z.enum(["active","completed","cancelled"]),reason:z.string().min(3).max(2000)
});
const calendarQuery=z.object({from:z.string().datetime().optional(),to:z.string().datetime().optional()});

export async function registerBetaLiveOpsRoutes(app:FastifyInstance):Promise<void> {
  app.get("/v1/beta-liveops/admin/state",async (request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    return {...await liveOps.adminState(),signature:"Tehkné Solutions"};
  });

  app.get("/v1/beta-liveops/calendar",async (request)=>{
    await requireRole(app,request,["platform-admin","municipal-admin"]);
    const query=calendarQuery.parse(request.query);
    return {
      events:await liveOps.calendar({
        ...(query.from===undefined?{}:{from:query.from}),
        ...(query.to===undefined?{}:{to:query.to})
      }),
      signature:"Tehkné Solutions"
    };
  });

  app.get<{Params:{experimentId:string}}>(
    "/v1/beta-liveops/experiments/:experimentId/timeline",async (request)=>{
      await requireRole(app,request,["platform-admin","municipal-admin"]);
      return {
        timeline:await liveOps.experimentTimeline(request.params.experimentId),
        signature:"Tehkné Solutions"
      };
    }
  );

  app.post("/v1/beta-liveops/events",async (request)=>{
    const identity=await requireRole(app,request,["platform-admin"]);
    const body=eventSchema.parse(request.body);
    const event=await liveOps.createEvent({
      actorId:identity.userId,idempotencyKey:idempotencyKey(app,request),
      eventKey:body.eventKey,eventType:body.eventType,title:body.title,
      description:body.description,startsAt:body.startsAt,severity:body.severity,
      ...(body.experimentId===undefined?{}:{experimentId:body.experimentId}),
      ...(body.status===undefined?{}:{status:body.status}),
      ...(body.endsAt===undefined?{}:{endsAt:body.endsAt})
    });
    return {event,signature:"Tehkné Solutions"};
  });

  app.post<{Params:{eventId:string}}>(
    "/v1/beta-liveops/events/:eventId/status",async (request,reply)=>{
      const identity=await requireRole(app,request,["platform-admin"]);
      const body=statusSchema.parse(request.body);
      await liveOps.updateStatus({
        actorId:identity.userId,eventId:request.params.eventId,
        status:body.status,reason:body.reason
      });
      return reply.status(204).send();
    }
  );
}

// Tehkné Solutions