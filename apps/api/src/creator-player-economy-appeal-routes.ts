import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor, requireRole } from "./auth-context.js";

const economySql = db();

const resourceTypeSchema = z.enum([
  "creator_content",
  "creator_channel",
  "creator_comment",
  "ugc_blueprint",
  "ad_campaign",
  "ad_surface",
  "competition"
]);
const reasonSchema = z.object({ reason: z.string().trim().min(10).max(1000) });
const decisionSchema = reasonSchema.extend({ outcome: z.enum(["upheld", "overturned"]) });
const queueQuery = z.object({
  status: z.enum(["pending", "in_review", "upheld", "overturned"]).optional(),
  resourceType: resourceTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

type ResourceType = z.infer<typeof resourceTypeSchema>;
type TransactionQueryable = Parameters<Parameters<typeof economySql.begin>[1]>[0];

type OwnerState = Readonly<{ ownerId: string | null; status: string }>;
type RestoreResult = Readonly<{
  previousStatus: string;
  nextStatus: string;
  followUp: "none" | "placements_require_reapproval";
}>;

async function ownerState(
  tx: TransactionQueryable,
  resourceType: ResourceType,
  resourceId: string
): Promise<OwnerState | null> {
  if (resourceType === "creator_content") {
    const row = (await tx`SELECT creator_user_id owner_id,status FROM creator_content WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
  }
  if (resourceType === "creator_comment") {
    const row = (await tx`SELECT author_user_id owner_id,status FROM creator_content_comments WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
  }
  if (resourceType === "creator_channel") {
    const row = (await tx`SELECT creator_user_id owner_id,status FROM creator_channels WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
  }
  if (resourceType === "ugc_blueprint") {
    const row = (await tx`SELECT creator_user_id owner_id,status FROM ugc_object_blueprints WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
  }
  if (resourceType === "ad_campaign") {
    const row = (await tx`SELECT advertiser_user_id owner_id,status FROM economy_ad_campaigns WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    return row ? { ownerId: row.owner_id ? String(row.owner_id) : null, status: String(row.status) } : null;
  }
  if (resourceType === "ad_surface") {
    const row = (await tx`SELECT owner_user_id owner_id,status FROM economy_ad_surfaces WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
    return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
  }
  const row = (await tx`SELECT organizer_user_id owner_id,status FROM player_competitions WHERE id=${resourceId}::uuid FOR UPDATE`)[0];
  return row ? { ownerId: String(row.owner_id), status: String(row.status) } : null;
}

async function restoreResource(
  tx: TransactionQueryable,
  resourceType: ResourceType,
  resourceId: string,
  restrictedStatus: string,
  restoreStatus: string
): Promise<RestoreResult> {
  const current = await ownerState(tx, resourceType, resourceId);
  if (!current) throw new Error("Recurso da apelação não encontrado.");
  if (current.status !== restrictedStatus) {
    throw new Error("O recurso mudou após a restrição; restauração automática bloqueada.");
  }

  if (resourceType === "creator_content") {
    await tx`UPDATE creator_content SET status=${restoreStatus},updated_at=now() WHERE id=${resourceId}::uuid`;
    return { previousStatus: restrictedStatus, nextStatus: restoreStatus, followUp: "none" };
  }
  if (resourceType === "creator_comment") {
    await tx`UPDATE creator_content_comments SET status=${restoreStatus},updated_at=now() WHERE id=${resourceId}::uuid`;
    return { previousStatus: restrictedStatus, nextStatus: restoreStatus, followUp: "none" };
  }
  if (resourceType === "creator_channel") {
    await tx`UPDATE creator_channels SET status=${restoreStatus},updated_at=now() WHERE id=${resourceId}::uuid`;
    return { previousStatus: restrictedStatus, nextStatus: restoreStatus, followUp: "none" };
  }
  if (resourceType === "ugc_blueprint") {
    await tx`UPDATE ugc_object_blueprints SET status=${restoreStatus},updated_at=now() WHERE id=${resourceId}::uuid`;
    return { previousStatus: restrictedStatus, nextStatus: restoreStatus, followUp: "none" };
  }
  if (resourceType === "ad_campaign") {
    await tx`UPDATE economy_ad_campaigns SET status=${restoreStatus},updated_at=now() WHERE id=${resourceId}::uuid`;
    return {
      previousStatus: restrictedStatus,
      nextStatus: restoreStatus,
      followUp: "placements_require_reapproval"
    };
  }
  if (resourceType === "ad_surface") {
    await tx`
      UPDATE economy_ad_surfaces
      SET status=${restoreStatus},moderation_status='approved',updated_at=now()
      WHERE id=${resourceId}::uuid
    `;
    return {
      previousStatus: restrictedStatus,
      nextStatus: restoreStatus,
      followUp: "placements_require_reapproval"
    };
  }
  await tx`UPDATE player_competitions SET status=${restoreStatus},updated_at=now() WHERE id=${resourceId}::uuid`;
  return { previousStatus: restrictedStatus, nextStatus: restoreStatus, followUp: "none" };
}

export async function registerCreatorPlayerEconomyAppealRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { reportId: string } }>("/v1/creator-moderation/reports/:reportId/appeal", async (request) => {
    const actor = await requireActor(app, request);
    const reportId = z.string().uuid().parse(request.params.reportId);
    const body = reasonSchema.parse(request.body);

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const report = (await tx`
        SELECT * FROM creator_economy_reports WHERE id=${reportId}::uuid FOR UPDATE
      `)[0];
      if (!report) throw app.httpErrors.notFound("Denúncia não encontrada.");
      if (String(report.status) !== "resolved") {
        throw app.httpErrors.conflict("Somente uma restrição confirmada pode ser apelada.");
      }
      const restrictedAction = (await tx`
        SELECT * FROM creator_economy_moderation_actions
        WHERE report_id=${reportId}::uuid AND action='restricted'
        ORDER BY occurred_at DESC,id DESC LIMIT 1 FOR UPDATE
      `)[0];
      if (!restrictedAction) throw app.httpErrors.conflict("Restrição auditável não encontrada.");

      const resourceType = resourceTypeSchema.parse(String(report.resource_type));
      const resourceId = String(report.resource_id);
      const resource = await ownerState(tx, resourceType, resourceId);
      if (!resource) throw app.httpErrors.notFound("Recurso restringido não encontrado.");
      if (resource.ownerId !== actor.userId) {
        throw app.httpErrors.forbidden("Somente o proprietário atual do recurso pode apelar.");
      }
      if (resource.status !== String(restrictedAction.next_status)) {
        throw app.httpErrors.conflict("O recurso mudou após a decisão; apelação automática bloqueada.");
      }

      const existing = (await tx`
        SELECT * FROM creator_economy_appeals WHERE report_id=${reportId}::uuid
      `)[0];
      if (existing) {
        return {
          id: String(existing.id),
          status: String(existing.status),
          createdAt: new Date(String(existing.created_at)).toISOString(),
          duplicateSuppressed: true
        };
      }

      const appealId = randomUUID();
      const appeal = (await tx`
        INSERT INTO creator_economy_appeals(
          id,report_id,restricted_action_id,appellant_user_id,reason
        ) VALUES(
          ${appealId}::uuid,${reportId}::uuid,${String(restrictedAction.id)}::uuid,
          ${actor.userId}::uuid,${body.reason}
        ) RETURNING *
      `)[0]!;
      await tx`
        INSERT INTO creator_economy_appeal_actions(id,appeal_id,actor_user_id,action,reason)
        VALUES(${randomUUID()}::uuid,${appealId}::uuid,${actor.userId}::uuid,'filed',${body.reason})
      `;
      return {
        id: appealId,
        status: String(appeal.status),
        createdAt: new Date(String(appeal.created_at)).toISOString(),
        duplicateSuppressed: false
      };
    });

    return { appeal: result, signature: "Tehkné Solutions" };
  });

  app.get("/v1/creator-moderation/appeals/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = historyQuery.parse(request.query);
    const rows = await economySql`
      SELECT appeal.id,appeal.report_id,appeal.reason,appeal.status,appeal.decision_reason,
        appeal.created_at,appeal.updated_at,appeal.resolved_at,
        report.resource_type,report.resource_id,report.category,report.priority
      FROM creator_economy_appeals appeal
      JOIN creator_economy_reports report ON report.id=appeal.report_id
      WHERE appeal.appellant_user_id=${actor.userId}::uuid
      ORDER BY appeal.created_at DESC,appeal.id DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return { appeals: rows, pagination: query, signature: "Tehkné Solutions" };
  });

  app.get("/v1/admin/creator-moderation/appeals", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    const query = queueQuery.parse(request.query);
    const rows = await economySql`
      SELECT appeal.*,report.resource_type,report.resource_id,report.category,report.priority,
        restricted.actor_user_id original_moderator_user_id,
        restricted.previous_status restricted_previous_status,
        restricted.next_status restricted_next_status
      FROM creator_economy_appeals appeal
      JOIN creator_economy_reports report ON report.id=appeal.report_id
      JOIN creator_economy_moderation_actions restricted ON restricted.id=appeal.restricted_action_id
      WHERE (${query.status ?? null}::text IS NULL OR appeal.status=${query.status ?? null})
        AND (${query.resourceType ?? null}::text IS NULL OR report.resource_type=${query.resourceType ?? null})
      ORDER BY
        CASE report.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        appeal.created_at ASC,appeal.id ASC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return { appeals: rows, pagination: query, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { appealId: string } }>("/v1/admin/creator-moderation/appeals/:appealId/claim", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const appealId = z.string().uuid().parse(request.params.appealId);
    const body = reasonSchema.parse(request.body);

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const row = (await tx`
        SELECT appeal.*,restricted.actor_user_id original_moderator_user_id
        FROM creator_economy_appeals appeal
        JOIN creator_economy_moderation_actions restricted ON restricted.id=appeal.restricted_action_id
        WHERE appeal.id=${appealId}::uuid
        FOR UPDATE OF appeal
      `)[0];
      if (!row) throw app.httpErrors.notFound("Apelação não encontrada.");
      if (!["pending", "in_review"].includes(String(row.status))) {
        throw app.httpErrors.conflict("Apelação já encerrada.");
      }
      if (String(row.appellant_user_id) === identity.userId) {
        throw app.httpErrors.forbidden("O apelante não pode revisar a própria apelação.");
      }
      if (String(row.original_moderator_user_id) === identity.userId) {
        throw app.httpErrors.forbidden("O moderador original não pode revisar a apelação.");
      }
      if (row.reviewer_user_id && String(row.reviewer_user_id) !== identity.userId) {
        throw app.httpErrors.conflict("Apelação já atribuída a outro revisor.");
      }
      if (String(row.reviewer_user_id ?? "") === identity.userId && String(row.status) === "in_review") {
        return { appealId, status: "in_review" as const, claimed: false };
      }
      await tx`
        UPDATE creator_economy_appeals
        SET status='in_review',reviewer_user_id=${identity.userId}::uuid,updated_at=now()
        WHERE id=${appealId}::uuid
      `;
      await tx`
        INSERT INTO creator_economy_appeal_actions(id,appeal_id,actor_user_id,action,reason)
        VALUES(${randomUUID()}::uuid,${appealId}::uuid,${identity.userId}::uuid,'claimed',${body.reason})
      `;
      return { appealId, status: "in_review" as const, claimed: true };
    });

    return { appeal: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { appealId: string } }>("/v1/admin/creator-moderation/appeals/:appealId/decide", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const appealId = z.string().uuid().parse(request.params.appealId);
    const body = decisionSchema.parse(request.body);

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const row = (await tx`
        SELECT appeal.*,report.resource_type,report.resource_id,
          restricted.actor_user_id original_moderator_user_id,
          restricted.previous_status restricted_previous_status,
          restricted.next_status restricted_next_status
        FROM creator_economy_appeals appeal
        JOIN creator_economy_reports report ON report.id=appeal.report_id
        JOIN creator_economy_moderation_actions restricted ON restricted.id=appeal.restricted_action_id
        WHERE appeal.id=${appealId}::uuid
        FOR UPDATE OF appeal
      `)[0];
      if (!row) throw app.httpErrors.notFound("Apelação não encontrada.");
      if (String(row.status) !== "in_review") throw app.httpErrors.conflict("Apelação precisa estar em revisão.");
      if (String(row.reviewer_user_id ?? "") !== identity.userId) {
        throw app.httpErrors.conflict("A decisão deve ser feita pelo revisor responsável.");
      }
      if (String(row.original_moderator_user_id) === identity.userId) {
        throw app.httpErrors.forbidden("O moderador original não pode julgar a apelação.");
      }
      if (String(row.appellant_user_id) === identity.userId) {
        throw app.httpErrors.forbidden("O apelante não pode julgar a própria apelação.");
      }

      const resourceType = resourceTypeSchema.parse(String(row.resource_type));
      const resourceId = String(row.resource_id);
      let restoration: RestoreResult | null = null;
      if (body.outcome === "overturned") {
        restoration = await restoreResource(
          tx,
          resourceType,
          resourceId,
          String(row.restricted_next_status),
          String(row.restricted_previous_status)
        );
        await tx`
          INSERT INTO creator_economy_moderation_actions(
            id,report_id,resource_type,resource_id,actor_user_id,action,previous_status,next_status,reason
          ) VALUES(
            ${randomUUID()}::uuid,${String(row.report_id)}::uuid,${resourceType},${resourceId}::uuid,
            ${identity.userId}::uuid,'restored',${restoration.previousStatus},${restoration.nextStatus},${body.reason}
          )
        `;
      }

      await tx`
        UPDATE creator_economy_appeals
        SET status=${body.outcome},decision_reason=${body.reason},updated_at=now(),resolved_at=now()
        WHERE id=${appealId}::uuid
      `;
      await tx`
        INSERT INTO creator_economy_appeal_actions(id,appeal_id,actor_user_id,action,reason)
        VALUES(
          ${randomUUID()}::uuid,${appealId}::uuid,${identity.userId}::uuid,${body.outcome},${body.reason}
        )
      `;
      return { appealId, outcome: body.outcome, restoration };
    });

    return { appeal: result, signature: "Tehkné Solutions" };
  });

  app.get<{ Params: { appealId: string } }>("/v1/admin/creator-moderation/appeals/:appealId/history", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    const appealId = z.string().uuid().parse(request.params.appealId);
    const query = historyQuery.parse(request.query);
    const appeal = (await economySql`SELECT id FROM creator_economy_appeals WHERE id=${appealId}::uuid`)[0];
    if (!appeal) throw app.httpErrors.notFound("Apelação não encontrada.");
    const rows = await economySql`
      SELECT id,actor_user_id,action,reason,occurred_at
      FROM creator_economy_appeal_actions
      WHERE appeal_id=${appealId}::uuid
      ORDER BY occurred_at ASC,id ASC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return { actions: rows, pagination: query, signature: "Tehkné Solutions" };
  });
}

// Tehkné Solutions