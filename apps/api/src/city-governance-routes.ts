import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CityGovernanceService } from "@nova-aurora/database";

const governance = new CityGovernanceService();

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
  return governance.resolveUserId(email);
}

const licenseSchema = z.object({
  districtCode: z.string().min(2).max(64),
  licenseTypeCode: z.string().min(2).max(64)
});

const proposalSchema = z.object({
  districtCode: z.string().min(2).max(64),
  title: z.string().min(4).max(120),
  description: z.string().min(10).max(800),
  category: z.enum([
    "energy",
    "transport",
    "safety",
    "housing",
    "education",
    "environment",
    "events",
    "expansion"
  ]),
  requestedBudgetMinor: z.number().int().positive().max(10_000_000)
});

const voteSchema = z.object({
  choice: z.enum(["support", "oppose"])
});

const bidSchema = z.object({
  amountMinor: z.number().int().positive().max(10_000_000),
  deliveryDays: z.number().int().min(1).max(365),
  proposal: z.string().min(10).max(1200)
});

export async function registerCityGovernanceRoutes(
  app: FastifyInstance
): Promise<void> {
  app.get("/v1/governance/state", async (request) =>
    governance.state(await actorId(app, request))
  );

  app.post("/v1/governance/licenses", async (request) => {
    const body = licenseSchema.parse(request.body);
    return governance.requestLicense({
      ownerId: await actorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post("/v1/governance/proposals", async (request) => {
    const body = proposalSchema.parse(request.body);
    return governance.createProposal({
      ownerId: await actorId(app, request),
      ...body,
      idempotencyKey: idempotencyKey(app, request)
    });
  });

  app.post<{ Params: { proposalId: string } }>(
    "/v1/governance/proposals/:proposalId/vote",
    async (request) => {
      const body = voteSchema.parse(request.body);
      return governance.voteProposal({
        ownerId: await actorId(app, request),
        proposalId: request.params.proposalId,
        choice: body.choice,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post<{ Params: { proposalId: string } }>(
    "/v1/governance/proposals/:proposalId/fund",
    async (request) => governance.fundProposal({
      ownerId: await actorId(app, request),
      proposalId: request.params.proposalId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { contractId: string } }>(
    "/v1/governance/contracts/:contractId/bids",
    async (request) => {
      const body = bidSchema.parse(request.body);
      return governance.submitBid({
        ownerId: await actorId(app, request),
        contractId: request.params.contractId,
        ...body,
        idempotencyKey: idempotencyKey(app, request)
      });
    }
  );

  app.post<{ Params: { contractId: string } }>(
    "/v1/governance/contracts/:contractId/award",
    async (request) => governance.awardBestBid({
      ownerId: await actorId(app, request),
      contractId: request.params.contractId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );

  app.post<{ Params: { contractId: string } }>(
    "/v1/governance/contracts/:contractId/complete",
    async (request) => governance.completeContract({
      ownerId: await actorId(app, request),
      contractId: request.params.contractId,
      idempotencyKey: idempotencyKey(app, request)
    })
  );
}
