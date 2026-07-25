import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { z } from "zod";
import { MarketProductionService } from "@nova-aurora/database";
import { registerCityRoutes } from "./city-routes.js";
import { snapshot, verticalSlice } from "./economy.js";
import { registerGameplayRoutes } from "./gameplay-routes.js";
import { enqueueProductionCompletion } from "./queue.js";
import { registerRealtime } from "./realtime.js";

const app = Fastify({ logger: true });
const economy = new MarketProductionService();

await app.register(cors, { origin: true });
await app.register(sensible);
await registerRealtime(app);
await registerCityRoutes(app);
await registerGameplayRoutes(app);

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
    throw app.httpErrors.unauthorized(
      "Cabeçalho x-actor-email obrigatório no runtime de desenvolvimento."
    );
  }
  return economy.resolveUserId(email);
}

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const details = typeof error === "object" && error !== null
    ? error as { statusCode?: unknown; name?: unknown; message?: unknown }
    : {};
  const status = typeof details.statusCode === "number"
    ? details.statusCode
    : 400;
  return reply.status(status).send({
    error: typeof details.name === "string" ? details.name : "Error",
    message: typeof details.message === "string"
      ? details.message
      : "Falha inesperada.",
    signature: "Tehkné Solutions"
  });
});

app.get("/health", async () => ({
  status: "ok",
  service: "nova-aurora-api",
  market: "price-time-priority",
  production: "bullmq-delayed",
  cityGameplay: "persistent",
  gameplayExperience: "harvest-minigame",
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
      { error, orderId: order.id },
      "Fila indisponível; worker fará varredura de recuperação."
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

await app.listen({
  host: "0.0.0.0",
  port: Number(process.env.API_PORT ?? 4000)
});
