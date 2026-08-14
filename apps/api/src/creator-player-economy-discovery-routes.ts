import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { requireActor } from "./auth-context.js";

const economySql = db();

const windowQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30)
});
const limitQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30)
});
const adEventSchema = z.object({ eventType: z.enum(["impression", "click"]) });

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.trim().length < 8 || key.length > 200) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório, entre 8 e 200 caracteres.");
  }
  return key.trim();
}

function numberOf(value: unknown): number { return Number(value ?? 0); }

export async function registerCreatorPlayerEconomyDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { placementId: string } }>("/v1/ads/placements/:placementId/events", async (request) => {
    const actor = await requireActor(app, request);
    const placementId = z.string().uuid().parse(request.params.placementId);
    const body = adEventSchema.parse(request.body);
    const key = idempotencyKey(app, request);
    const result = await economySql.begin("isolation level serializable", async (tx) => {
      const placement = (await tx`
        SELECT id,status FROM economy_ad_placements WHERE id=${placementId}::uuid
      `)[0];
      if (!placement || String(placement.status) !== "active") {
        throw app.httpErrors.notFound("Placement publicitário ativo não encontrado.");
      }
      const id = randomUUID();
      const inserted = (await tx`
        INSERT INTO economy_ad_events(id,placement_id,viewer_user_id,event_type,idempotency_key)
        VALUES(${id}::uuid,${placementId}::uuid,${actor.userId}::uuid,${body.eventType},${key})
        ON CONFLICT(idempotency_key) DO NOTHING
        RETURNING *
      `)[0];
      if (inserted) return { eventId: String(inserted.id), recorded: true };
      const prior = (await tx`SELECT * FROM economy_ad_events WHERE idempotency_key=${key}`)[0];
      if (!prior || String(prior.placement_id) !== placementId || String(prior.viewer_user_id) !== actor.userId || String(prior.event_type) !== body.eventType) {
        throw app.httpErrors.conflict("Idempotency-Key já utilizado por outro evento.");
      }
      return { eventId: String(prior.id), recorded: false };
    });
    return { event: result, signature: "Tehkné Solutions" };
  });

  app.get("/v1/ads/analytics/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = windowQuery.parse(request.query);
    const rows = await economySql`
      SELECT campaign.id,campaign.name,campaign.status,campaign.budget_minor,campaign.spent_minor,
        count(DISTINCT event.id) FILTER(WHERE event.event_type='impression')::int impressions,
        count(DISTINCT event.id) FILTER(WHERE event.event_type='click')::int clicks,
        coalesce(sum(DISTINCT settlement.gross_minor),0)::bigint settled_minor
      FROM economy_ad_campaigns campaign
      LEFT JOIN economy_ad_placements placement ON placement.campaign_id=campaign.id
      LEFT JOIN economy_ad_events event ON event.placement_id=placement.id
        AND event.occurred_at>=now()-(${query.days}::text||' days')::interval
      LEFT JOIN economy_ad_settlements settlement ON settlement.placement_id=placement.id
        AND settlement.settled_at>=now()-(${query.days}::text||' days')::interval
      WHERE campaign.advertiser_user_id=${actor.userId}::uuid
      GROUP BY campaign.id
      ORDER BY campaign.updated_at DESC
    `;
    const publisher = (await economySql`
      SELECT
        count(event.id) FILTER(WHERE event.event_type='impression')::int impressions,
        count(event.id) FILTER(WHERE event.event_type='click')::int clicks,
        coalesce((SELECT sum(s.publisher_minor) FROM economy_ad_settlements s
          WHERE s.publisher_user_id=${actor.userId}::uuid
            AND s.settled_at>=now()-(${query.days}::text||' days')::interval),0)::bigint revenue_minor
      FROM economy_ad_surfaces surface
      LEFT JOIN economy_ad_placements placement ON placement.surface_id=surface.id
      LEFT JOIN economy_ad_events event ON event.placement_id=placement.id
        AND event.occurred_at>=now()-(${query.days}::text||' days')::interval
      WHERE surface.owner_user_id=${actor.userId}::uuid
    `)[0];
    const campaigns = rows.map((row) => {
      const impressions = numberOf(row.impressions);
      const clicks = numberOf(row.clicks);
      return {
        id: String(row.id), name: String(row.name), status: String(row.status),
        budgetMinor: numberOf(row.budget_minor), spentMinor: numberOf(row.spent_minor),
        impressions, clicks, ctrPercent: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
        settledMinor: numberOf(row.settled_minor)
      };
    });
    const publisherImpressions = numberOf(publisher?.impressions);
    const publisherClicks = numberOf(publisher?.clicks);
    return {
      windowDays: query.days,
      advertiser: { campaigns },
      publisher: {
        impressions: publisherImpressions,
        clicks: publisherClicks,
        ctrPercent: publisherImpressions > 0 ? Number(((publisherClicks / publisherImpressions) * 100).toFixed(2)) : 0,
        revenueMinor: numberOf(publisher?.revenue_minor)
      },
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { channelId: string } }>("/v1/creator/channels/:channelId/follow", async (request) => {
    const actor = await requireActor(app, request);
    const channelId = z.string().uuid().parse(request.params.channelId);
    const channel = (await economySql`SELECT id,owner_user_id,status FROM creator_channels WHERE id=${channelId}::uuid`)[0];
    if (!channel || String(channel.status) !== "active") throw app.httpErrors.notFound("Canal ativo não encontrado.");
    if (String(channel.owner_user_id) === actor.userId) throw app.httpErrors.badRequest("Não é possível seguir o próprio canal.");
    await economySql`
      INSERT INTO creator_channel_follows(channel_id,follower_user_id)
      VALUES(${channelId}::uuid,${actor.userId}::uuid)
      ON CONFLICT DO NOTHING
    `;
    return { channelId, following: true, signature: "Tehkné Solutions" };
  });

  app.delete<{ Params: { channelId: string } }>("/v1/creator/channels/:channelId/follow", async (request) => {
    const actor = await requireActor(app, request);
    const channelId = z.string().uuid().parse(request.params.channelId);
    await economySql`
      DELETE FROM creator_channel_follows WHERE channel_id=${channelId}::uuid AND follower_user_id=${actor.userId}::uuid
    `;
    return { channelId, following: false, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { contentId: string } }>("/v1/creator/content/:contentId/like", async (request) => {
    const actor = await requireActor(app, request);
    const contentId = z.string().uuid().parse(request.params.contentId);
    const content = (await economySql`SELECT id,creator_user_id,status FROM creator_content WHERE id=${contentId}::uuid`)[0];
    if (!content || String(content.status) !== "published") throw app.httpErrors.notFound("Conteúdo publicado não encontrado.");
    if (String(content.creator_user_id) === actor.userId) throw app.httpErrors.badRequest("Não é possível curtir o próprio conteúdo.");
    await economySql`
      INSERT INTO creator_content_reactions(content_id,user_id,reaction)
      VALUES(${contentId}::uuid,${actor.userId}::uuid,'like')
      ON CONFLICT DO NOTHING
    `;
    return { contentId, liked: true, signature: "Tehkné Solutions" };
  });

  app.delete<{ Params: { contentId: string } }>("/v1/creator/content/:contentId/like", async (request) => {
    const actor = await requireActor(app, request);
    const contentId = z.string().uuid().parse(request.params.contentId);
    await economySql`
      DELETE FROM creator_content_reactions WHERE content_id=${contentId}::uuid AND user_id=${actor.userId}::uuid AND reaction='like'
    `;
    return { contentId, liked: false, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { contentId: string } }>("/v1/creator/content/:contentId/view", async (request) => {
    const actor = await requireActor(app, request);
    const contentId = z.string().uuid().parse(request.params.contentId);
    const key = idempotencyKey(app, request);
    const content = (await economySql`SELECT id,creator_user_id,status FROM creator_content WHERE id=${contentId}::uuid`)[0];
    if (!content || String(content.status) !== "published") throw app.httpErrors.notFound("Conteúdo publicado não encontrado.");
    if (String(content.creator_user_id) === actor.userId) {
      return { contentId, counted: false, reason: "creator-self-view", signature: "Tehkné Solutions" };
    }
    const inserted = await economySql`
      INSERT INTO creator_content_views(id,content_id,viewer_user_id,idempotency_key)
      VALUES(${randomUUID()}::uuid,${contentId}::uuid,${actor.userId}::uuid,${key})
      ON CONFLICT(idempotency_key) DO NOTHING RETURNING id
    `;
    return { contentId, counted: inserted.length > 0, signature: "Tehkné Solutions" };
  });

  app.get("/v1/creator/discover", async (request) => {
    await requireActor(app, request);
    const query = limitQuery.parse(request.query);
    const rows = await economySql`
      WITH view_metrics AS (
        SELECT content_id,count(*) FILTER(WHERE occurred_at>=now()-interval '7 days')::int views_7d
        FROM creator_content_views GROUP BY content_id
      ), like_metrics AS (
        SELECT content_id,count(*)::int likes FROM creator_content_reactions WHERE reaction='like' GROUP BY content_id
      ), purchase_metrics AS (
        SELECT content_id,count(*) FILTER(WHERE purchased_at>=now()-interval '30 days')::int purchases_30d
        FROM creator_content_purchases GROUP BY content_id
      ), follower_metrics AS (
        SELECT channel_id,count(*)::int followers FROM creator_channel_follows GROUP BY channel_id
      )
      SELECT content.*,channel.handle,channel.display_name,
        coalesce(view_metrics.views_7d,0)::int views_7d,
        coalesce(like_metrics.likes,0)::int likes,
        coalesce(purchase_metrics.purchases_30d,0)::int purchases_30d,
        coalesce(follower_metrics.followers,0)::int followers,
        (
          coalesce(view_metrics.views_7d,0)
          +coalesce(like_metrics.likes,0)*5
          +coalesce(purchase_metrics.purchases_30d,0)*20
          +coalesce(follower_metrics.followers,0)*2
          +greatest(0,168-floor(extract(epoch FROM (now()-content.published_at))/3600))
        )::bigint discovery_score
      FROM creator_content content
      JOIN creator_channels channel ON channel.id=content.channel_id AND channel.status='active'
      LEFT JOIN view_metrics ON view_metrics.content_id=content.id
      LEFT JOIN like_metrics ON like_metrics.content_id=content.id
      LEFT JOIN purchase_metrics ON purchase_metrics.content_id=content.id
      LEFT JOIN follower_metrics ON follower_metrics.channel_id=content.channel_id
      WHERE content.status='published'
      ORDER BY discovery_score DESC,content.published_at DESC,content.id ASC
      LIMIT ${query.limit}
    `;
    return { items: rows, signature: "Tehkné Solutions" };
  });

  app.get("/v1/creator/dashboard/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = windowQuery.parse(request.query);
    const row = (await economySql`
      SELECT
        (SELECT count(*) FROM creator_channels c WHERE c.owner_user_id=${actor.userId}::uuid)::int channels,
        (SELECT count(*) FROM creator_channel_follows f JOIN creator_channels c ON c.id=f.channel_id WHERE c.owner_user_id=${actor.userId}::uuid)::int followers,
        (SELECT count(*) FROM creator_content c WHERE c.creator_user_id=${actor.userId}::uuid AND c.status='published')::int published_content,
        (SELECT count(*) FROM creator_content_views v JOIN creator_content c ON c.id=v.content_id WHERE c.creator_user_id=${actor.userId}::uuid AND v.occurred_at>=now()-(${query.days}::text||' days')::interval)::int views,
        (SELECT count(*) FROM creator_content_reactions r JOIN creator_content c ON c.id=r.content_id WHERE c.creator_user_id=${actor.userId}::uuid AND r.created_at>=now()-(${query.days}::text||' days')::interval)::int likes,
        (SELECT count(*) FROM creator_content_purchases p WHERE p.creator_user_id=${actor.userId}::uuid AND p.purchased_at>=now()-(${query.days}::text||' days')::interval)::int content_purchases,
        coalesce((SELECT sum(p.creator_net_minor) FROM creator_content_purchases p WHERE p.creator_user_id=${actor.userId}::uuid AND p.purchased_at>=now()-(${query.days}::text||' days')::interval),0)::bigint content_revenue_minor,
        coalesce((SELECT sum(s.creator_net_minor) FROM ugc_primary_sales s WHERE s.creator_user_id=${actor.userId}::uuid AND s.sold_at>=now()-(${query.days}::text||' days')::interval),0)::bigint ugc_primary_revenue_minor,
        coalesce((SELECT sum(t.royalty_minor) FROM ugc_market_trades t WHERE t.creator_user_id=${actor.userId}::uuid AND t.traded_at>=now()-(${query.days}::text||' days')::interval),0)::bigint ugc_royalty_revenue_minor,
        coalesce((SELECT sum(a.publisher_minor) FROM economy_ad_settlements a WHERE a.publisher_user_id=${actor.userId}::uuid AND a.settled_at>=now()-(${query.days}::text||' days')::interval),0)::bigint ad_revenue_minor
    `)[0];
    const contentRevenueMinor = numberOf(row?.content_revenue_minor);
    const ugcPrimaryRevenueMinor = numberOf(row?.ugc_primary_revenue_minor);
    const ugcRoyaltyRevenueMinor = numberOf(row?.ugc_royalty_revenue_minor);
    const adRevenueMinor = numberOf(row?.ad_revenue_minor);
    return {
      windowDays: query.days,
      audience: { channels: numberOf(row?.channels), followers: numberOf(row?.followers) },
      content: { published: numberOf(row?.published_content), views: numberOf(row?.views), likes: numberOf(row?.likes), purchases: numberOf(row?.content_purchases) },
      revenue: {
        contentMinor: contentRevenueMinor,
        ugcPrimaryMinor: ugcPrimaryRevenueMinor,
        ugcRoyaltiesMinor: ugcRoyaltyRevenueMinor,
        advertisingMinor: adRevenueMinor,
        totalMinor: contentRevenueMinor + ugcPrimaryRevenueMinor + ugcRoyaltyRevenueMinor + adRevenueMinor
      },
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/ugc/inventory/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = limitQuery.parse(request.query);
    const rows = await economySql`
      SELECT instance.id,instance.serial_number,instance.provenance_hash,instance.minted_at,instance.status,
        edition.id edition_id,edition.edition_name,edition.scarcity,edition.transferable,edition.resale_allowed,
        blueprint.id blueprint_id,blueprint.name blueprint_name,blueprint.category,
        blueprint.creator_user_id=instance.owner_user_id created_by_owner,
        listing.id active_listing_id,listing.price_minor active_listing_price_minor
      FROM ugc_object_instances instance
      JOIN ugc_object_editions edition ON edition.id=instance.edition_id
      JOIN ugc_object_blueprints blueprint ON blueprint.id=edition.blueprint_id
      LEFT JOIN ugc_market_listings listing ON listing.instance_id=instance.id AND listing.status='active'
      WHERE instance.owner_user_id=${actor.userId}::uuid AND instance.status='active'
      ORDER BY instance.minted_at DESC,instance.id ASC
      LIMIT ${query.limit}
    `;
    return { instances: rows, signature: "Tehkné Solutions" };
  });

  app.get<{ Params: { instanceId: string } }>("/v1/ugc/instances/:instanceId/provenance", async (request) => {
    const actor = await requireActor(app, request);
    const instanceId = z.string().uuid().parse(request.params.instanceId);
    const instance = (await economySql`
      SELECT instance.*,edition.edition_name,edition.scarcity,blueprint.name blueprint_name,
        blueprint.category,blueprint.creator_user_id,blueprint.content_hash
      FROM ugc_object_instances instance
      JOIN ugc_object_editions edition ON edition.id=instance.edition_id
      JOIN ugc_object_blueprints blueprint ON blueprint.id=edition.blueprint_id
      WHERE instance.id=${instanceId}::uuid
    `)[0];
    if (!instance) throw app.httpErrors.notFound("Instância UGC não encontrada.");
    const primary = (await economySql`
      SELECT sold_at,gross_minor,platform_fee_minor,creator_net_minor
      FROM ugc_primary_sales WHERE instance_id=${instanceId}::uuid
    `)[0];
    const trades = await economySql`
      SELECT traded_at,gross_minor,royalty_minor,platform_fee_minor,seller_net_minor
      FROM ugc_market_trades WHERE instance_id=${instanceId}::uuid ORDER BY traded_at ASC,id ASC
    `;
    const chain = [
      ...(primary ? [{ type: "mint", occurredAt: new Date(String(primary.sold_at)).toISOString(), grossMinor: numberOf(primary.gross_minor) }] : []),
      ...trades.map((trade) => ({ type: "resale", occurredAt: new Date(String(trade.traded_at)).toISOString(), grossMinor: numberOf(trade.gross_minor), royaltyMinor: numberOf(trade.royalty_minor) }))
    ];
    return {
      provenance: {
        instanceId,
        serialNumber: numberOf(instance.serial_number),
        provenanceHash: String(instance.provenance_hash),
        contentHash: String(instance.content_hash),
        blueprint: { name: String(instance.blueprint_name), category: String(instance.category), creatorUserId: String(instance.creator_user_id) },
        edition: { name: String(instance.edition_name), scarcity: String(instance.scarcity) },
        mintedAt: new Date(String(instance.minted_at)).toISOString(),
        transferCount: trades.length,
        ownedByRequester: String(instance.owner_user_id) === actor.userId,
        chain
      },
      signature: "Tehkné Solutions"
    };
  });
}

// Tehkné Solutions
