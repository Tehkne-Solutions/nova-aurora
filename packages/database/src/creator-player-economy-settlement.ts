import { createHash, randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";

const CONTENT_PLATFORM_FEE_BPS = 1000;
const UGC_PLATFORM_FEE_BPS = 500;

function share(amountMinor: number, basisPoints: number): number {
  return Math.floor((amountMinor * basisPoints) / 10000);
}

function positiveMinor(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} precisa ser positivo.`);
  return value;
}

export class CreatorPlayerEconomySettlementService extends EconomyRepositoryBase {
  private async assertBalance(tx: Tx, accountId: string, requiredMinor: number): Promise<void> {
    await tx`SELECT id FROM ledger_accounts WHERE id=${accountId}::uuid FOR UPDATE`;
    const rows = await tx`
      SELECT available_minor FROM ledger_account_balances WHERE account_id=${accountId}::uuid
    `;
    if (Number(rows[0]?.available_minor ?? 0) < requiredMinor) {
      throw new Error("Saldo disponível insuficiente.");
    }
  }

  async acceptAdPlacement(input: { publisherId: string; placementId: string }) {
    return this.sql.begin("isolation level serializable", async (tx) => {
      const placement = (await tx`
        SELECT p.*,s.owner_user_id,c.campaign_kind,c.status campaign_status
        FROM economy_ad_placements p
        JOIN economy_ad_surfaces s ON s.id=p.surface_id
        JOIN economy_ad_campaigns c ON c.id=p.campaign_id
        WHERE p.id=${input.placementId}::uuid
        FOR UPDATE OF p,s,c
      `)[0];
      if (!placement) throw new Error("Placement publicitário não encontrado.");
      if (String(placement.owner_user_id) !== input.publisherId) {
        throw new Error("Somente o proprietário da superfície pode aceitar o placement.");
      }
      if (!["proposed", "approved"].includes(String(placement.status))) {
        throw new Error("Placement não pode ser ativado no estado atual.");
      }
      await tx`
        UPDATE economy_ad_placements SET status='active',updated_at=now()
        WHERE id=${input.placementId}::uuid
      `;
      if (String(placement.campaign_kind) === "internal" && String(placement.campaign_status) === "draft") {
        await tx`
          UPDATE economy_ad_campaigns SET status='active',updated_at=now()
          WHERE id=${String(placement.campaign_id)}::uuid
        `;
      }
      await this.outbox(tx, input.placementId, "creator-economy.ad-placement.activated", {
        placementId: input.placementId,
        publisherId: input.publisherId,
        campaignId: String(placement.campaign_id)
      });
      return { placementId: input.placementId, status: "active" as const };
    });
  }

  async settleAdPlacement(input: {
    actorId: string;
    placementId: string;
    amountMinor: number;
    idempotencyKey: string;
    allowPlatformAdmin?: boolean;
  }) {
    const amountMinor = positiveMinor(input.amountMinor, "Valor do settlement");
    return this.idempotent(input.idempotencyKey, input.actorId, input, async (tx) => {
      const placement = (await tx`
        SELECT * FROM economy_ad_placements WHERE id=${input.placementId}::uuid FOR UPDATE
      `)[0];
      if (!placement) throw new Error("Placement publicitário não encontrado.");
      if (String(placement.status) !== "active") throw new Error("Placement precisa estar ativo.");

      const campaign = (await tx`
        SELECT * FROM economy_ad_campaigns WHERE id=${String(placement.campaign_id)}::uuid FOR UPDATE
      `)[0];
      if (!campaign) throw new Error("Campanha publicitária não encontrada.");
      const advertiserId = String(campaign.advertiser_user_id ?? "");
      if (!input.allowPlatformAdmin && advertiserId !== input.actorId) {
        throw new Error("Somente o anunciante pode liquidar esta campanha.");
      }
      if (!advertiserId) throw new Error("Campanha sem conta de anunciante liquidável.");
      const budget = Number(campaign.budget_minor ?? 0);
      const spent = Number(campaign.spent_minor ?? 0);
      if (budget > 0 && spent + amountMinor > budget) throw new Error("Budget da campanha excedido.");

      const surface = (await tx`
        SELECT * FROM economy_ad_surfaces WHERE id=${String(placement.surface_id)}::uuid FOR UPDATE
      `)[0];
      if (!surface) throw new Error("Superfície publicitária não encontrada.");
      const publisherId = String(surface.owner_user_id);
      const publisherBps = Number(placement.publisher_share_bps);
      const publisherMinor = share(amountMinor, publisherBps);
      const platformMinor = amountMinor - publisherMinor;
      const advertiser = await this.walletAccount(tx, advertiserId);
      const publisher = await this.walletAccount(tx, publisherId);
      const cityAccountId = await this.cityAccountId(tx);
      await this.assertBalance(tx, advertiser.id, amountMinor);
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `creator-economy:ad:${input.idempotencyKey}`,
        type: "creator-economy-ad-settlement",
        entries: [
          { accountId: advertiser.id, amount: -amountMinor, memo: "Compra de mídia no Nova Aurora" },
          { accountId: publisher.id, amount: publisherMinor, memo: "Receita de superfície publicitária" },
          { accountId: cityAccountId, amount: platformMinor, memo: "Taxa de infraestrutura publicitária" }
        ]
      });
      const settlementId = randomUUID();
      await tx`
        INSERT INTO economy_ad_settlements(
          id,placement_id,campaign_id,advertiser_user_id,publisher_user_id,gross_minor,
          publisher_minor,platform_minor,ledger_transaction_id,idempotency_key
        ) VALUES(
          ${settlementId}::uuid,${input.placementId}::uuid,${String(campaign.id)}::uuid,
          ${advertiserId}::uuid,${publisherId}::uuid,${amountMinor},${publisherMinor},${platformMinor},
          ${ledgerTransactionId}::uuid,${input.idempotencyKey}
        )
      `;
      await tx`
        UPDATE economy_ad_campaigns SET spent_minor=spent_minor+${amountMinor},updated_at=now()
        WHERE id=${String(campaign.id)}::uuid
      `;
      await this.outbox(tx, settlementId, "creator-economy.ad-settlement.completed", {
        settlementId, placementId: input.placementId, advertiserId, publisherId,
        grossMinor: amountMinor, publisherMinor, platformMinor, ledgerTransactionId
      });
      return { settlementId, grossMinor: amountMinor, publisherMinor, platformMinor, ledgerTransactionId };
    });
  }

  async purchaseContent(input: { buyerId: string; contentId: string; idempotencyKey: string }) {
    return this.idempotent(input.idempotencyKey, input.buyerId, input, async (tx) => {
      const existing = (await tx`
        SELECT * FROM creator_content_purchases
        WHERE content_id=${input.contentId}::uuid AND buyer_user_id=${input.buyerId}::uuid
      `)[0];
      if (existing) {
        return {
          purchaseId: String(existing.id), grossMinor: Number(existing.gross_minor),
          creatorNetMinor: Number(existing.creator_net_minor), platformFeeMinor: Number(existing.platform_fee_minor),
          ledgerTransactionId: String(existing.ledger_transaction_id)
        };
      }
      const content = (await tx`
        SELECT * FROM creator_content WHERE id=${input.contentId}::uuid FOR UPDATE
      `)[0];
      if (!content || String(content.status) !== "published") throw new Error("Conteúdo publicado não encontrado.");
      if (String(content.access_model) === "free") throw new Error("Conteúdo gratuito não exige compra.");
      const creatorId = String(content.creator_user_id);
      if (creatorId === input.buyerId) throw new Error("O criador já possui acesso ao próprio conteúdo.");
      const grossMinor = positiveMinor(Number(content.price_minor), "Preço do conteúdo");
      const platformFeeMinor = share(grossMinor, CONTENT_PLATFORM_FEE_BPS);
      const creatorNetMinor = grossMinor - platformFeeMinor;
      const buyer = await this.walletAccount(tx, input.buyerId);
      const creator = await this.walletAccount(tx, creatorId);
      const cityAccountId = await this.cityAccountId(tx);
      await this.assertBalance(tx, buyer.id, grossMinor);
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `creator-economy:content:${input.idempotencyKey}`,
        type: "creator-content-purchase",
        entries: [
          { accountId: buyer.id, amount: -grossMinor, memo: "Compra de conteúdo" },
          { accountId: creator.id, amount: creatorNetMinor, memo: "Receita de conteúdo" },
          { accountId: cityAccountId, amount: platformFeeMinor, memo: "Taxa de infraestrutura de conteúdo" }
        ]
      });
      const purchaseId = randomUUID();
      await tx`
        INSERT INTO creator_content_purchases(
          id,content_id,buyer_user_id,creator_user_id,gross_minor,platform_fee_minor,
          creator_net_minor,ledger_transaction_id,idempotency_key
        ) VALUES(
          ${purchaseId}::uuid,${input.contentId}::uuid,${input.buyerId}::uuid,${creatorId}::uuid,
          ${grossMinor},${platformFeeMinor},${creatorNetMinor},${ledgerTransactionId}::uuid,${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, purchaseId, "creator-economy.content.purchased", {
        purchaseId, contentId: input.contentId, buyerId: input.buyerId, creatorId,
        grossMinor, creatorNetMinor, platformFeeMinor, ledgerTransactionId
      });
      return { purchaseId, grossMinor, creatorNetMinor, platformFeeMinor, ledgerTransactionId };
    });
  }

  async createUgcEdition(input: {
    creatorId: string;
    blueprintId: string;
    editionName: string;
    scarcity: "open" | "limited" | "unique";
    supplyCap?: number | null;
    unitPriceMinor: number;
    transferable: boolean;
    resaleAllowed: boolean;
  }) {
    return this.sql.begin("isolation level serializable", async (tx) => {
      const blueprint = (await tx`
        SELECT * FROM ugc_object_blueprints WHERE id=${input.blueprintId}::uuid FOR UPDATE
      `)[0];
      if (!blueprint || String(blueprint.creator_user_id) !== input.creatorId || String(blueprint.status) !== "published") {
        throw new Error("Blueprint publicado do criador não encontrado.");
      }
      const supplyCap = input.scarcity === "unique" ? 1 : input.supplyCap ?? null;
      if (input.scarcity !== "open" && (!supplyCap || supplyCap <= 0)) {
        throw new Error("Edição limitada precisa possuir supplyCap positivo.");
      }
      const id = randomUUID();
      await tx`
        INSERT INTO ugc_object_editions(
          id,blueprint_id,edition_name,scarcity,supply_cap,unit_price_minor,transferable,resale_allowed,
          tokenization_eligible
        ) VALUES(
          ${id}::uuid,${input.blueprintId}::uuid,${input.editionName},${input.scarcity},${supplyCap},
          ${input.unitPriceMinor},${input.transferable},${input.resaleAllowed},
          ${String(blueprint.tokenization_status) !== "disabled"}
        )
      `;
      return { editionId: id };
    });
  }

  async purchaseUgcEdition(input: { buyerId: string; editionId: string; idempotencyKey: string }) {
    return this.idempotent(input.idempotencyKey, input.buyerId, input, async (tx) => {
      const edition = (await tx`
        SELECT e.*,b.creator_user_id,b.id blueprint_id
        FROM ugc_object_editions e JOIN ugc_object_blueprints b ON b.id=e.blueprint_id
        WHERE e.id=${input.editionId}::uuid FOR UPDATE OF e,b
      `)[0];
      if (!edition) throw new Error("Edição UGC não encontrada.");
      const supplyCap = edition.supply_cap === null ? null : Number(edition.supply_cap);
      const minted = Number(edition.minted_count);
      if (supplyCap !== null && minted >= supplyCap) throw new Error("Edição esgotada.");
      const grossMinor = positiveMinor(Number(edition.unit_price_minor), "Preço da edição");
      const creatorId = String(edition.creator_user_id);
      const platformFeeMinor = share(grossMinor, UGC_PLATFORM_FEE_BPS);
      const creatorNetMinor = grossMinor - platformFeeMinor;
      const buyer = await this.walletAccount(tx, input.buyerId);
      const creator = await this.walletAccount(tx, creatorId);
      const cityAccountId = await this.cityAccountId(tx);
      await this.assertBalance(tx, buyer.id, grossMinor);
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `creator-economy:ugc-primary:${input.idempotencyKey}`,
        type: "ugc-primary-sale",
        entries: [
          { accountId: buyer.id, amount: -grossMinor, memo: "Compra primária de objeto UGC" },
          { accountId: creator.id, amount: creatorNetMinor, memo: "Venda primária de objeto UGC" },
          { accountId: cityAccountId, amount: platformFeeMinor, memo: "Taxa de marketplace UGC" }
        ]
      });
      const serialNumber = minted + 1;
      const instanceId = randomUUID();
      const provenanceHash = createHash("sha256")
        .update(`${input.editionId}:${serialNumber}:${input.buyerId}:${input.idempotencyKey}`)
        .digest("hex");
      await tx`
        INSERT INTO ugc_object_instances(
          id,edition_id,serial_number,owner_user_id,origin_creator_user_id,provenance_hash
        ) VALUES(
          ${instanceId}::uuid,${input.editionId}::uuid,${serialNumber},${input.buyerId}::uuid,
          ${creatorId}::uuid,${provenanceHash}
        )
      `;
      await tx`UPDATE ugc_object_editions SET minted_count=minted_count+1 WHERE id=${input.editionId}::uuid`;
      const saleId = randomUUID();
      await tx`
        INSERT INTO ugc_primary_sales(
          id,edition_id,blueprint_id,instance_id,buyer_user_id,creator_user_id,gross_minor,
          platform_fee_minor,creator_net_minor,ledger_transaction_id,idempotency_key
        ) VALUES(
          ${saleId}::uuid,${input.editionId}::uuid,${String(edition.blueprint_id)}::uuid,${instanceId}::uuid,
          ${input.buyerId}::uuid,${creatorId}::uuid,${grossMinor},${platformFeeMinor},${creatorNetMinor},
          ${ledgerTransactionId}::uuid,${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, saleId, "creator-economy.ugc.primary-sale", {
        saleId, instanceId, editionId: input.editionId, buyerId: input.buyerId, creatorId,
        serialNumber, grossMinor, creatorNetMinor, platformFeeMinor, provenanceHash
      });
      return { saleId, instanceId, serialNumber, provenanceHash, grossMinor, creatorNetMinor, platformFeeMinor };
    });
  }

  async listUgcInstance(input: { sellerId: string; instanceId: string; priceMinor: number }) {
    const priceMinor = positiveMinor(input.priceMinor, "Preço do anúncio");
    return this.sql.begin("isolation level serializable", async (tx) => {
      const instance = (await tx`
        SELECT i.*,e.transferable,e.resale_allowed
        FROM ugc_object_instances i JOIN ugc_object_editions e ON e.id=i.edition_id
        WHERE i.id=${input.instanceId}::uuid FOR UPDATE OF i,e
      `)[0];
      if (!instance || String(instance.owner_user_id) !== input.sellerId || String(instance.status) !== "active") {
        throw new Error("Instância UGC ativa do vendedor não encontrada.");
      }
      if (!Boolean(instance.transferable) || !Boolean(instance.resale_allowed)) {
        throw new Error("Esta edição não permite revenda.");
      }
      const existing = (await tx`
        SELECT id FROM ugc_market_listings WHERE instance_id=${input.instanceId}::uuid AND status='active'
      `)[0];
      if (existing) throw new Error("Instância já possui anúncio ativo.");
      const listingId = randomUUID();
      await tx`
        INSERT INTO ugc_market_listings(id,instance_id,seller_user_id,price_minor)
        VALUES(${listingId}::uuid,${input.instanceId}::uuid,${input.sellerId}::uuid,${priceMinor})
      `;
      return { listingId, priceMinor };
    });
  }

  async buyUgcListing(input: { buyerId: string; listingId: string; idempotencyKey: string }) {
    return this.idempotent(input.idempotencyKey, input.buyerId, input, async (tx) => {
      const listing = (await tx`
        SELECT l.*,i.owner_user_id,i.origin_creator_user_id,i.status instance_status,
          e.resale_allowed,b.royalty_bps
        FROM ugc_market_listings l
        JOIN ugc_object_instances i ON i.id=l.instance_id
        JOIN ugc_object_editions e ON e.id=i.edition_id
        JOIN ugc_object_blueprints b ON b.id=e.blueprint_id
        WHERE l.id=${input.listingId}::uuid FOR UPDATE OF l,i,e,b
      `)[0];
      if (!listing || String(listing.status) !== "active") throw new Error("Anúncio UGC ativo não encontrado.");
      const sellerId = String(listing.seller_user_id);
      if (sellerId === input.buyerId) throw new Error("O vendedor não pode comprar o próprio anúncio.");
      if (String(listing.owner_user_id) !== sellerId || String(listing.instance_status) !== "active") {
        throw new Error("Propriedade da instância mudou; anúncio inválido.");
      }
      if (!Boolean(listing.resale_allowed)) throw new Error("Revenda não permitida.");
      const creatorId = String(listing.origin_creator_user_id);
      const grossMinor = positiveMinor(Number(listing.price_minor), "Preço do anúncio");
      const royaltyMinor = share(grossMinor, Number(listing.royalty_bps));
      const platformFeeMinor = share(grossMinor, UGC_PLATFORM_FEE_BPS);
      const sellerNetMinor = grossMinor - royaltyMinor - platformFeeMinor;
      const buyer = await this.walletAccount(tx, input.buyerId);
      const seller = await this.walletAccount(tx, sellerId);
      const creator = await this.walletAccount(tx, creatorId);
      const cityAccountId = await this.cityAccountId(tx);
      await this.assertBalance(tx, buyer.id, grossMinor);
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `creator-economy:ugc-secondary:${input.idempotencyKey}`,
        type: "ugc-secondary-sale",
        entries: [
          { accountId: buyer.id, amount: -grossMinor, memo: "Compra secundária de objeto UGC" },
          { accountId: seller.id, amount: sellerNetMinor, memo: "Venda secundária de objeto UGC" },
          { accountId: creator.id, amount: royaltyMinor, memo: "Royalty de autoria UGC" },
          { accountId: cityAccountId, amount: platformFeeMinor, memo: "Taxa de marketplace UGC" }
        ]
      });
      await tx`
        UPDATE ugc_object_instances SET owner_user_id=${input.buyerId}::uuid
        WHERE id=${String(listing.instance_id)}::uuid
      `;
      await tx`
        UPDATE ugc_market_listings SET status='sold',closed_at=now()
        WHERE id=${input.listingId}::uuid
      `;
      const tradeId = randomUUID();
      await tx`
        INSERT INTO ugc_market_trades(
          id,listing_id,instance_id,buyer_user_id,seller_user_id,creator_user_id,gross_minor,
          royalty_minor,platform_fee_minor,seller_net_minor,ledger_transaction_id,idempotency_key
        ) VALUES(
          ${tradeId}::uuid,${input.listingId}::uuid,${String(listing.instance_id)}::uuid,
          ${input.buyerId}::uuid,${sellerId}::uuid,${creatorId}::uuid,${grossMinor},${royaltyMinor},
          ${platformFeeMinor},${sellerNetMinor},${ledgerTransactionId}::uuid,${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, tradeId, "creator-economy.ugc.secondary-sale", {
        tradeId, listingId: input.listingId, instanceId: String(listing.instance_id), buyerId: input.buyerId,
        sellerId, creatorId, grossMinor, royaltyMinor, platformFeeMinor, sellerNetMinor
      });
      return { tradeId, grossMinor, royaltyMinor, platformFeeMinor, sellerNetMinor };
    });
  }

  async fundCompetition(input: {
    organizerId: string;
    competitionId: string;
    amountMinor: number;
    idempotencyKey: string;
  }) {
    const amountMinor = positiveMinor(input.amountMinor, "Patrocínio");
    return this.idempotent(input.idempotencyKey, input.organizerId, input, async (tx) => {
      const competition = (await tx`
        SELECT * FROM player_competitions WHERE id=${input.competitionId}::uuid FOR UPDATE
      `)[0];
      if (!competition || String(competition.organizer_user_id) !== input.organizerId) {
        throw new Error("Competição do organizador não encontrada.");
      }
      if (!["draft", "open"].includes(String(competition.status))) {
        throw new Error("Competição não aceita novo funding.");
      }
      const organizer = await this.walletAccount(tx, input.organizerId);
      const cityAccountId = await this.cityAccountId(tx);
      await this.assertBalance(tx, organizer.id, amountMinor);
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `creator-economy:competition-funding:${input.idempotencyKey}`,
        type: "competition-sponsor-funding",
        entries: [
          { accountId: organizer.id, amount: -amountMinor, memo: "Funding de prize pool" },
          { accountId: cityAccountId, amount: amountMinor, memo: "Custódia de prize pool" }
        ]
      });
      const eventId = randomUUID();
      await tx`
        INSERT INTO player_competition_finance_events(
          id,competition_id,event_type,actor_user_id,amount_minor,ledger_transaction_id,idempotency_key
        ) VALUES(
          ${eventId}::uuid,${input.competitionId}::uuid,'sponsor_funding',${input.organizerId}::uuid,
          ${amountMinor},${ledgerTransactionId}::uuid,${input.idempotencyKey}
        )
      `;
      await tx`
        UPDATE player_competitions SET sponsor_funded_minor=sponsor_funded_minor+${amountMinor},updated_at=now()
        WHERE id=${input.competitionId}::uuid
      `;
      return { eventId, amountMinor, ledgerTransactionId };
    });
  }

  async joinCompetition(input: { userId: string; competitionId: string; idempotencyKey: string }) {
    return this.idempotent(input.idempotencyKey, input.userId, input, async (tx) => {
      const competition = (await tx`
        SELECT * FROM player_competitions WHERE id=${input.competitionId}::uuid FOR UPDATE
      `)[0];
      if (!competition || String(competition.status) !== "open") throw new Error("Competição aberta não encontrada.");
      const existing = (await tx`
        SELECT * FROM player_competition_entries
        WHERE competition_id=${input.competitionId}::uuid AND user_id=${input.userId}::uuid
      `)[0];
      if (existing) return { joined: true, paidEntryMinor: Number(existing.paid_entry_minor), ledgerTransactionId: null };
      const count = (await tx`
        SELECT count(*)::int total FROM player_competition_entries WHERE competition_id=${input.competitionId}::uuid
      `)[0];
      const maxPlayers = competition.max_players === null ? null : Number(competition.max_players);
      if (maxPlayers !== null && Number(count?.total ?? 0) >= maxPlayers) throw new Error("Competição lotada.");
      const feeMinor = Number(competition.entry_fee_minor ?? 0);
      let ledgerTransactionId: string | null = null;
      if (feeMinor > 0) {
        const player = await this.walletAccount(tx, input.userId);
        const cityAccountId = await this.cityAccountId(tx);
        await this.assertBalance(tx, player.id, feeMinor);
        ledgerTransactionId = await this.postLedger(tx, {
          key: `creator-economy:competition-entry:${input.idempotencyKey}`,
          type: "competition-entry-fee",
          entries: [
            { accountId: player.id, amount: -feeMinor, memo: "Taxa de inscrição em competição" },
            { accountId: cityAccountId, amount: feeMinor, memo: "Custódia de entry pool" }
          ]
        });
        const eventId = randomUUID();
        await tx`
          INSERT INTO player_competition_finance_events(
            id,competition_id,event_type,actor_user_id,beneficiary_user_id,amount_minor,
            ledger_transaction_id,idempotency_key
          ) VALUES(
            ${eventId}::uuid,${input.competitionId}::uuid,'entry_fee',${input.userId}::uuid,
            ${input.userId}::uuid,${feeMinor},${ledgerTransactionId}::uuid,${input.idempotencyKey}
          )
        `;
        await tx`
          UPDATE player_competitions SET entry_pool_minor=entry_pool_minor+${feeMinor},updated_at=now()
          WHERE id=${input.competitionId}::uuid
        `;
      }
      await tx`
        INSERT INTO player_competition_entries(competition_id,user_id,paid_entry_minor)
        VALUES(${input.competitionId}::uuid,${input.userId}::uuid,${feeMinor})
      `;
      return { joined: true, paidEntryMinor: feeMinor, ledgerTransactionId };
    });
  }

  async settleCompetition(input: {
    organizerId: string;
    competitionId: string;
    payouts: readonly Readonly<{ userId: string; prizeMinor: number; finalRank: number; score?: number | null }>[];
    idempotencyKey: string;
  }) {
    return this.idempotent(input.idempotencyKey, input.organizerId, input, async (tx) => {
      const competition = (await tx`
        SELECT * FROM player_competitions WHERE id=${input.competitionId}::uuid FOR UPDATE
      `)[0];
      if (!competition || String(competition.organizer_user_id) !== input.organizerId) {
        throw new Error("Competição do organizador não encontrada.");
      }
      if (!["open", "running"].includes(String(competition.status))) {
        throw new Error("Competição não pode ser liquidada no estado atual.");
      }
      if (input.payouts.length === 0) throw new Error("Informe ao menos um payout.");
      const seenUsers = new Set<string>();
      const seenRanks = new Set<number>();
      let totalPrizeMinor = 0;
      for (const payout of input.payouts) {
        positiveMinor(payout.prizeMinor, "Prêmio");
        if (!Number.isInteger(payout.finalRank) || payout.finalRank <= 0) throw new Error("Ranking final inválido.");
        if (seenUsers.has(payout.userId) || seenRanks.has(payout.finalRank)) throw new Error("Payout duplicado.");
        seenUsers.add(payout.userId);
        seenRanks.add(payout.finalRank);
        totalPrizeMinor += payout.prizeMinor;
      }
      const availablePool = Number(competition.entry_pool_minor) + Number(competition.sponsor_funded_minor)
        - Number(competition.prize_paid_minor);
      if (totalPrizeMinor > availablePool) throw new Error("Prize pool lastreado insuficiente.");
      const entryRows = await tx`
        SELECT user_id,status FROM player_competition_entries
        WHERE competition_id=${input.competitionId}::uuid FOR UPDATE
      `;
      const eligible = new Set(entryRows.filter((row) => String(row.status) !== "disqualified").map((row) => String(row.user_id)));
      for (const payout of input.payouts) {
        if (!eligible.has(payout.userId)) throw new Error("Payout contém usuário não elegível.");
      }
      const cityAccountId = await this.cityAccountId(tx);
      await this.assertBalance(tx, cityAccountId, totalPrizeMinor);
      const payoutAccounts: { userId: string; accountId: string; prizeMinor: number; finalRank: number; score?: number | null }[] = [];
      for (const payout of input.payouts) {
        const account = await this.walletAccount(tx, payout.userId);
        payoutAccounts.push({ ...payout, accountId: account.id });
      }
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `creator-economy:competition-payout:${input.idempotencyKey}`,
        type: "competition-prize-payout",
        entries: [
          { accountId: cityAccountId, amount: -totalPrizeMinor, memo: "Liquidação de prize pool" },
          ...payoutAccounts.map((payout) => ({
            accountId: payout.accountId,
            amount: payout.prizeMinor,
            memo: `Prêmio de competição - posição ${payout.finalRank}`
          }))
        ]
      });
      for (const payout of payoutAccounts) {
        await tx`
          UPDATE player_competition_entries
          SET prize_minor=${payout.prizeMinor},final_rank=${payout.finalRank},score=${payout.score ?? null},status='settled'
          WHERE competition_id=${input.competitionId}::uuid AND user_id=${payout.userId}::uuid
        `;
        await tx`
          INSERT INTO player_competition_finance_events(
            id,competition_id,event_type,actor_user_id,beneficiary_user_id,amount_minor,
            ledger_transaction_id,idempotency_key
          ) VALUES(
            ${randomUUID()}::uuid,${input.competitionId}::uuid,'prize_payout',${input.organizerId}::uuid,
            ${payout.userId}::uuid,${payout.prizeMinor},${ledgerTransactionId}::uuid,
            ${`${input.idempotencyKey}:${payout.userId}`}
          )
        `;
      }
      await tx`
        UPDATE player_competition_entries SET status='settled'
        WHERE competition_id=${input.competitionId}::uuid AND status IN ('joined','active')
      `;
      await tx`
        UPDATE player_competitions
        SET prize_paid_minor=prize_paid_minor+${totalPrizeMinor},status='settled',updated_at=now()
        WHERE id=${input.competitionId}::uuid
      `;
      await this.outbox(tx, input.competitionId, "creator-economy.competition.settled", {
        competitionId: input.competitionId, organizerId: input.organizerId,
        totalPrizeMinor, winners: payoutAccounts.map(({ userId, prizeMinor, finalRank }) => ({ userId, prizeMinor, finalRank })),
        ledgerTransactionId
      });
      return { competitionId: input.competitionId, totalPrizeMinor, ledgerTransactionId };
    });
  }
}

// Tehkné Solutions
