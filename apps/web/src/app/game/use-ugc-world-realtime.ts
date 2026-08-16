"use client";

import { useEffect, useRef } from "react";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const REALTIME_HEARTBEAT_MS = 30_000;
const REALTIME_RECONNECT_BASE_MS = 1_000;
const REALTIME_RECONNECT_MAX_MS = 15_000;
const ANIMATION_STATES = ["idle", "open", "close", "activate", "deactivate", "spin"] as const;

export type UgcRealtimeAnimationState = typeof ANIMATION_STATES[number];

type PlacementStateHandler = (placementId: string, animationState: UgcRealtimeAnimationState) => void;

type PlacementUpdatedEvent = Readonly<{
  eventType?: unknown;
  payload?: {
    placementId?: unknown;
    animationState?: unknown;
  };
}>;

function normalizeAnimationState(value: unknown): UgcRealtimeAnimationState | null {
  return ANIMATION_STATES.includes(value as UgcRealtimeAnimationState)
    ? value as UgcRealtimeAnimationState
    : null;
}

export function useUgcWorldRealtime(
  locationCode: string,
  onPlacementState: PlacementStateHandler
): void {
  const locationRef = useRef(locationCode);
  const handlerRef = useRef(onPlacementState);
  locationRef.current = locationCode;
  handlerRef.current = onPlacementState;

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let heartbeatTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;

    function clearHeartbeat(): void {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    function heartbeat(): void {
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({
        eventType: "presence.heartbeat",
        status: document.visibilityState === "hidden" ? "away" : "online",
        locationCode: locationRef.current
      }));
    }

    function scheduleReconnect(): void {
      if (disposed || reconnectTimer !== null || document.visibilityState === "hidden") return;
      const delay = Math.min(
        REALTIME_RECONNECT_MAX_MS,
        REALTIME_RECONNECT_BASE_MS * (2 ** Math.min(reconnectAttempt, 4))
      );
      reconnectAttempt += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    }

    function handleMessage(message: MessageEvent): void {
      try {
        const event = JSON.parse(String(message.data)) as PlacementUpdatedEvent;
        if (event.eventType !== "ugc.world.placement.updated") return;
        const placementId = event.payload?.placementId;
        const animationState = normalizeAnimationState(event.payload?.animationState);
        if (typeof placementId !== "string" || !animationState) return;
        handlerRef.current(placementId, animationState);
      } catch {
        // Ignore malformed or unrelated realtime messages; polling remains authoritative fallback.
      }
    }

    async function connect(): Promise<void> {
      if (disposed || document.visibilityState === "hidden") return;
      try {
        const ticketResponse = await fetch(`${API_URL}/v1/auth/realtime-ticket`, {
          method: "POST"
        });
        if (!ticketResponse.ok) throw new Error("Realtime ticket unavailable");
        const ticketPayload = await ticketResponse.json() as { ticket?: unknown };
        if (typeof ticketPayload.ticket !== "string" || !ticketPayload.ticket) {
          throw new Error("Realtime ticket invalid");
        }
        if (disposed || document.visibilityState === "hidden") return;

        const socketUrl = API_URL.replace(/^http/, "ws")
          + `/v1/realtime?ticket=${encodeURIComponent(ticketPayload.ticket)}`;
        const nextSocket = new WebSocket(socketUrl);
        socket = nextSocket;

        nextSocket.addEventListener("open", () => {
          if (disposed || socket !== nextSocket) return;
          reconnectAttempt = 0;
          heartbeat();
          clearHeartbeat();
          heartbeatTimer = window.setInterval(heartbeat, REALTIME_HEARTBEAT_MS);
        });
        nextSocket.addEventListener("message", handleMessage);
        nextSocket.addEventListener("error", () => nextSocket.close());
        nextSocket.addEventListener("close", () => {
          if (socket === nextSocket) socket = null;
          clearHeartbeat();
          scheduleReconnect();
        });
      } catch {
        scheduleReconnect();
      }
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        socket?.close(1000, "Página oculta");
        return;
      }
      if (!socket && reconnectTimer === null) void connect();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void connect();

    return () => {
      disposed = true;
      clearHeartbeat();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      socket?.close(1000, "Componente desmontado");
      socket = null;
    };
  }, []);
}

// Tehkné Solutions
