import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { db, MarketProductionService } from "@nova-aurora/database";
import { requireActorId } from "./auth-context.js";
import { enqueueProductionCompletion } from "./queue.js";

const economy = new MarketProductionService();
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
      guidance: location.code === "green-cooperative"
        ? "A Cooperativa Agrícola transforma recursos alimentares em bens produzidos."
        : location.code === WORLD_MARKET_LOCATION
          ? "O Mercado Municipal conecta sua oferta ao livro público da cidade."
          : "Explore a cidade para encontrar um ponto econômico compatível com a próxima ação.",
      signature: "Tehkné Solutions"
    };
  });

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
