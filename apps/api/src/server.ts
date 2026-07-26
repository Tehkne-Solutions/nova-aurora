import { randomUUID } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { z } from "zod";
import { closeDb, MarketProductionService } from "@nova-aurora/database";
import { authSecurity } from "./auth-context.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerBusinessOperationsRoutes } from "./business-operations-routes.js";
import { registerCityGovernanceRoutes } from "./city-governance-routes.js";
import { registerCityRoutes } from "./city-routes.js";
import { snapshot, verticalSlice } from "./economy.js";
import { registerGameplayRoutes } from "./gameplay-routes.js";
import { registerMunicipalOperationsRoutes } from "./municipal-operations-routes.js";
import { closeObservability, registerObservability } from "./observability.js";
import { registerPropertyBusinessRoutes } from "./property-business-routes.js";
import { enqueueProductionCompletion } from "./queue.js";
import { registerRealtime } from "./realtime.js";
import {
  registerRegionalBusinessManagementRoutes
} from "./regional-business-management-routes.js";
import { registerSecurity } from "./security.js";

function requestId(request: { headers: Record<string, string | string[] | undefined> }): string {
  const supplied = request.headers["x-request-id"];
  if (typeof supplied === "string" && /^[a-zA-Z0-9._:-]{8,128}$/.test(supplied)) {
    return supplied;
  }
  return randomUUID();
}

function validateRuntime(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!process.env.INTERNAL_API_TOKEN || process.env.INTERNAL_API_TOKEN.length < 24) {
    throw new Error("INTERNAL_API_TOKEN deve possuir pelo menos 24 caracteres.");
  }
  const origins = process.env.WEB_ORIGINS ?? "";
  if (!origins || origins.includes("localhost")) {
    throw new Error("WEB_ORIGINS precisa conter apenas origens públicas em produção.");
  }
  if (process.env.TRUST_PROXY !== "true") {
    throw new Error("TRUST_PROXY=true é obrigatório atrás do proxy de produção.");
  }
}

validateRuntime();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers['x-internal-token']",
        "res.headers['set-cookie']"
      ],
      censor: "[REDACTED]"
    }
  },
  trustProxy: process.env.TRUST_PROXY === "true",
  genReqId: requestId,
  requestIdHeader: "x-request-id"
});
const economy = new MarketProductionService();
const allowedOrigins = (process.env.WEB_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

await authSecurity.assertProductionSecurity();
await app.register(cors, {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origem não autorizada."), false);
  },
  allowedHeaders: [
    "authorization",
    "content-type",
    "idempotency-key",
    "x-actor-context",
    "x-device-name",
    "x-request-id"
  ],
  exposedHeaders: ["x-request-id"],
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  maxAge: 600
});
await app.register(sensible);
await registerObservability(app);
await registerSecurity(app);
await registerAuthRoutes(app);
await registerRealtime(app);
await registerCityRoutes(app);
await registerGameplayRoutes(app);
await registerPropertyBusinessRoutes(app);
await registerBusinessOperationsRoutes(app);
await registerRegionalBusinessManagementRoutes(app);
await registerCityGovernanceRoutes(app);
await registerMunicipalOperationsRoutes(app);

function idempotencyKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length < 8) {
    throw app.httpErrors.badRequest("Idempotency-Key obrigatório.");
  }
  return key;
}

async function actorId(request: FastifyRequest): Promise<string> {
  const email = request.headers["x-actor-email"];
  if (typeof email !== "string") {
    throw app.httpErrors.unauthorized("Identidade autenticada não resolvida.");
  }
  return economy.resolveUserId(email);
}

app.setErrorHandler((error, request, reply) => {
  const details = typeof error === "object" && error !== null
    ? error as { statusCode?: unknown; name?: unknown; message?: unknown }
    : {};
  const status = typeof details.statusCode === "number"
    ? details.statusCode
    : 400;
  app.log.error({
    error,
    requestId: request.id,
    method: request.method,
    route: request.routeOptions.url,
    statusCode: status
  }, "request.failed");
  return reply.status(status).send({
    error: typeof details.name === "string" ? details.name : "Error",
    message: typeof details.message === "string"
      ? details.message
      : "Falha inesperada.",
    requestId: request.id,
    signature: "Tehkné Solutions"
  });
});

app.get("/health", async () => ({
  status: "ok",
  service: "nova-aurora-api",
  version: process.env.APP_VERSION ?? "development",
  commit: process.env.GIT_COMMIT_SHA ?? "unknown",
  market: "price-time-priority",
  production: "bullmq-delayed",
  cityGameplay: "persistent",
  gameplayExperience: "harvest-minigame",
  propertyBusiness: "plots-buildings-equity-distributions",
  publicMarketplace: "demand-employment-reputation-secondary-shares",
  regionalManagement: "stock-b2b-campaigns-goals-team-district-metrics",
  cityGovernance: "expansion-licenses-contracts-participatory-budget-services",
  municipalOperations: "budget-cycles-services-elections-policies-emergencies",
  identitySecurity: "bcrypt-opaque-sessions-rbac-audit-rate-limit",
  liveCity: "one-time-tickets-presence-notifications",
  observability: "liveness-readiness-prometheus-request-id",
  signature: "Tehkné Solutions"
}));

app.get("/v1/economy/snapshot", async () => snapshot());
app.post("/v1/tutorial/run", async (request) =>
  verticalSlice(idempotencyKey(request))
);

const marketOrderSchema = z.object({
  side: z.enum(["buy", "sell"]),
  itemCode: z.string().min(1).max(64),
  quantity: z.number().int().positive().max(100_000),
  unitPriceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
});

app.post("/v1/market/orders", async (request) => {
  const body = marketOrderSchema.parse(request.body);
  return economy.createMarketOrder({
    ownerId: await actorId(request),
    ...body,
    idempotencyKey: idempotencyKey(request)
  });
});

app.delete<{ Params: { orderId: string } }>(
  "/v1/market/orders/:orderId",
  async (request) => economy.cancelMarketOrder({
    ownerId: await actorId(request),
    orderId: request.params.orderId,
    idempotencyKey: idempotencyKey(request)
  })
);

app.get<{ Params: { itemCode: string } }>(
  "/v1/market/order-book/:itemCode",
  async (request) => economy.orderBook(request.params.itemCode)
);

app.get<{
  Params: { itemCode: string };
  Querystring: { limit?: string };
}>(
  "/v1/market/trades/:itemCode",
  async (request) => economy.recentTrades(
    request.params.itemCode,
    Number(request.query.limit ?? 50)
  )
);

const productionSchema = z.object({
  recipeCode: z.string().min(1).max(64),
  batches: z.number().int().positive().max(20)
});

app.post("/v1/production/orders", async (request) => {
  const body = productionSchema.parse(request.body);
  const order = await economy.startProduction({
    ownerId: await actorId(request),
    ...body,
    idempotencyKey: idempotencyKey(request)
  });
  try {
    await enqueueProductionCompletion({
      orderId: order.id,
      completesAt: order.completesAt
    });
  } catch (error) {
    app.log.warn(
      { error, orderId: order.id, requestId: request.id },
      "production.queue.unavailable"
    );
  }
  return order;
});

app.delete<{ Params: { orderId: string } }>(
  "/v1/production/orders/:orderId",
  async (request) => economy.cancelProduction({
    ownerId: await actorId(request),
    orderId: request.params.orderId,
    idempotencyKey: idempotencyKey(request)
  })
);

app.get("/v1/production/orders", async (request) =>
  economy.productionOrders(await actorId(request))
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "service.shutdown.started");
  const forcedExit = setTimeout(() => {
    app.log.fatal({ signal }, "service.shutdown.timeout");
    process.exit(1);
  }, 12_000);
  forcedExit.unref();
  try {
    await app.close();
    await closeObservability();
    await closeDb();
    clearTimeout(forcedExit);
    app.log.info({ signal }, "service.shutdown.completed");
    process.exit(0);
  } catch (error) {
    app.log.fatal({ error, signal }, "service.shutdown.failed");
    process.exit(1);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => void shutdown(signal));
}

await app.listen({
  host: "0.0.0.0",
  port: Number(process.env.API_PORT ?? 4000)
});
