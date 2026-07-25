import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { BusinessOperationsService } from "@nova-aurora/database";

const operations = new BusinessOperationsService();

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
  return operations.resolveUserId(email);
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
  app.get("/v1/marketplace/state", async (request) =>
    operations.state(await actorId(app, request))
  );

  app.post<{ Params: { buildingId: string } }>(
    "/v1/marketplace/buildings/:buildingId/catalog",
    async (request) => {
      const body = catalogSchema.parse(request.body);
      return operations.configureCatalog({
        ownerId: await actorId(app, request),
        buildingId: request.params.buildingId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post<{ Params: { buildingId: string } }>(
    "/v1/marketplace/buildings/:buildingId/demand-cycle",
    async (request) => operations.runDemandCycle({
      ownerId: await actorId(app, request),
      buildingId: request.params.buildingId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { companyId: string } }>(
    "/v1/marketplace/companies/:companyId/jobs",
    async (request) => {
      const body = jobSchema.parse(request.body);
      return operations.createJobOpening({
        ownerId: await actorId(app, request),
        companyId: request.params.companyId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post<{ Params: { openingId: string } }>(
    "/v1/marketplace/jobs/:openingId/accept",
    async (request) => operations.acceptJob({
      ownerId: await actorId(app, request),
      openingId: request.params.openingId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { companyId: string } }>(
    "/v1/marketplace/companies/:companyId/payroll",
    async (request) => operations.runPayroll({
      ownerId: await actorId(app, request),
      companyId: request.params.companyId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post("/v1/marketplace/shares/listings", async (request) => {
    const body = listingSchema.parse(request.body);
    return operations.createShareListing({
      ownerId: await actorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { listingId: string } }>(
    "/v1/marketplace/shares/listings/:listingId/buy",
    async (request) => {
      const body = buySchema.parse(request.body);
      return operations.buyShareListing({
        ownerId: await actorId(app, request),
        listingId: request.params.listingId,
        units: body.units,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );
}
