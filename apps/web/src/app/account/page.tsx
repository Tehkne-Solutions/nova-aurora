"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../auth-provider";
import styles from "./account.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Notification = Readonly<{
  id: string;
  title: string;
  body: string;
  severity: string;
  readAt: string | null;
  createdAt: string;
}>;

type Presence = Readonly<{
  userId: string;
  displayName: string;
  locationCode: string | null;
  status: string;
  lastHeartbeatAt: string;
}>;

export default function AccountPage() {
  const { identity, token, setSession, logout } = useAuth();
  const [notifications, setNotifications] = useState<readonly Notification[]>([]);
  const [presence, setPresence] = useState<readonly Presence[]>([]);
  const [message, setMessage] = useState("Carregando central de segurança…");

  useEffect(() => {
    void Promise.all([
      fetch(`${API_URL}/v1/auth/notifications`, { cache: "no-store" }),
      fetch(`${API_URL}/v1/live/presence`, { cache: "no-store" })
    ]).then(async ([notificationResponse, presenceResponse]) => {
      if (notificationResponse.ok) {
        const payload = await notificationResponse.json() as { notifications: Notification[] };
        setNotifications(payload.notifications);
      }
      if (presenceResponse.ok) {
        const payload = await presenceResponse.json() as { presence: Presence[] };
        setPresence(payload.presence);
      }
      setMessage("Identidade e presença sincronizadas.");
    }).catch(() => setMessage("Não foi possível sincronizar a central."));
  }, []);

  async function rotateSession() {
    setMessage("Renovando sessão…");
    const response = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: { "x-device-name": "Nova Aurora Web" }
    });
    if (!response.ok) {
      setMessage("A sessão não pôde ser renovada.");
      return;
    }
    const payload = await response.json() as {
      token: string;
      identity: NonNullable<typeof identity>;
    };
    setSession(payload.token, payload.identity);
    setMessage("Sessão rotacionada. O token anterior foi revogado.");
  }

  async function markRead(notificationId: string) {
    const response = await fetch(
      `${API_URL}/v1/auth/notifications/${notificationId}/read`,
      { method: "POST" }
    );
    if (!response.ok) return;
    setNotifications((current) => current.map((item) =>
      item.id === notificationId
        ? { ...item, readAt: new Date().toISOString() }
        : item
    ));
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · IDENTIDADE E SEGURANÇA</p>
          <h1>{identity?.displayName ?? "Conta"}</h1>
          <p>{identity?.email}</p>
        </div>
        <nav>
          <Link href="/game">Cidade</Link>
          <Link href="/dashboard">Economia</Link>
          <Link href="/municipality">Prefeitura</Link>
        </nav>
      </header>

      <p className={styles.message} aria-live="polite">{message}</p>

      <section className={styles.metrics}>
        <article>
          <span>Sessão</span>
          <strong>{token ? "Ativa" : "Ausente"}</strong>
        </article>
        <article>
          <span>Expira em</span>
          <strong>{identity?.expiresAt
            ? new Date(identity.expiresAt).toLocaleString("pt-BR")
            : "—"}</strong>
        </article>
        <article>
          <span>Papéis</span>
          <strong>{identity?.roles.length ?? 0}</strong>
        </article>
        <article>
          <span>Jogadores online</span>
          <strong>{presence.filter((item) => item.status !== "offline").length}</strong>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <h2>Permissões</h2>
          <div className={styles.roles}>
            {identity?.roles.map((role) => <span key={role}>{role}</span>)}
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={() => void rotateSession()}>
              Rotacionar sessão
            </button>
            <button type="button" className={styles.danger} onClick={() => void logout()}>
              Encerrar sessão
            </button>
          </div>
        </article>

        <article className={styles.panel}>
          <h2>Presença ao vivo</h2>
          <div className={styles.list}>
            {presence.map((item) => (
              <div key={item.userId}>
                <div>
                  <strong>{item.displayName}</strong>
                  <span>{item.locationCode ?? "Local não informado"}</span>
                </div>
                <small>{item.status}</small>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <h2>Notificações</h2>
        <div className={styles.list}>
          {notifications.map((notification) => (
            <div key={notification.id} data-unread={!notification.readAt}>
              <div>
                <strong>{notification.title}</strong>
                <span>{notification.body}</span>
                <small>{new Date(notification.createdAt).toLocaleString("pt-BR")}</small>
              </div>
              {!notification.readAt ? (
                <button type="button" onClick={() => void markRead(notification.id)}>
                  Marcar como lida
                </button>
              ) : <small>Lida</small>}
            </div>
          ))}
          {notifications.length === 0 ? <p>Nenhuma notificação.</p> : null}
        </div>
      </section>

      <footer>Tehkné Solutions</footer>
    </main>
  );
}
