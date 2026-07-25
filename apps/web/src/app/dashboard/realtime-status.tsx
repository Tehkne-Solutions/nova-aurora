"use client";

import { useEffect, useRef, useState } from "react";

export function RealtimeStatus() {
  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [lastEvent, setLastEvent] = useState("Nenhum evento recebido");
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    void (async () => {
      try {
        const ticketResponse = await fetch(`${apiUrl}/v1/auth/realtime-ticket`, {
          method: "POST"
        });
        if (!ticketResponse.ok) throw new Error("Ticket indisponível.");
        const { ticket } = await ticketResponse.json() as { ticket: string };
        if (cancelled) return;

        const socketUrl = apiUrl.replace(/^http/, "ws")
          + `/v1/realtime?ticket=${encodeURIComponent(ticket)}`;
        const socket = new WebSocket(socketUrl);
        socketRef.current = socket;
        socket.addEventListener("open", () => {
          setStatus("online");
          heartbeat = setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                eventType: "presence.heartbeat",
                status: document.hidden ? "away" : "online"
              }));
            }
          }, 30_000);
        });
        socket.addEventListener("close", () => setStatus("offline"));
        socket.addEventListener("error", () => setStatus("offline"));
        socket.addEventListener("message", (message) => {
          try {
            const payload = JSON.parse(String(message.data)) as { eventType?: string };
            setLastEvent(payload.eventType ?? "Evento econômico");
          } catch {
            setLastEvent("Evento econômico");
          }
        });
      } catch {
        setStatus("offline");
      }
    })();

    return () => {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      socketRef.current?.close();
    };
  }, []);

  return (
    <article>
      <span>Eventos em tempo real</span>
      <strong>{status === "online" ? "Conectado" : status === "offline" ? "Offline" : "Conectando"}</strong>
      <small>{lastEvent}</small>
    </article>
  );
}
