import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor, requireRole } from "./auth-context.js";

const economySql = db();

type Queryable = (strings: TemplateStringsArray, ...values: any[]) => any;

const requestSchema = z.object({
  userId: z.string().uuid(),
  message: z.string().trim().min(1).max(1000)
});
const messageSchema = z.object({ body: z.string().trim().min(1).max(2000) });
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0)
});
const categorySchema = z.enum([
  "spam","fraud","scam","harassment","hate","sexual","violence","illegal","ip","other"
]);
const reportSchema = z.object({
  category: categorySchema,
  reason: z.string().trim().min(10).max(1000)
});
const accessSchema = z.object({ reason: z.string().trim().min(10).max(1000) });

type Category = z.infer<typeof categorySchema>;

function priorityFor(category: Category): "low" | "medium" | "high" | "critical" {
  if (category === "illegal") return "critical";
  if (["fraud","scam","hate","sexual","violence"].includes(category)) return "high";
  if (["harassment","ip"].includes(category)) return "medium";
  return "low";
}

function canonicalPair(first: string, second: string): readonly [string, string] {
  return first < second ? [first, second] : [second, first];
}

function isParticipant(row: Record<string, unknown>, userId: string): boolean {
  return String(row.user_low_id) === userId || String(row.user_high_id) === userId;
}

function otherParticipant(row: Record<string, unknown>, userId: string): string {
  return String(row.user_low_id) === userId ? String(row.user_high_id) : String(row.user_low_id);
}

async function blockedBetween(sql: Queryable, firstUserId: string, secondUserId: string): Promise<boolean> {
  const row = (await sql`
    SELECT 1 FROM creator_user_blocks
    WHERE (blocker_user_id=${firstUserId}::uuid AND blocked_user_id=${secondUserId}::uuid)
       OR (blocker_user_id=${secondUserId}::uuid AND blocked_user_id=${firstUserId}::uuid)
    LIMIT 1
  `)[0];
  return Boolean(row);
}

function messageBody(row: Record<string, unknown>): string | null {
  return String(row.status) === "active" ? String(row.body) : null;
}

function removedReason(row: Record<string, unknown>): "sender_deleted" | "moderation" | null {
  if (String(row.status) === "deleted") return "sender_deleted";
  if (String(row.status) === "rejected") return "moderation";
  return null;
}

export async function registerCreatorPrivateMessageRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/creator/dm/requests", async (request) => {
    const actor = await requireActor(app, request);
    const body = requestSchema.parse(request.body);
    if (body.userId === actor.userId) throw app.httpErrors.badRequest("Não é possível iniciar conversa consigo mesmo.");

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const target = (await tx`SELECT id,display_name FROM users WHERE id=${body.userId}::uuid`)[0];
      if (!target) throw app.httpErrors.notFound("Usuário não encontrado.");
      if (await blockedBetween(tx, actor.userId, body.userId)) {
        throw app.httpErrors.forbidden("Nova conversa indisponível entre estas contas.");
      }

      const [lowId, highId] = canonicalPair(actor.userId, body.userId);
      let thread = (await tx`
        SELECT * FROM creator_dm_threads
        WHERE user_low_id=${lowId}::uuid AND user_high_id=${highId}::uuid
        FOR UPDATE
      `)[0];

      if (thread && String(thread.status) === "active") {
        return { threadId: String(thread.id), status: "active", created: false, duplicateSuppressed: true };
      }
      if (thread && String(thread.status) === "pending") {
        if (String(thread.requested_by_user_id) === actor.userId) {
          return { threadId: String(thread.id), status: "pending", created: false, duplicateSuppressed: true };
        }
        throw app.httpErrors.conflict("Já existe um pedido pendente desta pessoa para você.");
      }

      const threadId = thread ? String(thread.id) : randomUUID();
      if (thread) {
        thread = (await tx`
          UPDATE creator_dm_threads
          SET requested_by_user_id=${actor.userId}::uuid,status='pending',requested_at=now(),
            accepted_at=NULL,declined_at=NULL,closed_at=NULL,updated_at=now()
          WHERE id=${threadId}::uuid
          RETURNING *
        `)[0];
      } else {
        thread = (await tx`
          INSERT INTO creator_dm_threads(id,user_low_id,user_high_id,requested_by_user_id)
          VALUES(${threadId}::uuid,${lowId}::uuid,${highId}::uuid,${actor.userId}::uuid)
          RETURNING *
        `)[0];
      }

      await tx`
        INSERT INTO creator_dm_participant_state(thread_id,user_id)
        VALUES(${threadId}::uuid,${lowId}::uuid),(${threadId}::uuid,${highId}::uuid)
        ON CONFLICT(thread_id,user_id) DO UPDATE SET archived_at=NULL,updated_at=now()
      `;
      const messageId = randomUUID();
      await tx`
        INSERT INTO creator_dm_messages(id,thread_id,sender_user_id,message_kind,body)
        VALUES(${messageId}::uuid,${threadId}::uuid,${actor.userId}::uuid,'request',${body.message})
      `;
      await tx`
        UPDATE creator_dm_participant_state
        SET last_read_at=CASE WHEN user_id=${actor.userId}::uuid THEN now() ELSE last_read_at END,updated_at=now()
        WHERE thread_id=${threadId}::uuid
      `;
      return { threadId, requestMessageId: messageId, status: "pending", created: true, duplicateSuppressed: false };
    });

    return { request: result, signature: "Tehkné Solutions" };
  });

  app.get("/v1/creator/dm/threads", async (request) => {
    const actor = await requireActor(app, request);
    const query = pageQuery.parse(request.query);
    const rows = await economySql`
      SELECT thread.*,state.last_read_at,state.archived_at,
        other_user.id other_user_id,other_user.display_name other_display_name,
        latest.id latest_message_id,latest.sender_user_id latest_sender_user_id,
        latest.message_kind latest_message_kind,latest.body latest_body,latest.status latest_status,
        latest.created_at latest_created_at,
        (SELECT count(*) FROM creator_dm_messages unread
          WHERE unread.thread_id=thread.id
            AND unread.sender_user_id<>${actor.userId}::uuid
            AND unread.created_at>coalesce(state.last_read_at,'epoch'::timestamptz))::int unread_count
      FROM creator_dm_threads thread
      JOIN creator_dm_participant_state state
        ON state.thread_id=thread.id AND state.user_id=${actor.userId}::uuid
      JOIN users other_user ON other_user.id=CASE
        WHEN thread.user_low_id=${actor.userId}::uuid THEN thread.user_high_id ELSE thread.user_low_id END
      LEFT JOIN LATERAL (
        SELECT message.id,message.sender_user_id,message.message_kind,message.body,message.status,message.created_at
        FROM creator_dm_messages message WHERE message.thread_id=thread.id
        ORDER BY message.created_at DESC,message.id DESC LIMIT 1
      ) latest ON true
      WHERE state.archived_at IS NULL
      ORDER BY thread.updated_at DESC,thread.id DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return {
      threads: rows.map((row) => ({
        id: String(row.id),
        status: String(row.status),
        requestedByRequester: String(row.requested_by_user_id) === actor.userId,
        otherUser: { userId: String(row.other_user_id), displayName: String(row.other_display_name) },
        unreadCount: Number(row.unread_count ?? 0),
        lastReadAt: row.last_read_at ? new Date(String(row.last_read_at)).toISOString() : null,
        latestMessage: row.latest_message_id ? {
          id: String(row.latest_message_id),
          senderUserId: String(row.latest_sender_user_id),
          kind: String(row.latest_message_kind),
          body: messageBody({ status: row.latest_status, body: row.latest_body }),
          removedReason: removedReason({ status: row.latest_status }),
          createdAt: new Date(String(row.latest_created_at)).toISOString()
        } : null,
        updatedAt: new Date(String(row.updated_at)).toISOString()
      })),
      pagination: query,
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { threadId: string } }>("/v1/creator/dm/threads/:threadId/accept", async (request) => {
    const actor = await requireActor(app, request);
    const threadId = z.string().uuid().parse(request.params.threadId);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const thread = (await tx`SELECT * FROM creator_dm_threads WHERE id=${threadId}::uuid FOR UPDATE`)[0];
      if (!thread || !isParticipant(thread, actor.userId)) throw app.httpErrors.notFound("Conversa não encontrada.");
      if (String(thread.status) === "active") return { threadId, status: "active", changed: false };
      if (String(thread.status) !== "pending") throw app.httpErrors.conflict("Pedido não está pendente.");
      if (String(thread.requested_by_user_id) === actor.userId) {
        throw app.httpErrors.forbidden("O remetente do pedido não pode aceitá-lo.");
      }
      const otherUserId = otherParticipant(thread, actor.userId);
      if (await blockedBetween(tx, actor.userId, otherUserId)) {
        throw app.httpErrors.forbidden("Conversa indisponível entre estas contas.");
      }
      await tx`
        UPDATE creator_dm_threads SET status='active',accepted_at=now(),declined_at=NULL,closed_at=NULL,updated_at=now()
        WHERE id=${threadId}::uuid
      `;
      return { threadId, status: "active", changed: true };
    });
    return { thread: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { threadId: string } }>("/v1/creator/dm/threads/:threadId/decline", async (request) => {
    const actor = await requireActor(app, request);
    const threadId = z.string().uuid().parse(request.params.threadId);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const thread = (await tx`SELECT * FROM creator_dm_threads WHERE id=${threadId}::uuid FOR UPDATE`)[0];
      if (!thread || !isParticipant(thread, actor.userId)) throw app.httpErrors.notFound("Conversa não encontrada.");
      if (String(thread.status) === "declined") return { threadId, status: "declined", changed: false };
      if (String(thread.status) !== "pending") throw app.httpErrors.conflict("Pedido não está pendente.");
      if (String(thread.requested_by_user_id) === actor.userId) {
        throw app.httpErrors.forbidden("O remetente do pedido deve fechar o próprio pedido, não recusá-lo.");
      }
      await tx`
        UPDATE creator_dm_threads SET status='declined',declined_at=now(),accepted_at=NULL,closed_at=NULL,updated_at=now()
        WHERE id=${threadId}::uuid
      `;
      return { threadId, status: "declined", changed: true };
    });
    return { thread: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { threadId: string } }>("/v1/creator/dm/threads/:threadId/close", async (request) => {
    const actor = await requireActor(app, request);
    const threadId = z.string().uuid().parse(request.params.threadId);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const thread = (await tx`SELECT * FROM creator_dm_threads WHERE id=${threadId}::uuid FOR UPDATE`)[0];
      if (!thread || !isParticipant(thread, actor.userId)) throw app.httpErrors.notFound("Conversa não encontrada.");
      if (String(thread.status) === "closed") return { threadId, status: "closed", changed: false };
      await tx`
        UPDATE creator_dm_threads SET status='closed',closed_at=now(),updated_at=now()
        WHERE id=${threadId}::uuid
      `;
      return { threadId, status: "closed", changed: true };
    });
    return { thread: result, signature: "Tehkné Solutions" };
  });

  app.get<{ Params: { threadId: string } }>("/v1/creator/dm/threads/:threadId/messages", async (request) => {
    const actor = await requireActor(app, request);
    const threadId = z.string().uuid().parse(request.params.threadId);
    const query = pageQuery.parse(request.query);
    const thread = (await economySql`SELECT * FROM creator_dm_threads WHERE id=${threadId}::uuid`)[0];
    if (!thread || !isParticipant(thread, actor.userId)) throw app.httpErrors.notFound("Conversa não encontrada.");
    const rows = await economySql`
      SELECT message.id,message.sender_user_id,message.message_kind,message.body,message.status,
        message.created_at,message.updated_at,user_account.display_name
      FROM creator_dm_messages message
      JOIN users user_account ON user_account.id=message.sender_user_id
      WHERE message.thread_id=${threadId}::uuid
      ORDER BY message.created_at DESC,message.id DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return {
      thread: { id: threadId, status: String(thread.status), requestedByUserId: String(thread.requested_by_user_id) },
      messages: rows.map((row) => ({
        id: String(row.id),
        sender: { userId: String(row.sender_user_id), displayName: String(row.display_name) },
        kind: String(row.message_kind),
        body: messageBody(row),
        removedReason: removedReason(row),
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString()
      })),
      pagination: query,
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { threadId: string } }>("/v1/creator/dm/threads/:threadId/messages", async (request) => {
    const actor = await requireActor(app, request);
    const threadId = z.string().uuid().parse(request.params.threadId);
    const body = messageSchema.parse(request.body);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const thread = (await tx`SELECT * FROM creator_dm_threads WHERE id=${threadId}::uuid FOR UPDATE`)[0];
      if (!thread || !isParticipant(thread, actor.userId)) throw app.httpErrors.notFound("Conversa não encontrada.");
      if (String(thread.status) !== "active") throw app.httpErrors.conflict("A conversa precisa estar aceita e ativa.");
      const otherUserId = otherParticipant(thread, actor.userId);
      if (await blockedBetween(tx, actor.userId, otherUserId)) {
        throw app.httpErrors.forbidden("Envio indisponível entre estas contas.");
      }
      const messageId = randomUUID();
      const message = (await tx`
        INSERT INTO creator_dm_messages(id,thread_id,sender_user_id,message_kind,body)
        VALUES(${messageId}::uuid,${threadId}::uuid,${actor.userId}::uuid,'message',${body.body})
        RETURNING id,sender_user_id,message_kind,body,status,created_at,updated_at
      `)[0]!;
      await tx`UPDATE creator_dm_threads SET updated_at=now() WHERE id=${threadId}::uuid`;
      await tx`
        UPDATE creator_dm_participant_state SET last_read_at=now(),updated_at=now()
        WHERE thread_id=${threadId}::uuid AND user_id=${actor.userId}::uuid
      `;
      return message;
    });
    return { message: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { threadId: string } }>("/v1/creator/dm/threads/:threadId/read", async (request) => {
    const actor = await requireActor(app, request);
    const threadId = z.string().uuid().parse(request.params.threadId);
    const thread = (await economySql`SELECT * FROM creator_dm_threads WHERE id=${threadId}::uuid`)[0];
    if (!thread || !isParticipant(thread, actor.userId)) throw app.httpErrors.notFound("Conversa não encontrada.");
    await economySql`
      UPDATE creator_dm_participant_state SET last_read_at=now(),updated_at=now()
      WHERE thread_id=${threadId}::uuid AND user_id=${actor.userId}::uuid
    `;
    return { threadId, read: true, signature: "Tehkné Solutions" };
  });

  app.delete<{ Params: { messageId: string } }>("/v1/creator/dm/messages/:messageId", async (request) => {
    const actor = await requireActor(app, request);
    const messageId = z.string().uuid().parse(request.params.messageId);
    const message = (await economySql`
      SELECT message.*,thread.user_low_id,thread.user_high_id
      FROM creator_dm_messages message JOIN creator_dm_threads thread ON thread.id=message.thread_id
      WHERE message.id=${messageId}::uuid
    `)[0];
    if (!message || !isParticipant(message, actor.userId)) throw app.httpErrors.notFound("Mensagem não encontrada.");
    if (String(message.sender_user_id) !== actor.userId) throw app.httpErrors.forbidden("Somente o remetente pode remover a própria mensagem.");
    if (String(message.status) === "deleted") {
      return { messageId, deleted: true, alreadyDeleted: true, signature: "Tehkné Solutions" };
    }
    if (String(message.status) === "rejected") throw app.httpErrors.conflict("Mensagem removida por moderação não pode ser alterada.");
    await economySql`
      UPDATE creator_dm_messages SET status='deleted',deleted_at=now(),updated_at=now()
      WHERE id=${messageId}::uuid
    `;
    return { messageId, deleted: true, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { messageId: string } }>("/v1/creator/dm/messages/:messageId/report", async (request) => {
    const actor = await requireActor(app, request);
    const messageId = z.string().uuid().parse(request.params.messageId);
    const body = reportSchema.parse(request.body);
    const message = (await economySql`
      SELECT message.*,thread.user_low_id,thread.user_high_id
      FROM creator_dm_messages message JOIN creator_dm_threads thread ON thread.id=message.thread_id
      WHERE message.id=${messageId}::uuid
    `)[0];
    if (!message || !isParticipant(message, actor.userId)) throw app.httpErrors.notFound("Mensagem não encontrada.");
    if (String(message.sender_user_id) === actor.userId) throw app.httpErrors.badRequest("Não é possível denunciar a própria mensagem.");
    if (String(message.status) === "rejected") throw app.httpErrors.conflict("Mensagem já removida por moderação.");

    const priority = priorityFor(body.category);
    const id = randomUUID();
    const inserted = (await economySql`
      INSERT INTO creator_economy_reports(
        id,reporter_user_id,resource_type,resource_id,category,priority,reason
      ) VALUES(
        ${id}::uuid,${actor.userId}::uuid,'creator_message',${messageId}::uuid,
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
          id: String(inserted.id),status: String(inserted.status),priority: String(inserted.priority),
          createdAt: new Date(String(inserted.created_at)).toISOString()
        },
        signature: "Tehkné Solutions"
      };
    }
    const prior = (await economySql`
      SELECT id,status,priority,created_at FROM creator_economy_reports
      WHERE reporter_user_id=${actor.userId}::uuid AND resource_type='creator_message'
        AND resource_id=${messageId}::uuid AND status IN ('open','in_review')
      ORDER BY created_at DESC LIMIT 1
    `)[0]!;
    return {
      report: {
        id: String(prior.id),status: String(prior.status),priority: String(prior.priority),
        createdAt: new Date(String(prior.created_at)).toISOString(),duplicateSuppressed: true
      },
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { reportId: string } }>("/v1/admin/creator-moderation/message-reports/:reportId/context", async (request) => {
    const identity = await requireRole(app, request, ["platform-admin"]);
    const reportId = z.string().uuid().parse(request.params.reportId);
    const body = accessSchema.parse(request.body);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const report = (await tx`
        SELECT * FROM creator_economy_reports
        WHERE id=${reportId}::uuid AND resource_type='creator_message' FOR UPDATE
      `)[0];
      if (!report) throw app.httpErrors.notFound("Denúncia de mensagem não encontrada.");
      if (String(report.status) !== "in_review" || String(report.assigned_to ?? "") !== identity.userId) {
        throw app.httpErrors.forbidden("O conteúdo privado só pode ser aberto pelo moderador responsável durante a revisão.");
      }
      const message = (await tx`
        SELECT message.id,message.thread_id,message.sender_user_id,message.message_kind,message.body,
          message.status,message.created_at,thread.user_low_id,thread.user_high_id
        FROM creator_dm_messages message
        JOIN creator_dm_threads thread ON thread.id=message.thread_id
        WHERE message.id=${String(report.resource_id)}::uuid
      `)[0];
      if (!message) throw app.httpErrors.notFound("Mensagem privada não encontrada.");
      await tx`
        INSERT INTO creator_private_moderation_access(id,report_id,message_id,actor_user_id,reason)
        VALUES(${randomUUID()}::uuid,${reportId}::uuid,${String(message.id)}::uuid,${identity.userId}::uuid,${body.reason})
      `;
      return {
        id: String(message.id),threadId: String(message.thread_id),senderUserId: String(message.sender_user_id),
        kind: String(message.message_kind),body: String(message.body),status: String(message.status),
        createdAt: new Date(String(message.created_at)).toISOString()
      };
    });
    return { privateContext: result, signature: "Tehkné Solutions" };
  });

  app.get<{ Params: { reportId: string } }>("/v1/admin/creator-moderation/message-reports/:reportId/context-access", async (request) => {
    await requireRole(app, request, ["platform-admin","municipal-admin"]);
    const reportId = z.string().uuid().parse(request.params.reportId);
    const report = (await economySql`
      SELECT id FROM creator_economy_reports WHERE id=${reportId}::uuid AND resource_type='creator_message'
    `)[0];
    if (!report) throw app.httpErrors.notFound("Denúncia de mensagem não encontrada.");
    const rows = await economySql`
      SELECT access.id,access.actor_user_id,user_account.display_name,access.reason,access.occurred_at
      FROM creator_private_moderation_access access
      JOIN users user_account ON user_account.id=access.actor_user_id
      WHERE access.report_id=${reportId}::uuid
      ORDER BY access.occurred_at ASC,access.id ASC
    `;
    return {
      accesses: rows.map((row) => ({
        id: String(row.id),actorUserId: String(row.actor_user_id),actorDisplayName: String(row.display_name),
        reason: String(row.reason),occurredAt: new Date(String(row.occurred_at)).toISOString()
      })),
      signature: "Tehkné Solutions"
    };
  });
}

// Tehkné Solutions
