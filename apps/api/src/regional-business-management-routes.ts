import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { RegionalBusinessManagementService } from "@nova-aurora/database";

const management = new RegionalBusinessManagementService();

function idempotencyKey(app: FastifyInstance, request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return key;
}

async function actorId(app: FastifyInstance, request: FastifyRequest): Promise<string> {
  const email = request.headers["x-actor-email"];
  if (typeof email !== "string") {
    throw app.httpErrors.unauthorized(
      "Cabeçalho x-actor-email obrigatório no runtime de desenvolvimento."
    );
  }
  return management.resolveUserId(email);
}

const supplierOfferSchema = z.object({
  itemCode: z.string().min(2).max(48).regex(/^[a-z0-9-]+$/),
  title: z.string().min(2).max(80),
  category: z.enum(["food", "retail", "services", "creative", "industrial"]),
  unitCostMinor: z.number().int().positive().max(1_000_000),
  minimumQuantity: z.number().int().positive().max(10_000),
  availableQuantity: z.number().int().positive().max(1_000_000)
});

const acceptSupplierSchema = z.object({
  buildingId: z.string().uuid(),
  catalogEntryId: z.string().uuid(),
  quantity: z.number().int().positive().max(100_000)
});

const campaignSchema = z.object({
  buildingId: z.string().uuid(),
  name: z.string().min(2).max(80),
  channel: z.enum(["local", "social", "outdoor", "influencer"]),
  budgetMinor: z.number().int().positive().max(5_000_000),
  visitorBoostPct: z.number().int().min(1).max(100),
  durationDays: z.number().int().min(1).max(30)
});

const goalSchema = z.object({
  metric: z.enum([
    "revenue",
    "customers",
    "reputation",
    "stock",
    "employee_satisfaction"
  ]),
  title: z.string().min(2).max(100),
  targetValue: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  deadlineAt: z.string().datetime()
});

const trainingSchema = z.object({
  focus: z.enum(["service", "quality", "productivity"])
});

const regionalCycleSchema = z.object({
  buildingId: z.string().uuid(),
  catalogEntryId: z.string().uuid()
});

export async function registerRegionalBusinessManagementRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get("/v1/management/state", async (request) =>
    management.state(await actorId(app, request))
  );

  app.post("/v1/management/supplier-offers", async (request) => {
    const body = supplierOfferSchema.parse(request.body);
    return management.createSupplierOffer({
      ownerId: await actorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { offerId: string } }>(
    "/v1/management/supplier-offers/:offerId/accept",
    async (request) => {
      const body = acceptSupplierSchema.parse(request.body);
      return management.acceptSupplierOffer({
        ownerId: await actorId(app, request),
        offerId: request.params.offerId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post("/v1/management/campaigns", async (request) => {
    const body = campaignSchema.parse(request.body);
    return management.createCampaign({
      ownerId: await actorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post("/v1/management/goals", async (request) => {
    const body = goalSchema.parse(request.body);
    return management.createGoal({
      ownerId: await actorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { employmentId: string } }>(
    "/v1/management/employees/:employmentId/train",
    async (request) => {
      const body = trainingSchema.parse(request.body);
      return management.trainEmployee({
        ownerId: await actorId(app, request),
        employmentId: request.params.employmentId,
        focus: body.focus,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post("/v1/management/regional-cycles", async (request) => {
    const body = regionalCycleSchema.parse(request.body);
    return management.runRegionalCycle({
      ownerId: await actorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { alertId: string } }>(
    "/v1/management/alerts/:alertId/acknowledge",
    async (request) => management.acknowledgeAlert({
      ownerId: await actorId(app, request),
      alertId: request.params.alertId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );
}
