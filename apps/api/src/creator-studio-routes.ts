import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";

const economySql = db();

type Queryable = (strings: TemplateStringsArray, ...values: any[]) => any;

const contentTypeSchema = z.enum(["post", "video", "audio", "live", "magazine", "course", "gallery", "event"]);
const accessModelSchema = z.enum(["free", "purchase", "subscription", "ticket"]);
const listQuery = z.object({
  status: z.enum(["draft", "published", "archived", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});
const editContentSchema = z.object({
  channelId: z.string().uuid().optional(),
  contentType: contentTypeSchema.optional(),
  title: z.string().trim().min(1).max(180).optional(),
  body: z.string().max(100000).optional(),
  mediaUri: z.string().trim().max(2000).nullable().optional(),
  accessModel: accessModelSchema.optional(),
  priceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
}).refine((body) => Object.keys(body).length > 0, { message: "Informe pelo menos um campo para edição." });

type EditableContent = Readonly<{
  channel_id: unknown;
  content_type: unknown;
  title: unknown;
  body: unknown;
  media_uri: unknown;
  access_model: unknown;
  price_minor: unknown;
  status: unknown;
}>;

function validatePricing(app: FastifyInstance, accessModel: string, priceMinor: number): void {
  if (accessModel === "free" && priceMinor !== 0) {
    throw app.httpErrors.badRequest("Conteúdo gratuito precisa possuir preço zero.");
  }
  if (accessModel !== "free" && priceMinor <= 0) {
    throw app.httpErrors.badRequest("Conteúdo monetizado precisa possuir preço positivo.");
  }
}

async function requireOwnedChannel(
  app: FastifyInstance,
  sql: Queryable,
  channelId: string,
  userId: string
): Promise<void> {
  const channel = (await sql`
    SELECT id FROM creator_channels
    WHERE id=${channelId}::uuid AND creator_user_id=${userId}::uuid AND status='active'
  `)[0];
  if (!channel) throw app.httpErrors.notFound("Canal ativo do criador não encontrado.");
}

export async function registerCreatorStudioRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/creator/content/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = listQuery.parse(request.query);
    const rows = await economySql`
      SELECT content.id,content.channel_id,content.creator_user_id,content.content_type,
        content.title,content.body,content.media_uri,content.access_model,content.price_minor,
        content.status,content.published_at,content.created_at,content.updated_at,
        channel.handle channel_handle,channel.name channel_name
      FROM creator_content content
      JOIN creator_channels channel ON channel.id=content.channel_id
      WHERE content.creator_user_id=${actor.userId}::uuid
        AND (${query.status ?? null}::text IS NULL OR content.status=${query.status ?? null})
      ORDER BY content.updated_at DESC,content.id DESC
      LIMIT ${query.limit}
    `;
    return { content: rows, filter: { status: query.status ?? null, limit: query.limit }, signature: "Tehkné Solutions" };
  });

  app.patch<{ Params: { contentId: string } }>("/v1/creator/content/:contentId", async (request) => {
    const actor = await requireActor(app, request);
    const contentId = z.string().uuid().parse(request.params.contentId);
    const body = editContentSchema.parse(request.body);

    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const current = (await tx`
        SELECT channel_id,content_type,title,body,media_uri,access_model,price_minor,status
        FROM creator_content
        WHERE id=${contentId}::uuid AND creator_user_id=${actor.userId}::uuid
        FOR UPDATE
      `)[0] as EditableContent | undefined;
      if (!current) throw app.httpErrors.notFound("Conteúdo do criador não encontrado.");
      if (!["draft", "archived"].includes(String(current.status))) {
        throw app.httpErrors.conflict("Apenas rascunhos ou conteúdos arquivados podem ser editados. Arquive antes de editar uma publicação.");
      }

      const channelId = body.channelId ?? String(current.channel_id);
      const contentType = body.contentType ?? String(current.content_type);
      const title = body.title ?? String(current.title);
      const contentBody = body.body ?? String(current.body);
      const mediaUri = body.mediaUri !== undefined ? body.mediaUri : current.media_uri ? String(current.media_uri) : null;
      const accessModel = body.accessModel ?? String(current.access_model);
      const priceMinor = body.priceMinor ?? Number(current.price_minor);
      validatePricing(app, accessModel, priceMinor);
      await requireOwnedChannel(app, tx, channelId, actor.userId);

      const updated = (await tx`
        UPDATE creator_content
        SET channel_id=${channelId}::uuid,content_type=${contentType},title=${title},body=${contentBody},
          media_uri=${mediaUri},access_model=${accessModel},price_minor=${priceMinor},updated_at=now()
        WHERE id=${contentId}::uuid
        RETURNING *
      `)[0]!;
      return updated;
    });

    return { content: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { contentId: string } }>("/v1/creator/content/:contentId/publish", async (request) => {
    const actor = await requireActor(app, request);
    const contentId = z.string().uuid().parse(request.params.contentId);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const content = (await tx`
        SELECT id,channel_id,status,access_model,price_minor FROM creator_content
        WHERE id=${contentId}::uuid AND creator_user_id=${actor.userId}::uuid
        FOR UPDATE
      `)[0];
      if (!content) throw app.httpErrors.notFound("Conteúdo do criador não encontrado.");
      if (String(content.status) === "rejected") throw app.httpErrors.forbidden("Conteúdo rejeitado pela moderação não pode ser republicado.");
      if (String(content.status) === "published") return { changed: false, content };
      await requireOwnedChannel(app, tx, String(content.channel_id), actor.userId);
      validatePricing(app, String(content.access_model), Number(content.price_minor));
      const updated = (await tx`
        UPDATE creator_content
        SET status='published',published_at=coalesce(published_at,now()),updated_at=now()
        WHERE id=${contentId}::uuid
        RETURNING *
      `)[0]!;
      return { changed: true, content: updated };
    });
    return { publication: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { contentId: string } }>("/v1/creator/content/:contentId/archive", async (request) => {
    const actor = await requireActor(app, request);
    const contentId = z.string().uuid().parse(request.params.contentId);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const content = (await tx`
        SELECT id,status FROM creator_content
        WHERE id=${contentId}::uuid AND creator_user_id=${actor.userId}::uuid
        FOR UPDATE
      `)[0];
      if (!content) throw app.httpErrors.notFound("Conteúdo do criador não encontrado.");
      if (String(content.status) === "rejected") throw app.httpErrors.conflict("Conteúdo rejeitado já está fora de circulação e não pode ser arquivado pelo criador.");
      if (String(content.status) === "archived") return { changed: false, content };
      const updated = (await tx`
        UPDATE creator_content SET status='archived',updated_at=now()
        WHERE id=${contentId}::uuid
        RETURNING *
      `)[0]!;
      return { changed: true, content: updated };
    });
    return { archive: result, signature: "Tehkné Solutions" };
  });
}

// Tehkné Solutions
