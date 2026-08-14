import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor, requireRole } from "./auth-context.js";

const economySql = db();

const commentSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0)
});

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
  category: categorySchema,
  reason: z.string().trim().min(10).max(1000)
});

const moderationReasonSchema = z.object({
  reason: z.string().trim().min(10).max(1000)
});

const moderationDecisionSchema = moderationReasonSchema.extend({
  outcome: z.enum(["dismissed", "restricted"])
});

const moderationQueueQuery = z.object({
  status: z.enum(["open", "in_review", "resolved", "dismissed"]).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

type Category = z.infer<typeof categorySchema>;

function priorityFor(category: Category): "low" | "medium" | "high" | "critical" {
  if (category === "illegal") return "critical";
  if (["fraud", "scam", "hate", "sexual", "violence"].includes(category)) return "high";
  if (["harassment", "ip", "misleading_ad", "unsafe_ugc"].includes(category)) return "medium";
  return "low";
}

async function activeContent(contentId: string) {
  return (await economySql`
    SELECT content.id,content.creator_user_id,content.status,channel.status channel_status
    FROM creator_content content
    JOIN creator_channels channel ON channel.id=content.channel_id
    WHERE content.id=${contentId}::uuid
  `)[0];
}

async function blockedBetween(firstUserId: string, secondUserId: string): Promise<boolean> {
  const row = (await economySql`
    SELECT 1
    FROM creator_user_blocks
    WHERE (blocker_user_id=${firstUserId}::uuid AND blocked_user_id=${secondUserId}::uuid)
       OR (blocker_user_id=${secondUserId}::uuid AND blocked_user_id=${firstUserId}::uuid)
    LIMIT 1
  `)[0];
  return Boolean(row);
}

export async function registerCreatorSocialCommentRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { contentId: string } }>("/v1/creator/content/:contentId/comments", async (request) => {
    const actor = await requireActor(app, request);
    const contentId = z.string().uuid().parse(request.params.contentId);
    const body = commentSchema.parse(request.body);
    const content = await activeContent(contentId);
    if (!content || String(content.status) !== "published" || String(content.channel_status) !== "active") {
      throw app.httpErrors.notFound("Conteúdo publicado e ativo não encontrado.");
    }
    const creatorUserId = String(content.creator_user_id);
    if (creatorUserId !== actor.userId && await blockedBetween(actor.userId, creatorUserId)) {
      throw app.httpErrors.forbidden("Interação indisponível entre estas contas.");
    }
    const id = randomUUID();
    const comment = (await economySql`
      INSERT INTO creator_content_comments(id,content_id,author_user_id,body)
      VALUES(${id}::uuid,${contentId}::uuid,${actor.userId}::uuid,${body.body})
      RETURNING id,content_id,author_user_id,body,status,created_at,updated_at
    `)[0];
    return { comment, signature: "Tehkné Solutions" };
  });

  app.get<{ Params: { contentId: string } }>("/v1/creator/content/:contentId/comments", async (request) => {
    const actor = await requireActor(app, request);
    const contentId = z.string().uuid().parse(request.params.contentId);
    const query = pageQuery.parse(request.query);
    const content = await activeContent(contentId);
    if (!content || String(content.status) !== "published" || String(content.channel_status) !== "active") {
      throw app.httpErrors.notFound("Conteúdo publicado e ativo não encontrado.");
    }
    const rows = await economySql`
      SELECT comment.id,comment.content_id,comment.author_user_id,comment.body,
        comment.created_at,comment.updated_at,user_account.display_name
      FROM creator_content_comments comment
      JOIN users user_account ON user_account.id=comment.author_user_id
      WHERE comment.content_id=${contentId}::uuid
        AND comment.status='active'
        AND NOT EXISTS (
          SELECT 1 FROM creator_user_blocks block
          WHERE (block.blocker_user_id=${actor.userId}::uuid AND block.blocked_user_id=comment.author_user_id)
             OR (block.blocker_user_id=comment.author_user_id AND block.blocked_user_id=${actor.userId}::uuid)
        )
      ORDER BY comment.created_at DESC,comment.id DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return {
      comments: rows.map((row) => ({
        id: String(row.id),
        contentId: String(row.content_id),
        author: {
          userId: String(row.author_user_id),
          displayName: String(row.display_name),
          ownedByRequester: String(row.author_user_id) === actor.userId
        },
        body: String(row.body),
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString()
      })),
      pagination: query,
      signature: "Tehkné Solutions"
    };
  });

  app.delete<{ Params: { commentId: string } }>("/v1/creator/comments/:commentId", async (request) => {
    const actor = await requireActor(app, request);
    const commentId = z.string().uuid().parse(request.params.commentId);
    const row = (await economySql`
      SELECT id,author_user_id,status FROM creator_content_comments WHERE id=${commentId}::uuid
    `)[0];
    if (!row) throw app.httpErrors.notFound("Comentário não encontrado.");
    if (String(row.author_user_id) !== actor.userId) {
      throw app.httpErrors.forbidden("Somente o autor pode remover o próprio comentário.");
    }
    if (String(row.status) === "deleted") {
      return { commentId, deleted: true, alreadyDeleted: true, signature: "Tehkné Solutions" };
    }
    await economySql`
      UPDATE creator_content_comments
      SET status='deleted',deleted_at=now(),updated_at=now()
      WHERE id=${commentId}::uuid
    `;
    return { commentId, deleted: true, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { commentId: string } }>("/v1/creator/comments/:commentId/report", async (request) => {
    const actor = await requireActor(app, request);
    const commentId = z.string().uuid().parse(request.params.commentId);
    const body = reportSchema.parse(request.body);
    const comment = (await economySql`
      SELECT id,author_user_id,status FROM creator_content_comments WHERE id=${commentId}::uuid
    `)[0];
    if (!comment || String(comment.status) !== "active") {
      throw app.httpErrors.notFound("Comentário ativo não encontrado.");
    }
    if (String(comment.author_user_id) === actor.userId) {
      throw app.httpErrors.badRequest("Não é possível denunciar o próprio comentário.");
    }
    const priority = priorityFor(body.category);
    const id = randomUUID();
    const inserted = (await economySql`
      INSERT INTO creator_economy_reports(
        id,reporter_user_id,resource_type,resource_id,category,priority,reason
      ) VALUES(
        ${id}::uuid,${actor.userId}::uuid,'creator_comment',${commentId}::uuid,
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
          id: String(inserted.id),
          status: String(inserted.status),
          priority: String(inserted.priority),
          createdAt: new Date(String(inserted.created_at)).toISOString()
        },
        signature: "Tehkné Solutions"
      };
    }
    const prior = (await economySql`
      SELECT id,status,priority,created_at
      FROM creator_economy_reports
      WHERE reporter_user_id=${actor.userId}::uuid
        AND resource_type='creator_comment'
        AND resource_id=${commentId}::uuid
        AND status IN ('open','in_review')
      ORDER BY created_at DESC LIMIT 1
    `)[0];
    return {
      report: {
        id: String(prior!.id),
        status: String(prior!.status),
        priority: String(prior!.priority),
        createdAt: new Date(String(prior!.created_at)).toISOString(),
        duplicateSuppressed: true
      },
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { userId: string } }>("/v1/creator/users/:userId/block", async (request) => {
    const actor = await requireActor(app, request);
    const userId = z.string().uuid().parse(request.params.userId);
    if (userId === actor.userId) throw app.httpErrors.badRequest("Não é possível bloquear a própria conta.");
    const target = (await economySql`SELECT id FROM users WHERE id=${userId}::uuid`)[0];
    if (!target) throw app.httpErrors.notFound("Usuário não encontrado.");
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const inserted = await tx`
        INSERT INTO creator_user_blocks(blocker_user_id,blocked_user_id)
        VALUES(${actor.userId}::uuid,${userId}::uuid)
        ON CONFLICT DO NOTHING
        RETURNING blocker_user_id
      `;
      await tx`
        DELETE FROM creator_channel_follows follow
        USING creator_channels channel
        WHERE follow.channel_id=channel.id
          AND (
            (follow.follower_user_id=${actor.userId}::uuid AND channel.creator_user_id=${userId}::uuid)
            OR
            (follow.follower_user_id=${userId}::uuid AND channel.creator_user_id=${actor.userId}::uuid)
          )
      `;
      return { blocked: true, changed: inserted.length > 0 };
    });
    return { userId, ...result, signature: "Tehkné Solutions" };
  });

  app.delete<{ Params: { userId: string } }>("/v1/creator/users/:userId/block", async (request) => {
    const actor = await requireActor(app, request);
    const userId = z.string().uuid().parse(request.params.userId);
    const deleted = await economySql`
      DELETE FROM creator_user_blocks
      WHERE blocker_user_id=${actor.userId}::uuid AND blocked_user_id=${userId}::uuid
      RETURNING blocker_user_id
    `;
    return {
      userId,
      blocked: false,
      changed: deleted.length > 0,
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/creator/blocks/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = pageQuery.parse(request.query);
    const rows = await economySql`
      SELECT block.blocked_user_id,user_account.display_name,block.created_at
      FROM creator_user_blocks block
      JOIN users user_account ON user_account.id=block.blocked_user_id
      WHERE block.blocker_user_id=${actor.userId}::uuid
      ORDER BY block.created_at DESC,block.blocked_user_id ASC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return {
      blockedUsers: rows.map((row) => ({
        userId: String(row.blocked_user_id),
        displayName: String(row.display_name),
        blockedAt: new Date(String(row.created_at)).toISOString()
      })),
      pagination: query,
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/admin/creator-moderation/comment-reports", async (request) => {
    await requireRole(app, request, ["platform-admin", "municipal-admin"]);
    const query = moderationQueueQuery.parse(request.query);
    const rows = await economySql`
      SELECT report.*,comment.content_id,comment.author_user_id,comment.body comment_body,comment.status comment_status
      FROM creator_economy_reports report
      JOIN creator_content_comments comment ON comment.id=report.resource_id
      WHERE report.resource_type='creator_comment'
        AND (${query.status ?? null}::text IS NULL OR report.status=${query.status ?? null})
        AND (${query.priority ?? null}::text IS NULL OR report.priority=${query.priority ?? null})
      ORDER BY
        CASE report.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        report.created_at ASC,report.id ASC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return { reports: rows, pagination: query, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { reportId: string } }>("/v1/admin/creator-moderation/comment-reports/:reportId/claim", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const reportId = z.string().uuid().parse(request.params.reportId);
    const body = moderationReasonSchema.parse(request.body);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const report = (await tx`
        SELECT * FROM creator_economy_reports
        WHERE id=${reportId}::uuid AND resource_type='creator_comment'
        FOR UPDATE
      `)[0];
      if (!report) throw app.httpErrors.notFound("Denúncia de comentário não encontrada.");
      if (!["open", "in_review"].includes(String(report.status))) {
        throw app.httpErrors.conflict("Denúncia já encerrada.");
      }
      if (report.assigned_to && String(report.assigned_to) !== identity.userId) {
        throw app.httpErrors.conflict("Denúncia já atribuída a outro moderador.");
      }
      if (String(report.assigned_to ?? "") === identity.userId && String(report.status) === "in_review") {
        return { reportId, status: "in_review" as const, claimed: false };
      }
      await tx`
        UPDATE creator_economy_reports
        SET status='in_review',assigned_to=${identity.userId}::uuid,updated_at=now()
        WHERE id=${reportId}::uuid
      `;
      await tx`
        INSERT INTO creator_economy_moderation_actions(
          id,report_id,resource_type,resource_id,actor_user_id,action,reason
        ) VALUES(
          ${randomUUID()}::uuid,${reportId}::uuid,'creator_comment',${String(report.resource_id)}::uuid,
          ${identity.userId}::uuid,'claimed',${body.reason}
        )
      `;
      return { reportId, status: "in_review" as const, claimed: true };
    });
    return { moderation: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { reportId: string } }>("/v1/admin/creator-moderation/comment-reports/:reportId/decide", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const reportId = z.string().uuid().parse(request.params.reportId);
    const body = moderationDecisionSchema.parse(request.body);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const report = (await tx`
        SELECT * FROM creator_economy_reports
        WHERE id=${reportId}::uuid AND resource_type='creator_comment'
        FOR UPDATE
      `)[0];
      if (!report) throw app.httpErrors.notFound("Denúncia de comentário não encontrada.");
      if (String(report.status) !== "in_review") {
        throw app.httpErrors.conflict("Denúncia precisa estar em revisão.");
      }
      if (String(report.assigned_to ?? "") !== identity.userId) {
        throw app.httpErrors.conflict("A decisão deve ser feita pelo moderador responsável.");
      }
      const commentId = String(report.resource_id);
      const comment = (await tx`
        SELECT status FROM creator_content_comments WHERE id=${commentId}::uuid FOR UPDATE
      `)[0];
      if (!comment) throw app.httpErrors.notFound("Comentário não encontrado.");
      const previousStatus = String(comment.status);
      const nextStatus = body.outcome === "restricted"
        ? (previousStatus === "deleted" ? "deleted" : "rejected")
        : previousStatus;
      if (body.outcome === "restricted" && previousStatus !== "deleted") {
        await tx`
          UPDATE creator_content_comments SET status='rejected',updated_at=now()
          WHERE id=${commentId}::uuid
        `;
      }
      const reportStatus = body.outcome === "restricted" ? "resolved" : "dismissed";
      const action = body.outcome === "restricted" ? "restricted" : "dismissed";
      await tx`
        UPDATE creator_economy_reports
        SET status=${reportStatus},updated_at=now(),resolved_at=now()
        WHERE id=${reportId}::uuid
      `;
      await tx`
        INSERT INTO creator_economy_moderation_actions(
          id,report_id,resource_type,resource_id,actor_user_id,action,previous_status,next_status,reason
        ) VALUES(
          ${randomUUID()}::uuid,${reportId}::uuid,'creator_comment',${commentId}::uuid,
          ${identity.userId}::uuid,${action},${previousStatus},${nextStatus},${body.reason}
        )
      `;
      return { reportId, status: reportStatus, action, previousStatus, nextStatus };
    });
    return { moderation: result, signature: "Tehkné Solutions" };
  });
}

// Tehkné Solutions
