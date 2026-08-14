import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";

const economySql = db();

const activityTypeSchema = z.enum([
  "channel_follow","content_like","content_comment","dm_request","dm_message",
  "content_sale","ugc_primary_sale","ugc_resale","ugc_royalty","ad_revenue",
  "competition_prize","moderation_report_result","moderation_restricted","appeal_resolved"
]);
const categorySchema = z.enum(["social","messages","economy","safety"]);
const listQuery = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  category: categorySchema.optional(),
  activityType: activityTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0)
});
const readAllSchema = z.object({ category: categorySchema.optional() });

function activityView(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    type: String(row.activity_type),
    category: String(row.category),
    title: String(row.title),
    actor: row.actor_user_id ? {
      userId: String(row.actor_user_id),
      displayName: row.actor_display_name ? String(row.actor_display_name) : null
    } : null,
    entity: {
      type: String(row.entity_type),
      id: row.entity_id ? String(row.entity_id) : null
    },
    metadata: row.metadata ?? {},
    createdAt: new Date(String(row.created_at)).toISOString(),
    readAt: row.read_at ? new Date(String(row.read_at)).toISOString() : null
  };
}

export async function registerCreatorActivityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/creator/activity", async (request) => {
    const actor = await requireActor(app, request);
    const query = listQuery.parse(request.query);
    const rows = await economySql`
      SELECT activity.*,actor_user.display_name actor_display_name
      FROM creator_activity_items activity
      LEFT JOIN users actor_user ON actor_user.id=activity.actor_user_id
      WHERE activity.user_id=${actor.userId}::uuid
        AND (${query.unreadOnly}::boolean=false OR activity.read_at IS NULL)
        AND (${query.category ?? null}::text IS NULL OR activity.category=${query.category ?? null})
        AND (${query.activityType ?? null}::text IS NULL OR activity.activity_type=${query.activityType ?? null})
      ORDER BY activity.created_at DESC,activity.id DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `;
    return {
      items: rows.map((row) => activityView(row)),
      pagination: { limit: query.limit, offset: query.offset },
      filters: { unreadOnly: query.unreadOnly, category: query.category ?? null, activityType: query.activityType ?? null },
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/creator/activity/summary", async (request) => {
    const actor = await requireActor(app, request);
    const rows = await economySql`
      SELECT category,count(*)::int unread
      FROM creator_activity_items
      WHERE user_id=${actor.userId}::uuid AND read_at IS NULL
      GROUP BY category
    `;
    const byCategory: Record<string, number> = { social: 0, messages: 0, economy: 0, safety: 0 };
    for (const row of rows) byCategory[String(row.category)] = Number(row.unread);
    return {
      unreadTotal: Object.values(byCategory).reduce((sum,value) => sum+value,0),
      byCategory,
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { activityId: string } }>("/v1/creator/activity/:activityId/read", async (request) => {
    const actor = await requireActor(app, request);
    const activityId = z.string().uuid().parse(request.params.activityId);
    const row = (await economySql`
      UPDATE creator_activity_items SET read_at=coalesce(read_at,now())
      WHERE id=${activityId}::uuid AND user_id=${actor.userId}::uuid
      RETURNING id,read_at
    `)[0];
    if (!row) throw app.httpErrors.notFound("Atividade não encontrada.");
    return {
      activityId,
      readAt: new Date(String(row.read_at)).toISOString(),
      signature: "Tehkné Solutions"
    };
  });

  app.post("/v1/creator/activity/read-all", async (request) => {
    const actor = await requireActor(app, request);
    const body = readAllSchema.parse(request.body ?? {});
    const rows = await economySql`
      UPDATE creator_activity_items SET read_at=now()
      WHERE user_id=${actor.userId}::uuid AND read_at IS NULL
        AND (${body.category ?? null}::text IS NULL OR category=${body.category ?? null})
      RETURNING id
    `;
    return {
      markedRead: rows.length,
      category: body.category ?? null,
      signature: "Tehkné Solutions"
    };
  });
}

// Tehkné Solutions
