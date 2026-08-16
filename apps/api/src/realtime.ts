import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import type { AuthenticatedIdentity } from "@nova-aurora/database";
import { authSecurity } from "./auth-context.js";

const REALTIME_CHANNEL = "nova-aurora.events";
const REALTIME_PUBLISH_CONNECT_TIMEOUT_MS = 1_000;

type LiveSocket = {
  socket: {
    readyState: number;
    send(payload: string): void;
    close(code?: number, reason?: string): void;
    on(event: "close", listener: () => void): void;
    on(event: "message", listener: (data: unknown) => void): void;
  };
  identity: AuthenticatedIdentity;
  locationCode: string | null;
};

type RealtimeRoute = Readonly<{
  eventType: string | null;
  locationCode: string | null;
}>;

let publisher: Redis | null = null;

function realtimePublisher(): Redis {
  if (!publisher || publisher.status === "end") {
    publisher = new Redis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        lazyConnect: true,
        connectTimeout: REALTIME_PUBLISH_CONNECT_TIMEOUT_MS,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null
      }
    );
    publisher.on("error", () => {
      // Publishing is best-effort. Durable state remains authoritative in Postgres.
    });
  }
  return publisher;
}

export async function publishRealtimeEvent(payload: Readonly<Record<string, unknown>>): Promise<boolean> {
  try {
    const client = realtimePublisher();
    if (client.status === "wait") await client.connect();
    if (client.status !== "ready") return false;
    await client.publish(REALTIME_CHANNEL, JSON.stringify({
      ...payload,
      occurredAt: new Date().toISOString(),
      signature: "Tehkné Solutions"
    }));
    return true;
  } catch {
    return false;
  }
}

function audienceUserId(payload: string): string | null {
  try {
    const value = JSON.parse(payload) as {
      audienceUserId?: unknown;
      payload?: { audienceUserId?: unknown };
    };
    const candidate = value.audienceUserId ?? value.payload?.audienceUserId;
    return typeof candidate === "string" ? candidate : null;
  } catch {
    return null;
  }
}

function realtimeRoute(payload: string): RealtimeRoute {
  try {
    const value = JSON.parse(payload) as {
      eventType?: unknown;
      locationCode?: unknown;
      payload?: { locationCode?: unknown };
    };
    const locationCode = value.locationCode ?? value.payload?.locationCode;
    return {
      eventType: typeof value.eventType === "string" ? value.eventType : null,
      locationCode: typeof locationCode === "string" && locationCode.trim()
        ? locationCode.trim().slice(0, 80)
        : null
    };
  } catch {
    return { eventType: null, locationCode: null };
  }
}

export async function registerRealtime(app: FastifyInstance): Promise<void> {
  await app.register(websocket);
  const sockets = new Set<LiveSocket>();

  app.get("/v1/realtime", { websocket: true }, async (socket, request) => {
    const ticket = new URL(request.url, "http://nova-aurora.local")
      .searchParams.get("ticket");
    if (!ticket) {
      socket.close(1008, "Ticket obrigatório");
      return;
    }

    let identity: AuthenticatedIdentity;
    try {
      identity = await authSecurity.consumeRealtimeTicket(ticket);
    } catch {
      socket.close(1008, "Ticket inválido ou expirado");
      return;
    }

    const connection: LiveSocket = { socket, identity, locationCode: null };
    sockets.add(connection);
    await authSecurity.heartbeat({ identity, status: "online" });
    socket.send(JSON.stringify({
      eventType: "connection.ready",
      occurredAt: new Date().toISOString(),
      identity: {
        userId: identity.userId,
        displayName: identity.displayName,
        roles: identity.roles
      },
      presence: await authSecurity.presence(),
      signature: "Tehkné Solutions"
    }));

    socket.on("message", (data: unknown) => {
      void (async () => {
        try {
          const message = JSON.parse(String(data)) as {
            eventType?: unknown;
            locationCode?: unknown;
            status?: unknown;
          };
          if (message.eventType !== "presence.heartbeat") return;
          const status = message.status === "away" || message.status === "busy"
            ? message.status
            : "online";
          const locationCode = typeof message.locationCode === "string"
            ? message.locationCode.trim().slice(0, 80)
            : "";
          if (locationCode) connection.locationCode = locationCode;
          const presence = await authSecurity.heartbeat({
            identity,
            status,
            ...(locationCode ? { locationCode } : {})
          });
          socket.send(JSON.stringify({
            eventType: "presence.updated",
            occurredAt: new Date().toISOString(),
            presence,
            signature: "Tehkné Solutions"
          }));
        } catch {
          socket.send(JSON.stringify({
            eventType: "message.rejected",
            occurredAt: new Date().toISOString(),
            signature: "Tehkné Solutions"
          }));
        }
      })();
    });

    socket.on("close", () => {
      sockets.delete(connection);
      void authSecurity.disconnectPresence(identity);
    });
  });

  const subscriber = new Redis(
    process.env.REDIS_URL ?? "redis://localhost:6379",
    {
      lazyConnect: true,
      maxRetriesPerRequest: null
    }
  );

  try {
    await subscriber.connect();
    await subscriber.subscribe(REALTIME_CHANNEL);
    subscriber.on("message", (_channel: string, payload: string) => {
      const audience = audienceUserId(payload);
      const route = realtimeRoute(payload);
      for (const connection of sockets) {
        if (audience && audience !== connection.identity.userId) continue;
        if (
          !audience
          && route.eventType === "ugc.world.placement.updated"
          && route.locationCode
          && connection.locationCode !== route.locationCode
        ) continue;
        if (connection.socket.readyState === 1) connection.socket.send(payload);
      }
    });
  } catch (error) {
    app.log.warn({ error }, "Realtime Redis indisponível; API permanece operacional.");
  }

  app.addHook("onClose", async () => {
    for (const connection of sockets) connection.socket.close(1001, "Servidor encerrando");
    sockets.clear();
    subscriber.disconnect();
    publisher?.disconnect();
    publisher = null;
  });
}

// Tehkné Solutions
