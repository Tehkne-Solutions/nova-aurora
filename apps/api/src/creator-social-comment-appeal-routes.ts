import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor, requireRole } from "./auth-context.js";

const economySql = db();

const reasonSchema = z.object({ reason: z.string().trim().min(10).max(1000) });
const decisionSchema = reasonSchema.extend({ outcome: z.enum(["upheld", "overturned"]) });
const queueQuery = z.object({
  status: z.enum(["pending", "in_review", "upheld", "overturned"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

export async function registerCreatorSocialCommentAppealRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { reportId: string } }>("/v1/creator-moderation/comment-reports/:reportId/appeal", async (request) => {
    const actor = await requireActor(app, request);
    const reportId = z.string().uuid().parse(request.params.reportId);
    const body = reasonSchema.parse(request.body);

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const report = (await tx`
        SELECT * FROM creator_economy_reports
        WHERE id=${reportId}::uuid AND resource_type='creator_comment'
        FOR UPDATE
      `)[0];
      if (!report) throw app.httpErrors.notFound("Denúncia de comentário não encontrada.");
      if (String(report.status) !== "resolved") {
        throw app.httpErrors.conflict("Somente uma restrição confirmada pode ser apelada.");
      }
      const restrictedAction = (await tx`
        SELECT * FROM creator_economy_moderation_actions
        WHERE report_id=${reportId}::uuid AND action='restricted'
        ORDER BY occurred_at DESC,id DESC LIMIT 1 FOR UPDATE
      `)[0];
      if (!restrictedAction) throw app.httpErrors.conflict("Restrição auditável não encontrada.");

      const commentId = String(report.resource_id);
      const comment = (await tx`
        SELECT id,author_user_id,status FROM creator_content_comments
        WHERE id=${commentId}::uuid FOR UPDATE
      `)[0];
      if (!comment) throw app.httpErrors.notFound("Comentário restringido não encontrado.");
      if (String(comment.author_user_id) !== actor.userId) {
        throw app.httpErrors.forbidden("Somente o autor do comentário pode apelar.");
      }
      if (String(comment.status) !== String(restrictedAction.next_status)) {
        throw app.httpErrors.conflict("O comentário mudou após a decisão; apelação automática bloqueada.");
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

  app.get("/v1/admin/creator-moderation/comment-appeals", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    const query = queueQuery.parse(request.query);
    const rows = await economySql`
      SELECT appeal.*,report.resource_id comment_id,report.category,report.priority,
        comment.author_user_id,comment.body comment_body,comment.status comment_status,
        restricted.actor_user_id original_moderator_user_id,
        restricted.previous_status restricted_previous_status,
        restricted.next_status restricted_next_status
      FROM creator_economy_appeals appeal
      JOIN creator_economy_reports report ON report.id=appeal.report_id
      JOIN creator_content_comments comment ON comment.id=report.resource_id
      JOIN creator_economy_moderation_actions restricted ON restricted.id=appeal.restricted_action_id
      WHERE report.resource_type='creator_comment'
        AND (${query.status ?? null}::text IS NULL OR appeal.status=${query.status ?? null})
      ORDER BY
        CASE report.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        appeal.created_at ASC,appeal.id ASC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return { appeals: rows, pagination: query, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { appealId: string } }>("/v1/admin/creator-moderation/comment-appeals/:appealId/decide", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const appealId = z.string().uuid().parse(request.params.appealId);
    const body = decisionSchema.parse(request.body);

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const row = (await tx`
        SELECT appeal.*,report.resource_id,
          restricted.actor_user_id original_moderator_user_id,
          restricted.previous_status restricted_previous_status,
          restricted.next_status restricted_next_status
        FROM creator_economy_appeals appeal
        JOIN creator_economy_reports report ON report.id=appeal.report_id
        JOIN creator_economy_moderation_actions restricted ON restricted.id=appeal.restricted_action_id
        WHERE appeal.id=${appealId}::uuid AND report.resource_type='creator_comment'
        FOR UPDATE OF appeal
      `)[0];
      if (!row) throw app.httpErrors.notFound("Apelação de comentário não encontrada.");
      if (String(row.status) !== "in_review") {
        throw app.httpErrors.conflict("Apelação precisa estar em revisão.");
      }
      if (String(row.reviewer_user_id ?? "") !== identity.userId) {
        throw app.httpErrors.conflict("A decisão deve ser feita pelo revisor responsável.");
      }
      if (String(row.original_moderator_user_id) === identity.userId) {
        throw app.httpErrors.forbidden("O moderador original não pode julgar a apelação.");
      }
      if (String(row.appellant_user_id) === identity.userId) {
        throw app.httpErrors.forbidden("O apelante não pode julgar a própria apelação.");
      }

      const commentId = String(row.resource_id);
      let restoration: { previousStatus: string; nextStatus: string } | null = null;
      if (body.outcome === "overturned") {
        const comment = (await tx`
          SELECT status FROM creator_content_comments WHERE id=${commentId}::uuid FOR UPDATE
        `)[0];
        if (!comment) throw app.httpErrors.notFound("Comentário restringido não encontrado.");
        const restrictedStatus = String(row.restricted_next_status);
        const restoreStatus = String(row.restricted_previous_status);
        if (String(comment.status) !== restrictedStatus) {
          throw app.httpErrors.conflict("O comentário mudou após a restrição; restauração automática bloqueada.");
        }
        if (restrictedStatus !== restoreStatus) {
          await tx`
            UPDATE creator_content_comments SET status=${restoreStatus},updated_at=now()
            WHERE id=${commentId}::uuid
          `;
        }
        restoration = { previousStatus: restrictedStatus, nextStatus: restoreStatus };
        await tx`
          INSERT INTO creator_economy_moderation_actions(
            id,report_id,resource_type,resource_id,actor_user_id,action,previous_status,next_status,reason
          ) VALUES(
            ${randomUUID()}::uuid,${String(row.report_id)}::uuid,'creator_comment',${commentId}::uuid,
            ${identity.userId}::uuid,'restored',${restrictedStatus},${restoreStatus},${body.reason}
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
        VALUES(${randomUUID()}::uuid,${appealId}::uuid,${identity.userId}::uuid,${body.outcome},${body.reason})
      `;
      return { appealId, outcome: body.outcome, restoration };
    });

    return { appeal: result, signature: "Tehkné Solutions" };
  });
}

// Tehkné Solutions
