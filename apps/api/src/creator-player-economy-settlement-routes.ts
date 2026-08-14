import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "@nova-aurora/database";
import { CreatorPlayerEconomySettlementService } from "@nova-aurora/database/creator-player-economy-settlement";
import { requireActor } from "./auth-context.js";

const economySql = db();
const settlement = new CreatorPlayerEconomySettlementService();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.trim().length < 8 || key.length > 200) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório, entre 8 e 200 caracteres.");
  }
  return key.trim();
}

const amountSchema = z.object({
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
});

const editionSchema = z.object({
  editionName: z.string().trim().min(1).max(120),
  scarcity: z.enum(["open", "limited", "unique"]).default("open"),
  supplyCap: z.number().int().positive().max(1000000).nullable().optional(),
  unitPriceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  transferable: z.boolean().default(true),
  resaleAllowed: z.boolean().default(true)
});

const listingSchema = z.object({
  priceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
});

const payoutSchema = z.object({
  payouts: z.array(z.object({
    userId: z.string().uuid(),
    prizeMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    finalRank: z.number().int().positive().max(1000000),
    score: z.number().finite().nullable().optional()
  })).min(1).max(1000)
});

const marketQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

export async function registerCreatorPlayerEconomySettlementRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { placementId: string } }>("/v1/ads/placements/:placementId/accept", async (request) => {
    const actor = await requireActor(app, request);
    const placementId = z.string().uuid().parse(request.params.placementId);
    const result = await settlement.acceptAdPlacement({ publisherId: actor.userId, placementId });
    return { ...result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { placementId: string } }>("/v1/ads/placements/:placementId/settle", async (request) => {
    const actor = await requireActor(app, request);
    const placementId = z.string().uuid().parse(request.params.placementId);
    const body = amountSchema.parse(request.body);
    const result = await settlement.settleAdPlacement({
      actorId: actor.userId,
      placementId,
      amountMinor: body.amountMinor,
      idempotencyKey: idempotencyKey(app, request),
      allowPlatformAdmin: actor.roles.includes("platform-admin")
    });
    return { settlement: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { contentId: string } }>("/v1/creator/content/:contentId/purchase", async (request) => {
    const actor = await requireActor(app, request);
    const contentId = z.string().uuid().parse(request.params.contentId);
    const result = await settlement.purchaseContent({
      buyerId: actor.userId,
      contentId,
      idempotencyKey: idempotencyKey(app, request)
    });
    return { purchase: result, signature: "Tehkné Solutions" };
  });

  app.get("/v1/creator/purchases/me", async (request) => {
    const actor = await requireActor(app, request);
    const query = marketQuery.parse(request.query);
    const rows = await economySql`
      SELECT purchase.*,content.title,content.content_type,channel.handle channel_handle
      FROM creator_content_purchases purchase
      JOIN creator_content content ON content.id=purchase.content_id
      JOIN creator_channels channel ON channel.id=content.channel_id
      WHERE purchase.buyer_user_id=${actor.userId}::uuid
      ORDER BY purchase.purchased_at DESC
      LIMIT ${query.limit}
    `;
    return { purchases: rows, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { blueprintId: string } }>("/v1/ugc/blueprints/:blueprintId/editions", async (request) => {
    const actor = await requireActor(app, request);
    const blueprintId = z.string().uuid().parse(request.params.blueprintId);
    const body = editionSchema.parse(request.body);
    const result = await settlement.createUgcEdition({
      creatorId: actor.userId,
      blueprintId,
      editionName: body.editionName,
      scarcity: body.scarcity,
      supplyCap: body.supplyCap ?? null,
      unitPriceMinor: body.unitPriceMinor,
      transferable: body.transferable,
      resaleAllowed: body.resaleAllowed
    });
    return { edition: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { editionId: string } }>("/v1/ugc/editions/:editionId/purchase", async (request) => {
    const actor = await requireActor(app, request);
    const editionId = z.string().uuid().parse(request.params.editionId);
    const result = await settlement.purchaseUgcEdition({
      buyerId: actor.userId,
      editionId,
      idempotencyKey: idempotencyKey(app, request)
    });
    return { sale: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { instanceId: string } }>("/v1/ugc/instances/:instanceId/listings", async (request) => {
    const actor = await requireActor(app, request);
    const instanceId = z.string().uuid().parse(request.params.instanceId);
    const body = listingSchema.parse(request.body);
    const result = await settlement.listUgcInstance({
      sellerId: actor.userId,
      instanceId,
      priceMinor: body.priceMinor
    });
    return { listing: result, signature: "Tehkné Solutions" };
  });

  app.get("/v1/ugc/marketplace", async (request) => {
    const query = marketQuery.parse(request.query);
    const rows = await economySql`
      SELECT listing.*,instance.serial_number,instance.provenance_hash,
        edition.edition_name,edition.scarcity,blueprint.name blueprint_name,
        blueprint.category,blueprint.royalty_bps,blueprint.creator_user_id
      FROM ugc_market_listings listing
      JOIN ugc_object_instances instance ON instance.id=listing.instance_id
      JOIN ugc_object_editions edition ON edition.id=instance.edition_id
      JOIN ugc_object_blueprints blueprint ON blueprint.id=edition.blueprint_id
      WHERE listing.status='active' AND instance.status='active'
      ORDER BY listing.created_at DESC
      LIMIT ${query.limit}
    `;
    return { listings: rows, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { listingId: string } }>("/v1/ugc/listings/:listingId/buy", async (request) => {
    const actor = await requireActor(app, request);
    const listingId = z.string().uuid().parse(request.params.listingId);
    const result = await settlement.buyUgcListing({
      buyerId: actor.userId,
      listingId,
      idempotencyKey: idempotencyKey(app, request)
    });
    return { trade: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { competitionId: string } }>("/v1/competitions/:competitionId/fund", async (request) => {
    const actor = await requireActor(app, request);
    const competitionId = z.string().uuid().parse(request.params.competitionId);
    const body = amountSchema.parse(request.body);
    const result = await settlement.fundCompetition({
      organizerId: actor.userId,
      competitionId,
      amountMinor: body.amountMinor,
      idempotencyKey: idempotencyKey(app, request)
    });
    return { funding: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { competitionId: string } }>("/v1/competitions/:competitionId/join", async (request) => {
    const actor = await requireActor(app, request);
    const competitionId = z.string().uuid().parse(request.params.competitionId);
    const result = await settlement.joinCompetition({
      userId: actor.userId,
      competitionId,
      idempotencyKey: idempotencyKey(app, request)
    });
    return { entry: result, signature: "Tehkné Solutions" };
  });

  app.post<{ Params: { competitionId: string } }>("/v1/competitions/:competitionId/settle", async (request) => {
    const actor = await requireActor(app, request);
    const competitionId = z.string().uuid().parse(request.params.competitionId);
    const body = payoutSchema.parse(request.body);
    const payouts = body.payouts.map((payout) => ({
      userId: payout.userId,
      prizeMinor: payout.prizeMinor,
      finalRank: payout.finalRank,
      score: payout.score ?? null
    }));
    const result = await settlement.settleCompetition({
      organizerId: actor.userId,
      competitionId,
      payouts,
      idempotencyKey: idempotencyKey(app, request)
    });
    return { settlement: result, signature: "Tehkné Solutions" };
  });

  app.get<{ Params: { competitionId: string } }>("/v1/competitions/:competitionId/finance", async (request) => {
    const actor = await requireActor(app, request);
    const competitionId = z.string().uuid().parse(request.params.competitionId);
    const competition = (await economySql`
      SELECT id,organizer_user_id,status,entry_pool_minor,sponsor_funded_minor,prize_paid_minor
      FROM player_competitions WHERE id=${competitionId}::uuid
    `)[0];
    if (!competition) throw app.httpErrors.notFound("Competição não encontrada.");
    if (String(competition.organizer_user_id) !== actor.userId && !actor.roles.includes("platform-admin")) {
      throw app.httpErrors.forbidden("Resumo financeiro disponível apenas ao organizador ou administração.");
    }
    const entryPoolMinor = Number(competition.entry_pool_minor ?? 0);
    const sponsorFundedMinor = Number(competition.sponsor_funded_minor ?? 0);
    const prizePaidMinor = Number(competition.prize_paid_minor ?? 0);
    return {
      finance: {
        competitionId,
        status: String(competition.status),
        entryPoolMinor,
        sponsorFundedMinor,
        prizePaidMinor,
        availablePrizePoolMinor: entryPoolMinor + sponsorFundedMinor - prizePaidMinor
      },
      signature: "Tehkné Solutions"
    };
  });
}

// Tehkné Solutions
