import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor, requireRole } from "./auth-context.js";

const economySql = db();

const resourceTypeSchema = z.enum([
  "creator_content",
  "creator_channel",
  "ugc_blueprint",
  "ad_campaign",
  "ad_surface",
  "competition"
]);
const categorySchema = z.enum([
  "spam",
  "fraud",
  "scam",
  "harassment",
  "hate",
  "sexual",
  "violence",
  "illegal",
  "ip",
  "misleading_ad",
  "unsafe_ugc",
  "other"
]);
const reportSchema = z.object({
  resourceType: resourceTypeSchema,
  resourceId: z.string().uuid(),
  category: categorySchema,
  reason: z.string().trim().min(10).max(1000)
});
const reasonSchema = z.object({ reason: z.string().trim().min(10).max(1000) });
const decisionSchema = reasonSchema.extend({ outcome: z.enum(["dismissed", "restricted"]) });
const queueQuery = z.object({
  status: z.enum(["open", "in_review", "resolved", "dismissed"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  resourceType: resourceTypeSchema.optional(),
  category: categorySchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

type ResourceType = z.infer<typeof resourceTypeSchema>;
type Category = z.infer<typeof categorySchema>;
type Queryable = ReturnType<typeof db>;
type TransactionQueryable = Parameters<Parameters<typeof economySql.begin>[1]>[0];

type ResourceState = Readonly<{
  ownerId: string | null;
  status: string;
}>;

function priorityFor(category: Category): "low" | "medium" | "high" | "critical" {
  if (category === "illegal") return "critical";
  if (["fraud", "scam", "hate", "sexual", "violence"].includes(category)) return "high";
  if (["harassment", "ip", "misleading_ad", "unsafe_ugc"].includes(category)) return "medium";
  return "low";
}

async function resourceState(sql: Queryable, resourceType: ResourceType, resourceId: string): Promise<ResourceState | null> {
  if (resourceType === "creator_content") {
    const row = (await sql`SELECT creator_user_id owner_id,status FROM creator_content WHERE id=${resourceId}::uuid`)[0];
    return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
  }
  if (resourceType === "creator_channel") {
    const row = (await sql`SELECT creator_user_id owner_id,status FROM creator_channels WHERE id=${resourceId}::uuid`)[0];
    return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
  }
  if (resourceType === "ugc_blueprint") {
    const row = (await sql`SELECT creator_user_id owner_id,status FROM ugc_object_blueprints WHERE id=${resourceId}::uuid`)[0];
    return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
  }
  if (resourceType === "ad_campaign") {
    const row = (await sql`SELECT advertiser_user_id owner_id,status FROM economy_ad_campaigns WHERE id=${resourceId}::uuid`)[0];
    return row ? { ownerId: row.owner_id ? String(row.owner_id) : null, status: String(row.status) } : null;
  }
  if (resourceType === "ad_surface") {
    const row = (await sql`SELECT owner_user_id owner_id,status FROM economy_ad_surfaces WHERE id=${resourceId}::uuid`)[0];
    return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
  }
  const row = (await sql`SELECT organizer_user_id owner_id,status FROM player_competitions WHERE id=${resourceId}::uuid`)[0];
  return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
}

async function restrictResource(
  tx: TransactionQueryable,
  resourceType: ResourceType,
  resourceId: string
): Promise<{ previousStatus: string; nextStatus: string }> {
  if (resourceType === "creator_content") {
    const row = (await tx`SELECT status FROM creator_content WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    if (!row) throw new Error("Conteúdo não encontrado.");
    const previousStatus = String(row.status);
    await tx`UPDATE creator_content SET status='rejected',updated_at=now() WHERE id=${resourceId}::uuid`;
    return { previousStatus, nextStatus: "rejected" };
  }
  if (resourceType === "creator_channel") {
    const row = (await tx`SELECT status FROM creator_channels WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    if (!row) throw new Error("Canal não encontrado.");
    const previousStatus = String(row.status);
    await tx`UPDATE creator_channels SET status='paused',updated_at=now() WHERE id=${resourceId}::uuid`;
    return { previousStatus, nextStatus: "paused" };
  }
  if (resourceType === "ugc_blueprint") {
    const row = (await tx`SELECT status FROM ugc_object_blueprints WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    if (!row) throw new Error("Blueprint não encontrado.");
    const previousStatus = String(row.status);
    await tx`UPDATE ugc_object_blueprints SET status='rejected',updated_at=now() WHERE id=${resourceId}::uuid`;
    return { previousStatus, nextStatus: "rejected" };
  }
  if (resourceType === "ad_campaign") {
    const row = (await tx`SELECT status FROM economy_ad_campaigns WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    if (!row) throw new Error("Campanha não encontrada.");
    const previousStatus = String(row.status);
    await tx`UPDATE economy_ad_campaigns SET status='rejected',updated_at=now() WHERE id=${resourceId}::uuid`;
    await tx`UPDATE economy_ad_placements SET status='rejected',updated_at=now() WHERE campaign_id=${resourceId}::uuid AND status NOT IN ('ended','rejected')`;
    return { previousStatus, nextStatus: "rejected" };
  }
  if (resourceType === "ad_surface") {
    const row = (await tx`SELECT status FROM economy_ad_surfaces WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    if (!row) throw new Error("Superfície não encontrada.");
    const previousStatus = String(row.status);
    await tx`UPDATE economy_ad_surfaces SET status='paused',moderation_status='rejected',updated_at=now() WHERE id=${resourceId}::uuid`;
    await tx`UPDATE economy_ad_placements SET status='paused',updated_at=now() WHERE surface_id=${resourceId}::uuid AND status='active'`;
    return { previousStatus, nextStatus: "paused" };
  }
  const row = (await tx`SELECT status FROM player_competitions WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
  if (!row) throw new Error("Competição não encontrada.");
  const previousStatus = String(row.status);
  if (previousStatus === "settled") throw new Error("Competição já liquidada não pode ser cancelada por moderação.");
  await tx`UPDATE player_competitions SET status='cancelled',updated_at=now() WHERE id=${resourceId}::uuid`;
  return { previousStatus, nextStatus: "cancelled" };
}

export async function registerCreatorPlayerEconomyModerationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/creator-moderation/reports", async (request) => {
    const actor = await requireActor(app, request);
    const body = reportSchema.parse(request.body);
    const resource = await resourceState(economySql, body.resourceType, body.resourceId);
    if (!resource) throw app.httpErrors.notFound("Recurso reportado não encontrado.");
    if (resource.ownerId === actor.userId) throw app.httpErrors.badRequest("Não é possível denunciar o próprio recurso.");
    const priority = priorityFor(body.category);
    const id = randomUUID();
    const inserted = (await economySql`
      INSERT INTO creator_economy_reports(
        id,reporter_user_id,resource_type,resource_id,category,priority,reason
      ) VALUES(
        ${id}::uuid,${actor.userId}::uuid,${body.resourceType},${body.resourceId}::uuid,
        ${body.category},${priority},${body.reason}
      )
      ON CONFLICT(reporter_user_id,resource_type,resource_id)
        WHERE status IN ('open','in_review')
      DO NOTHING
      RETURNING id,status,priority,created_at
    `)[0];
    if (inserted) {
      return {
        report: {
          id: String(inserted.id), status: String(inserted.status), priority: String(inserted.priority),
          createdAt: new Date(String(inserted.created_at)).toISOString()
        },
        signature: "Tehkné Solutions"
      };
    }
    const prior = (await economySql`
      SELECT id,status,priority,created_at FROM creator_economy_reports
      WHERE reporter_user_id=${actor.userId}::uuid AND resource_type=${body.resourceType}
        AND resource_id=${body.resourceId}::uuid AND status IN ('open','in_review')
      ORDER BY created_at DESC LIMIT 1
    `)[0];
    return {
      report: {
        id: String(prior!.id), status: String(prior!.status), priority: String(prior!.priority),
        createdAt: new Date(String(prior!.created_at)).toISOString(), duplicateSuppressed: true
      },
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/creator-moderation/reports/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = historyQuery.parse(request.query);
    const rows = await economySql`
      SELECT id,resource_type,resource_id,category,priority,reason,status,created_at,updated_at,resolved_at
      FROM creator_economy_reports
      WHERE reporter_user_id=${actor.userId}::uuid
      ORDER BY created_at DESC,id DESC LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return { reports: rows, pagination: query, signature: "Tehkné Solutions" };
  });

  app.get("/v1/admin/creator-moderation/reports", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    const query = queueQuery.parse(request.query);
    const rows = await economySql`
      SELECT * FROM creator_economy_reports
      WHERE (${query.status ?? null}::text IS NULL OR status=${query.status ?? null})
        AND (${query.priority ?? null}::text IS NULL OR priority=${query.priority ?? null})
        AND (${query.resourceType ?? null}::text IS NULL OR resource_type=${query.resourceType ?? null})
        AND (${query.category ?? null}::text IS NULL OR category=${query.category ?? null})
      ORDER BY
        CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        created_at ASC,id ASC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return { reports: rows, pagination: query, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { reportId: string } }>("/v1/admin/creator-moderation/reports/:reportId/claim", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const reportId = z.string().uuid().parse(request.params.reportId);
    const body = reasonSchema.parse(request.body);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const report = (await tx`SELECT * FROM creator_economy_reports WHERE id=${reportId}::uuid FOR UPDATE`)[0];
      if (!report) throw app.httpErrors.notFound("Denúncia não encontrada.");
      if (!["open", "in_review"].includes(String(report.status))) throw app.httpErrors.conflict("Denúncia já encerrada.");
      if (report.assigned_to && String(report.assigned_to) !== identity.userId) {
        throw app.httpErrors.conflict("Denúncia já atribuída a outro moderador.");
      }
      if (String(report.assigned_to ?? "") === identity.userId && String(report.status) === "in_review") {
        return { reportId, status: "in_review" as const, claimed: false };
      }
      await tx`
        UPDATE creator_economy_reports SET status='in_review',assigned_to=${identity.userId}::uuid,updated_at=now()
        WHERE id=${reportId}::uuid
      `;
      await tx`
        INSERT INTO creator_economy_moderation_actions(
          id,report_id,resource_type,resource_id,actor_user_id,action,reason
        ) VALUES(
          ${randomUUID()}::uuid,${reportId}::uuid,${String(report.resource_type)},${String(report.resource_id)}::uuid,
          ${identity.userId}::uuid,'claimed',${body.reason}
        )
      `;
      return { reportId, status: "in_review" as const, claimed: true };
    });
    return { moderation: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { reportId: string } }>("/v1/admin/creator-moderation/reports/:reportId/decide", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const reportId = z.string().uuid().parse(request.params.reportId);
    const body = decisionSchema.parse(request.body);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const report = (await tx`SELECT * FROM creator_economy_reports WHERE id=${reportId}::uuid FOR UPDATE`)[0];
      if (!report) throw app.httpErrors.notFound("Denúncia não encontrada.");
      if (String(report.status) !== "in_review") throw app.httpErrors.conflict("Denúncia precisa estar em revisão.");
      if (String(report.assigned_to ?? "") !== identity.userId) {
        throw app.httpErrors.conflict("A decisão deve ser feita pelo moderador responsável.");
      }
      const resourceType = resourceTypeSchema.parse(String(report.resource_type));
      const resourceId = String(report.resource_id);
      let previousStatus: string | null = null;
      let nextStatus: string | null = null;
      let action: "dismissed" | "restricted" = "dismissed";
      if (body.outcome === "restricted") {
        const transition = await restrictResource(tx, resourceType, resourceId);
        previousStatus = transition.previousStatus;
        nextStatus = transition.nextStatus;
        action = "restricted";
      }
      const reportStatus = body.outcome === "restricted" ? "resolved" : "dismissed";
      await tx`
        UPDATE creator_economy_reports
        SET status=${reportStatus},updated_at=now(),resolved_at=now()
        WHERE id=${reportId}::uuid
      `;
      await tx`
        INSERT INTO creator_economy_moderation_actions(
          id,report_id,resource_type,resource_id,actor_user_id,action,previous_status,next_status,reason
        ) VALUES(
          ${randomUUID()}::uuid,${reportId}::uuid,${resourceType},${resourceId}::uuid,
          ${identity.userId}::uuid,${action},${previousStatus},${nextStatus},${body.reason}
        )
      `;
      return { reportId, status: reportStatus, action, previousStatus, nextStatus };
    });
    return { moderation: result, signature: "Tehkné Solutions" };
  });

  app.get<{ Params: { reportId: string } }>("/v1/admin/creator-moderation/reports/:reportId/history", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    const reportId = z.string().uuid().parse(request.params.reportId);
    const query = historyQuery.parse(request.query);
    const report = (await economySql`SELECT id FROM creator_economy_reports WHERE id=${reportId}::uuid`)[0];
    if (!report) throw app.httpErrors.notFound("Denúncia não encontrada.");
    const rows = await economySql`
      SELECT id,action,actor_user_id,previous_status,next_status,reason,occurred_at
      FROM creator_economy_moderation_actions WHERE report_id=${reportId}::uuid
      ORDER BY occurred_at ASC,id ASC LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return { actions: rows, pagination: query, signature: "Tehkné Solutions" };
  });
}

// Tehkné Solutions