import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import Redis from "ioredis";

export async function registerRealtime(app: FastifyInstance): Promise<void> {
  await app.register(websocket);
  const sockets = new Set<{ readyState: number; send(payload: string): void }>();

  app.get("/v1/realtime", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({
      eventType: "connection.ready",
      occurredAt: new Date().toISOString(),
      signature: "Tehkné Solutions"
    }));
    socket.on("close", () => sockets.delete(socket));
  });

  const subscriber = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: null
  });

  try {
    await subscriber.connect();
    await subscriber.subscribe("nova-aurora.events");
    subscriber.on("message", (_channel, payload) => {
      for (const socket of sockets) {
        if (socket.readyState === 1) socket.send(payload);
      }
    });
  } catch (error) {
    app.log.warn({ error }, "Realtime Redis indisponível; API permanece operacional.");
  }
}
