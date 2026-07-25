"use client";

import { useEffect, useState } from "react";

export function RealtimeStatus() {
  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const [lastEvent, setLastEvent] = useState("Nenhum evento recebido");

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const socketUrl = apiUrl.replace(/^http/, "ws") + "/v1/realtime";
    const socket = new WebSocket(socketUrl);
    socket.addEventListener("open", () => setStatus("online"));
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
    return () => socket.close();
  }, []);

  return (
    <article>
      <span>Eventos em tempo real</span>
      <strong>{status === "online" ? "Conectado" : status === "offline" ? "Offline" : "Conectando"}</strong>
      <small>{lastEvent}</small>
    </article>
  );
}
