import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BusinessOperationsService,
  db,
  MarketProductionService,
  PropertyBusinessService
} from "@nova-aurora/database";
import { requireActorId } from "./auth-context.js";
import { enqueueProductionCompletion } from "./queue.js";

const economy = new MarketProductionService();
const businessOperations = new BusinessOperationsService();
const propertyBusiness = new PropertyBusinessService();
const sql = db();

const WORLD_RECIPE_LOCATIONS = new Map<string, string>([
  ["flour", "green-cooperative"],
  ["bread", "green-cooperative"]
]);
const WORLD_MARKET_LOCATION = "municipal-market";

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return key;
}

async function currentLocation(ownerId: string): Promise<Readonly<{
  code: string;
  name: string;
  locationType: string;
  districtCode: string;
  districtName: string;
}>> {
  const rows = await sql`
    SELECT location.code,location.name,location.location_type,
      district.code district_code,district.name district_name
    FROM player_world_state state
    JOIN city_locations location ON location.id=state.location_id
    JOIN city_districts district ON district.id=state.district_id
    WHERE state.user_id=${ownerId}::uuid
  `;
  const row = rows[0];
  if (!row) throw new Error("Localização do jogador não encontrada.");
  return {
    code: String(row.code),
    name: String(row.name),
    locationType: String(row.location_type),
    districtCode: String(row.district_code),
    districtName: String(row.district_name)
  };
}

async function assertLocation(
  app: FastifyInstance,
  ownerId: string,
  requiredLocationCode: string
): Promise<void> {
  const location = await currentLocation(ownerId);
  if (location.code !== requiredLocationCode) {
    throw app.httpErrors.forbidden(
      `Viaje até ${requiredLocationCode} para realizar esta ação no mundo.`
    );
  }
}

async function localBusinesses(locationCode: string) {
  const [buildingRows, catalogRows, campaignRows] = await Promise.all([
    sql`
      SELECT building.id,building.name,building.building_type,building.level,
        building.condition,building.capacity,building.status,
        plot.code plot_code,company.id company_id,company.name company_name,
        company.owner_id,owner.display_name owner_name,
        COALESCE(reputation.score,50)::integer reputation_score,
        COALESCE(reputation.review_count,0)::integer review_count,
        COALESCE((
          SELECT COUNT(*) FROM property_visits visit
          WHERE visit.plot_id=plot.id AND visit.visited_at>=now()-interval '7 days'
        ),0)::integer recent_world_visits,
        COALESCE((
          SELECT SUM(cycle.visitors) FROM business_demand_cycles cycle
          WHERE cycle.building_id=building.id AND cycle.created_at>=now()-interval '7 days'
        ),0)::integer recent_demand_visitors,
        COALESCE((
          SELECT SUM(cycle.customers) FROM business_demand_cycles cycle
          WHERE cycle.building_id=building.id AND cycle.created_at>=now()-interval '7 days'
        ),0)::integer recent_customers,
        COALESCE((
          SELECT SUM(cycle.gross_revenue_minor) FROM business_demand_cycles cycle
          WHERE cycle.building_id=building.id AND cycle.created_at>=now()-interval '7 days'
        ),0)::bigint recent_revenue_minor
      FROM property_buildings building
      JOIN property_plots plot ON plot.id=building.plot_id
      JOIN city_locations location ON location.id=plot.location_id
      JOIN companies company ON company.id=building.company_id
      JOIN users owner ON owner.id=company.owner_id
      LEFT JOIN company_reputation reputation ON reputation.company_id=company.id
      WHERE location.code=${locationCode} AND building.status='active'
      ORDER BY building.name,building.id
    `,
    sql`
      SELECT catalog.id,catalog.building_id,catalog.code,catalog.title,
        catalog.description,catalog.category,catalog.unit_price_minor,
        catalog.capacity_per_cycle
      FROM business_catalog_entries catalog
      JOIN property_buildings building ON building.id=catalog.building_id
      JOIN property_plots plot ON plot.id=building.plot_id
      JOIN city_locations location ON location.id=plot.location_id
      WHERE location.code=${locationCode} AND catalog.status='active'
      ORDER BY catalog.title,catalog.id
    `,
    sql`
      SELECT campaign.id,campaign.building_id,campaign.name,campaign.channel,
        campaign.budget_minor,campaign.visitor_boost_pct,campaign.conversions,
        campaign.attributed_revenue_minor,campaign.status,campaign.starts_at,campaign.ends_at
      FROM marketing_campaigns campaign
      JOIN property_buildings building ON building.id=campaign.building_id
      JOIN property_plots plot ON plot.id=building.plot_id
      JOIN city_locations location ON location.id=plot.location_id
      WHERE location.code=${locationCode}
        AND campaign.status='active'
        AND campaign.starts_at<=now()
        AND campaign.ends_at>now()
      ORDER BY campaign.visitor_boost_pct DESC,campaign.starts_at DESC,campaign.id
    `
  ]);

  const catalogByBuilding = new Map<string, Array<Readonly<{
    id: string;
    code: string;
    title: string;
    description: string;
    category: string;
    unitPriceMinor: number;
    capacityPerCycle: number;
  }>>>();
  for (const row of catalogRows) {
    const buildingId = String(row.building_id);
    const current = catalogByBuilding.get(buildingId) ?? [];
    current.push({
      id: String(row.id),
      code: String(row.code),
      title: String(row.title),
      description: String(row.description),
      category: String(row.category),
      unitPriceMinor: Number(row.unit_price_minor),
      capacityPerCycle: Number(row.capacity_per_cycle)
    });
    catalogByBuilding.set(buildingId, current);
  }

  const campaignsByBuilding = new Map<string, Array<Readonly<{
    id: string;
    name: string;
    channel: string;
    budgetMinor: number;
    visitorBoostPct: number;
    conversions: number;
    attributedRevenueMinor: number;
    endsAt: string;
    worldPlacement: boolean;
  }>>>();
  for (const row of campaignRows) {
    const buildingId = String(row.building_id);
    const channel = String(row.channel);
    const current = campaignsByBuilding.get(buildingId) ?? [];
    current.push({
      id: String(row.id),
      name: String(row.name),
      channel,
      budgetMinor: Number(row.budget_minor),
      visitorBoostPct: Number(row.visitor_boost_pct),
      conversions: Number(row.conversions),
      attributedRevenueMinor: Number(row.attributed_revenue_minor),
      endsAt: new Date(String(row.ends_at)).toISOString(),
      worldPlacement: channel === "local" || channel === "outdoor"
    });
    campaignsByBuilding.set(buildingId, current);
  }

  return buildingRows.map((row) => ({
    buildingId: String(row.id),
    plotCode: String(row.plot_code),
    companyId: String(row.company_id),
    companyName: String(row.company_name),
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name),
    buildingName: String(row.name),
    buildingType: String(row.building_type),
    level: Number(row.level),
    condition: Number(row.condition),
    capacity: Number(row.capacity),
    reputationScore: Number(row.reputation_score),
    reviewCount: Number(row.review_count),
    recentWorldVisits: Number(row.recent_world_visits),
    recentDemandVisitors: Number(row.recent_demand_visitors),
    recentCustomers: Number(row.recent_customers),
    recentRevenueMinor: Number(row.recent_revenue_minor),
    catalog: catalogByBuilding.get(String(row.id)) ?? [],
    activeCampaigns: campaignsByBuilding.get(String(row.id)) ?? []
  }));
}

async function worldBuilding(buildingId: string) {
  const rows = await sql`
    SELECT building.id,building.status,plot.code plot_code,location.code location_code,
      company.id company_id,company.owner_id
    FROM property_buildings building
    JOIN property_plots plot ON plot.id=building.plot_id
    JOIN city_locations location ON location.id=plot.location_id
    JOIN companies company ON company.id=building.company_id
    WHERE building.id=${buildingId}::uuid
  `;
  const row = rows[0];
  if (!row || String(row.status) !== "active") {
    throw new Error("Estabelecimento não está aberto.");
  }
  return {
    buildingId: String(row.id),
    plotCode: String(row.plot_code),
    locationCode: String(row.location_code),
    companyId: String(row.company_id),
    ownerId: String(row.owner_id)
  };
}

export async function registerWorldEconomyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/world/economy/context", async (request) => {
    const ownerId = await requireActorId(app, request);
    const location = await currentLocation(ownerId);
    const allowedRecipeCodes = [...WORLD_RECIPE_LOCATIONS.entries()]
      .filter(([, requiredLocationCode]) => requiredLocationCode === location.code)
      .map(([recipeCode]) => recipeCode);

    const allActiveRecipeRows = allowedRecipeCodes.length > 0
      ? await sql`
          SELECT recipe.code,recipe.name,recipe.output_quantity_minor,
            recipe.duration_seconds,recipe.energy_cost_minor,
            item.code output_item_code,item.name output_item_name
          FROM production_recipes recipe
          JOIN items item ON item.id=recipe.output_item_id
          WHERE recipe.active=true
          ORDER BY recipe.name,recipe.code
        `
      : [];
    const recipeRows = allActiveRecipeRows.filter((row) =>
      allowedRecipeCodes.includes(String(row.code))
    );
    const itemRows = location.code === WORLD_MARKET_LOCATION
      ? await sql`SELECT code,name,base_price_minor FROM items ORDER BY name,code`
      : [];
    const businesses = await localBusinesses(location.code);

    return {
      location,
      capabilities: {
        canProduce: allowedRecipeCodes.length > 0,
        canTrade: location.code === WORLD_MARKET_LOCATION,
        allowedRecipeCodes
      },
      recipes: recipeRows.map((row) => ({
        code: String(row.code),
        name: String(row.name),
        outputItemCode: String(row.output_item_code),
        outputItemName: String(row.output_item_name),
        outputQuantityMinor: Number(row.output_quantity_minor),
        durationSeconds: Number(row.duration_seconds),
        energyCostMinor: Number(row.energy_cost_minor)
      })),
      marketItems: itemRows.map((row) => ({
        code: String(row.code),
        name: String(row.name),
        basePriceMinor: Number(row.base_price_minor)
      })),
      localBusinesses: businesses,
      guidance: location.code === "green-cooperative"
        ? "A Cooperativa Agrícola transforma recursos alimentares em bens produzidos."
        : location.code === WORLD_MARKET_LOCATION
          ? "O Mercado Municipal conecta sua oferta ao livro público da cidade."
          : businesses.length > 0
            ? "Este local possui estabelecimentos ativos. Visite empresas ou, se for proprietário, atenda a demanda do distrito."
            : "Explore a cidade para encontrar um ponto econômico compatível com a próxima ação.",
      signature: "Tehkné Solutions"
    };
  });

  app.post<{ Params: { buildingId: string } }>(
    "/v1/world/businesses/:buildingId/visit",
    async (request) => {
      const ownerId = await requireActorId(app, request);
      const building = await worldBuilding(request.params.buildingId);
      await assertLocation(app, ownerId, building.locationCode);
      if (building.ownerId === ownerId) {
        throw app.httpErrors.badRequest("O proprietário não registra visita na própria empresa.");
      }
      await propertyBusiness.visitProperty({
        ownerId,
        plotCode: building.plotCode,
        idempotencyKey: idempotencyKey(app, request)
      });
      return {
        visited: true,
        buildingId: building.buildingId,
        companyId: building.companyId,
        plotCode: building.plotCode,
        worldLocationCode: building.locationCode,
        signature: "Tehkné Solutions"
      };
    }
  );

  app.post<{ Params: { buildingId: string } }>(
    "/v1/world/businesses/:buildingId/demand-cycle",
    async (request) => {
      const ownerId = await requireActorId(app, request);
      const building = await worldBuilding(request.params.buildingId);
      await assertLocation(app, ownerId, building.locationCode);
      if (building.ownerId !== ownerId) {
        throw app.httpErrors.forbidden("Somente o proprietário pode atender a demanda deste estabelecimento.");
      }
      const state = await businessOperations.runDemandCycle({
        ownerId,
        buildingId: building.buildingId,
        idempotencyKey: idempotencyKey(app, request)
      });
      const company = state.companies.find((candidate) =>
        candidate.buildingId === building.buildingId
      );
      return {
        attended: true,
        buildingId: building.buildingId,
        company: company ?? null,
        worldLocationCode: building.locationCode,
        signature: "Tehkné Solutions"
      };
    }
  );

  const productionSchema = z.object({
    recipeCode: z.string().min(1).max(64),
    batches: z.number().int().positive().max(20)
  });

  app.post("/v1/world/production/orders", async (request) => {
    const ownerId = await requireActorId(app, request);
    const body = productionSchema.parse(request.body);
    const requiredLocationCode = WORLD_RECIPE_LOCATIONS.get(body.recipeCode);
    if (!requiredLocationCode) {
      throw app.httpErrors.badRequest("Receita ainda não possui ponto de produção no mundo.");
    }
    await assertLocation(app, ownerId, requiredLocationCode);
    const order = await economy.startProduction({
      ownerId,
      recipeCode: body.recipeCode,
      batches: body.batches,
      idempotencyKey: idempotencyKey(app, request)
    });
    try {
      await enqueueProductionCompletion({
        orderId: order.id,
        completesAt: order.completesAt
      });
    } catch (error) {
      app.log.warn(
        { error, orderId: order.id, requestId: request.id },
        "world.production.queue.unavailable"
      );
    }
    return {
      ...order,
      worldLocationCode: requiredLocationCode,
      signature: "Tehkné Solutions"
    };
  });

  const marketOrderSchema = z.object({
    side: z.enum(["buy", "sell"]),
    itemCode: z.string().min(1).max(64),
    quantity: z.number().int().positive().max(100_000),
    unitPriceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  });

  app.post("/v1/world/market/orders", async (request) => {
    const ownerId = await requireActorId(app, request);
    const body = marketOrderSchema.parse(request.body);
    await assertLocation(app, ownerId, WORLD_MARKET_LOCATION);
    const result = await economy.createMarketOrder({
      ownerId,
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
    return {
      ...result,
      worldLocationCode: WORLD_MARKET_LOCATION,
      signature: "Tehkné Solutions"
    };
  });
}

// Tehkné Solutions
