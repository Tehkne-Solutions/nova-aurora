import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { BusinessOperationsService, db } from "@nova-aurora/database";
import { requireActorId } from "./auth-context.js";

const operations = new BusinessOperationsService();
const economySql = db();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return key;
}

const catalogSchema = z.object({
  code: z.string().min(2).max(48).regex(/^[a-z0-9-]+$/),
  title: z.string().min(2).max(80),
  description: z.string().min(5).max(240),
  category: z.enum(["food", "retail", "services", "creative", "industrial"]),
  unitPriceMinor: z.number().int().positive().max(1_000_000),
  capacityPerCycle: z.number().int().positive().max(10_000)
});

const jobSchema = z.object({
  buildingId: z.string().uuid().optional(),
  roleCode: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  title: z.string().min(2).max(80),
  description: z.string().min(5).max(240),
  wageMinor: z.number().int().positive().max(1_000_000),
  slots: z.number().int().positive().max(50)
});

const listingSchema = z.object({
  companyId: z.string().uuid(),
  units: z.number().int().positive().max(4000),
  unitPriceMinor: z.number().int().positive().max(100_000)
});

const buySchema = z.object({
  units: z.number().int().positive().max(4000)
});

export async function registerBusinessOperationsRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get("/v1/market/catalog", async () => {
    const rows = await economySql`
      SELECT code,name,base_price_minor
      FROM items
      ORDER BY name,code
    `;
    return {
      items: rows.map((row) => ({
        code: String(row.code),
        name: String(row.name),
        basePriceMinor: Number(row.base_price_minor)
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/production/recipes", async () => {
    const recipes = await economySql`
      SELECT recipe.id,recipe.code,recipe.name,recipe.output_quantity_minor,
        recipe.duration_seconds,recipe.energy_cost_minor,
        item.code output_item_code,item.name output_item_name
      FROM production_recipes recipe
      JOIN items item ON item.id=recipe.output_item_id
      WHERE recipe.active=true
      ORDER BY recipe.name,recipe.code
    `;
    const inputs = await economySql`
      SELECT input.recipe_id,input.quantity_minor,item.code item_code,item.name item_name
      FROM production_recipe_inputs input
      JOIN items item ON item.id=input.item_id
      JOIN production_recipes recipe ON recipe.id=input.recipe_id
      WHERE recipe.active=true
      ORDER BY recipe_id,item.name,item.code
    `;
    return {
      recipes: recipes.map((recipe) => ({
        code: String(recipe.code),
        name: String(recipe.name),
        outputItemCode: String(recipe.output_item_code),
        outputItemName: String(recipe.output_item_name),
        outputQuantityMinor: Number(recipe.output_quantity_minor),
        durationSeconds: Number(recipe.duration_seconds),
        energyCostMinor: Number(recipe.energy_cost_minor),
        inputs: inputs
          .filter((input) => String(input.recipe_id) === String(recipe.id))
          .map((input) => ({
            itemCode: String(input.item_code),
            itemName: String(input.item_name),
            quantityMinor: Number(input.quantity_minor)
          }))
      })),
      signature: "Tehkné Solutions"
    };
  });

  app.get("/v1/marketplace/state", async (request) =>
    operations.state(await requireActorId(app, request))
  );

  app.post<{ Params: { buildingId: string } }>(
    "/v1/marketplace/buildings/:buildingId/catalog",
    async (request) => {
      const body = catalogSchema.parse(request.body);
      return operations.configureCatalog({
        ownerId: await requireActorId(app, request),
        buildingId: request.params.buildingId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post<{ Params: { buildingId: string } }>(
    "/v1/marketplace/buildings/:buildingId/demand-cycle",
    async (request) => operations.runDemandCycle({
      ownerId: await requireActorId(app, request),
      buildingId: request.params.buildingId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { companyId: string } }>(
    "/v1/marketplace/companies/:companyId/jobs",
    async (request) => {
      const body = jobSchema.parse(request.body);
      const { buildingId, ...job } = body;
      return operations.createJobOpening({
        ownerId: await requireActorId(app, request),
        companyId: request.params.companyId,
        ...job,
        ...(buildingId === undefined ? {} : { buildingId }),
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post<{ Params: { openingId: string } }>(
    "/v1/marketplace/jobs/:openingId/accept",
    async (request) => operations.acceptJob({
      ownerId: await requireActorId(app, request),
      openingId: request.params.openingId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { companyId: string } }>(
    "/v1/marketplace/companies/:companyId/payroll",
    async (request) => operations.runPayroll({
      ownerId: await requireActorId(app, request),
      companyId: request.params.companyId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post("/v1/marketplace/shares/listings", async (request) => {
    const body = listingSchema.parse(request.body);
    return operations.createShareListing({
      ownerId: await requireActorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { listingId: string } }>(
    "/v1/marketplace/shares/listings/:listingId/buy",
    async (request) => {
      const body = buySchema.parse(request.body);
      return operations.buyShareListing({
        ownerId: await requireActorId(app, request),
        listingId: request.params.listingId,
        units: body.units,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );
}

// Tehkné Solutions
