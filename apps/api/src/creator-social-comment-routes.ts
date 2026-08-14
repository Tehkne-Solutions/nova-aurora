import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";

const economySql = db();

const commentSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0)
});

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
}

// Tehkné Solutions
