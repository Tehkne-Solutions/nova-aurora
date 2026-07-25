import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import type { AuthenticatedIdentity } from "@nova-aurora/database";
import { authSecurity } from "./auth-context.js";

type LiveSocket = Readonly<{
  socket: {
    readyState: number;
    send(payload: string): void;
    close(code?: number, reason?: string): void;
    on(event: "close", listener: () => void): void;
    on(event: "message", listener: (data: unknown) => void): void;
  };
  identity: AuthenticatedIdentity;
}>;

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

    const connection: LiveSocket = { socket, identity };
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
          const presence = await authSecurity.heartbeat({
            identity,
            status,
            ...(typeof message.locationCode === "string"
              ? { locationCode: message.locationCode.slice(0, 80) }
              : {})
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
    await subscriber.subscribe("nova-aurora.events");
    subscriber.on("message", (_channel: string, payload: string) => {
      const audience = audienceUserId(payload);
      for (const connection of sockets) {
        if (audience && audience !== connection.identity.userId) continue;
        if (connection.socket.readyState === 1) connection.socket.send(payload);
      }
    });
  } catch (error) {
    app.log.warn({ error }, "Realtime Redis indisponível; API permanece operacional.");
  }
}
