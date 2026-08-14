import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";

const economySql = db();
const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

const adSurfaceSchema = z.object({
  surfaceKind: z.enum(["profile", "store", "page", "venue", "arena", "event"]),
  surfaceRef: z.string().trim().min(1).max(180),
  title: z.string().trim().min(1).max(160),
  format: z.enum(["banner", "tile", "billboard", "video", "audio", "native"]),
  revenueShareBps: z.number().int().min(0).max(10000).default(7000)
});

const adCampaignSchema = z.object({
  advertiserName: z.string().trim().min(1).max(180),
  campaignKind: z.enum(["internal", "external"]).default("internal"),
  title: z.string().trim().min(1).max(180),
  creativeType: z.enum(["image", "video", "audio", "native"]),
  creativeUri: z.string().trim().min(1).max(2000),
  destinationUri: z.string().trim().max(2000).nullable().optional(),
  pricingModel: z.enum(["flat", "cpm", "cpc"]).default("flat"),
  budgetMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  bidMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional()
});

const adPlacementSchema = z.object({
  campaignId: z.string().uuid(),
  surfaceId: z.string().uuid(),
  agreedRateMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  publisherShareBps: z.number().int().min(0).max(10000).default(7000),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional()
});

const channelSchema = z.object({
  handle: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{2,39}$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default("")
});

const contentSchema = z.object({
  channelId: z.string().uuid(),
  contentType: z.enum(["post", "video", "audio", "live", "magazine", "course", "gallery", "event"]),
  title: z.string().trim().min(1).max(180),
  body: z.string().max(100000).default(""),
  mediaUri: z.string().trim().max(2000).nullable().optional(),
  accessModel: z.enum(["free", "purchase", "subscription", "ticket"]).default("free"),
  priceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  publish: z.boolean().default(false)
});

const blueprintSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.enum(["decor", "furniture", "wearable", "art", "collectible", "architecture", "vehicle", "component"]),
  version: z.number().int().positive().max(100000).default(1),
  assetManifestUri: z.string().trim().min(1).max(2000),
  contentHash: z.string().trim().min(16).max(256),
  royaltyBps: z.number().int().min(0).max(5000).default(500),
  publish: z.boolean().default(false),
  tokenizationStatus: z.enum(["disabled", "eligible"]).default("disabled")
});

const competitionSchema = z.object({
  name: z.string().trim().min(1).max(180),
  competitionType: z.enum(["game", "quiz", "race", "creative", "tournament"]),
  entryMode: z.enum(["free", "virtual_entry_fee"]).default("free"),
  entryFeeMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  sponsorPoolMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  maxPlayers: z.number().int().min(2).max(100000).nullable().optional(),
  rulesUri: z.string().trim().min(1).max(2000),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  openNow: z.boolean().default(false)
});

export async function registerCreatorPlayerEconomyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/ads/surfaces", async (request) => {
    const actor = await requireActor(app, request);
    const body = adSurfaceSchema.parse(request.body);
    const id = randomUUID();
    const rows = await economySql`
      INSERT INTO economy_ad_surfaces(
        id, owner_user_id, surface_kind, surface_ref, title, format, revenue_share_bps
      ) VALUES(
        ${id}::uuid, ${actor.userId}::uuid, ${body.surfaceKind}, ${body.surfaceRef},
        ${body.title}, ${body.format}, ${body.revenueShareBps}
      )
      RETURNING *
    `;
    return { surface: rows[0], signature: "Tehkné Solutions" };
  });

  app.get("/v1/ads/surfaces/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = limitQuery.parse(request.query);
    const rows = await economySql`
      SELECT * FROM economy_ad_surfaces
      WHERE owner_user_id=${actor.userId}::uuid
      ORDER BY created_at DESC
      LIMIT ${query.limit}
    `;
    return { surfaces: rows, signature: "Tehkné Solutions" };
  });

  app.post("/v1/ads/campaigns", async (request) => {
    const actor = await requireActor(app, request);
    const body = adCampaignSchema.parse(request.body);
    if (body.campaignKind === "external" && !actor.roles.includes("platform-admin")) {
      throw app.httpErrors.forbidden("Campanhas externas exigem aprovação administrativa.");
    }
    if (body.endsAt && body.startsAt && body.endsAt <= body.startsAt) {
      throw app.httpErrors.badRequest("endsAt precisa ser posterior a startsAt.");
    }
    const id = randomUUID();
    const status = body.campaignKind === "external" ? "pending" : "draft";
    const rows = await economySql`
      INSERT INTO economy_ad_campaigns(
        id, advertiser_user_id, advertiser_name, campaign_kind, title, creative_type,
        creative_uri, destination_uri, pricing_model, budget_minor, bid_minor, status,
        starts_at, ends_at
      ) VALUES(
        ${id}::uuid, ${actor.userId}::uuid, ${body.advertiserName}, ${body.campaignKind},
        ${body.title}, ${body.creativeType}, ${body.creativeUri}, ${body.destinationUri ?? null},
        ${body.pricingModel}, ${body.budgetMinor}, ${body.bidMinor}, ${status},
        ${body.startsAt?.toISOString() ?? null}::timestamptz,
        ${body.endsAt?.toISOString() ?? null}::timestamptz
      )
      RETURNING *
    `;
    return { campaign: rows[0], signature: "Tehkné Solutions" };
  });

  app.get("/v1/ads/campaigns/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = limitQuery.parse(request.query);
    const rows = await economySql`
      SELECT * FROM economy_ad_campaigns
      WHERE advertiser_user_id=${actor.userId}::uuid
      ORDER BY created_at DESC
      LIMIT ${query.limit}
    `;
    return { campaigns: rows, signature: "Tehkné Solutions" };
  });

  app.post("/v1/ads/placements", async (request) => {
    const actor = await requireActor(app, request);
    const body = adPlacementSchema.parse(request.body);
    if (body.endsAt && body.startsAt && body.endsAt <= body.startsAt) {
      throw app.httpErrors.badRequest("endsAt precisa ser posterior a startsAt.");
    }
    const campaign = (await economySql`
      SELECT id, advertiser_user_id FROM economy_ad_campaigns WHERE id=${body.campaignId}::uuid
    `)[0];
    if (!campaign) throw app.httpErrors.notFound("Campanha não encontrada.");
    if (String(campaign.advertiser_user_id) !== actor.userId && !actor.roles.includes("platform-admin")) {
      throw app.httpErrors.forbidden("A campanha não pertence ao usuário atual.");
    }
    const surface = (await economySql`
      SELECT id FROM economy_ad_surfaces WHERE id=${body.surfaceId}::uuid AND status='active'
    `)[0];
    if (!surface) throw app.httpErrors.notFound("Superfície publicitária ativa não encontrada.");
    const id = randomUUID();
    const rows = await economySql`
      INSERT INTO economy_ad_placements(
        id, campaign_id, surface_id, agreed_rate_minor, publisher_share_bps, starts_at, ends_at
      ) VALUES(
        ${id}::uuid, ${body.campaignId}::uuid, ${body.surfaceId}::uuid,
        ${body.agreedRateMinor}, ${body.publisherShareBps},
        ${body.startsAt?.toISOString() ?? null}::timestamptz,
        ${body.endsAt?.toISOString() ?? null}::timestamptz
      )
      RETURNING *
    `;
    return { placement: rows[0], signature: "Tehkné Solutions" };
  });

  app.post("/v1/creator/channels", async (request) => {
    const actor = await requireActor(app, request);
    const body = channelSchema.parse(request.body);
    const id = randomUUID();
    const rows = await economySql`
      INSERT INTO creator_channels(id, creator_user_id, handle, name, description)
      VALUES(${id}::uuid, ${actor.userId}::uuid, ${body.handle}, ${body.name}, ${body.description})
      RETURNING *
    `;
    return { channel: rows[0], signature: "Tehkné Solutions" };
  });

  app.get("/v1/creator/channels/me", async (request) => {
    const actor = await requireActor(app, request);
    const rows = await economySql`
      SELECT * FROM creator_channels WHERE creator_user_id=${actor.userId}::uuid
      ORDER BY created_at DESC
    `;
    return { channels: rows, signature: "Tehkné Solutions" };
  });

  app.post("/v1/creator/content", async (request) => {
    const actor = await requireActor(app, request);
    const body = contentSchema.parse(request.body);
    if (body.accessModel !== "free" && body.priceMinor <= 0) {
      throw app.httpErrors.badRequest("Conteúdo monetizado precisa possuir preço positivo.");
    }
    if (body.accessModel === "free" && body.priceMinor !== 0) {
      throw app.httpErrors.badRequest("Conteúdo gratuito precisa possuir preço zero.");
    }
    const channel = (await economySql`
      SELECT id FROM creator_channels
      WHERE id=${body.channelId}::uuid AND creator_user_id=${actor.userId}::uuid AND status='active'
    `)[0];
    if (!channel) throw app.httpErrors.notFound("Canal ativo do criador não encontrado.");
    const id = randomUUID();
    const status = body.publish ? "published" : "draft";
    const publishedAt = body.publish ? new Date().toISOString() : null;
    const rows = await economySql`
      INSERT INTO creator_content(
        id, channel_id, creator_user_id, content_type, title, body, media_uri,
        access_model, price_minor, status, published_at
      ) VALUES(
        ${id}::uuid, ${body.channelId}::uuid, ${actor.userId}::uuid, ${body.contentType},
        ${body.title}, ${body.body}, ${body.mediaUri ?? null}, ${body.accessModel},
        ${body.priceMinor}, ${status}, ${publishedAt}::timestamptz
      )
      RETURNING *
    `;
    return { content: rows[0], signature: "Tehkné Solutions" };
  });

  app.get("/v1/creator/feed", async (request) => {
    const query = limitQuery.parse(request.query);
    const rows = await economySql`
      SELECT c.*, ch.handle channel_handle, ch.name channel_name
      FROM creator_content c
      JOIN creator_channels ch ON ch.id=c.channel_id
      WHERE c.status='published' AND ch.status='active'
      ORDER BY c.published_at DESC NULLS LAST, c.created_at DESC
      LIMIT ${query.limit}
    `;
    return { content: rows, signature: "Tehkné Solutions" };
  });

  app.post("/v1/ugc/blueprints", async (request) => {
    const actor = await requireActor(app, request);
    const body = blueprintSchema.parse(request.body);
    const id = randomUUID();
    const status = body.publish ? "published" : "draft";
    const rows = await economySql`
      INSERT INTO ugc_object_blueprints(
        id, creator_user_id, name, category, version, asset_manifest_uri, content_hash,
        royalty_bps, status, tokenization_status
      ) VALUES(
        ${id}::uuid, ${actor.userId}::uuid, ${body.name}, ${body.category}, ${body.version},
        ${body.assetManifestUri}, ${body.contentHash}, ${body.royaltyBps}, ${status},
        ${body.tokenizationStatus}
      )
      RETURNING *
    `;
    return { blueprint: rows[0], signature: "Tehkné Solutions" };
  });

  app.get("/v1/ugc/blueprints/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = limitQuery.parse(request.query);
    const rows = await economySql`
      SELECT * FROM ugc_object_blueprints
      WHERE creator_user_id=${actor.userId}::uuid
      ORDER BY created_at DESC
      LIMIT ${query.limit}
    `;
    return { blueprints: rows, signature: "Tehkné Solutions" };
  });

  app.get("/v1/ugc/catalog", async (request) => {
    const query = limitQuery.parse(request.query);
    const rows = await economySql`
      SELECT * FROM ugc_object_blueprints
      WHERE status='published'
      ORDER BY created_at DESC
      LIMIT ${query.limit}
    `;
    return { blueprints: rows, signature: "Tehkné Solutions" };
  });

  app.post("/v1/competitions", async (request) => {
    const actor = await requireActor(app, request);
    const body = competitionSchema.parse(request.body);
    if (body.entryMode === "free" && body.entryFeeMinor !== 0) {
      throw app.httpErrors.badRequest("Competição gratuita precisa possuir taxa zero.");
    }
    if (body.entryMode === "virtual_entry_fee" && body.entryFeeMinor <= 0) {
      throw app.httpErrors.badRequest("Taxa virtual precisa ser positiva.");
    }
    if (body.endsAt && body.startsAt && body.endsAt <= body.startsAt) {
      throw app.httpErrors.badRequest("endsAt precisa ser posterior a startsAt.");
    }
    const id = randomUUID();
    const status = body.openNow ? "open" : "draft";
    const rows = await economySql`
      INSERT INTO player_competitions(
        id, organizer_user_id, name, competition_type, entry_mode, entry_fee_minor,
        sponsor_pool_minor, max_players, status, rules_uri, starts_at, ends_at
      ) VALUES(
        ${id}::uuid, ${actor.userId}::uuid, ${body.name}, ${body.competitionType},
        ${body.entryMode}, ${body.entryFeeMinor}, ${body.sponsorPoolMinor}, ${body.maxPlayers ?? null},
        ${status}, ${body.rulesUri}, ${body.startsAt?.toISOString() ?? null}::timestamptz,
        ${body.endsAt?.toISOString() ?? null}::timestamptz
      )
      RETURNING *
    `;
    return { competition: rows[0], signature: "Tehkné Solutions" };
  });

  app.get("/v1/competitions", async (request) => {
    const query = limitQuery.parse(request.query);
    const rows = await economySql`
      SELECT * FROM player_competitions
      WHERE status IN ('open','running')
      ORDER BY starts_at ASC NULLS LAST, created_at DESC
      LIMIT ${query.limit}
    `;
    return { competitions: rows, signature: "Tehkné Solutions" };
  });
}

// Tehkné Solutions
