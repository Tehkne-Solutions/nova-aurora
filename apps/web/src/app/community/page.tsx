"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Announcement = Readonly<{
  id: string;
  announcementKey: string;
  title: string;
  body: string;
  audience: string;
  severity: string;
  publishedAt: string | null;
  expiresAt: string | null;
  readAt: string | null;
}>;

export default function CommunityPage() {
  const [announcements,setAnnouncements] = useState<readonly Announcement[]>([]);
  const [message,setMessage] = useState("Carregando comunicados do beta…");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/community/announcements`, {
        cache: "no-store"
      });
      const payload = await response.json() as {
        announcements?: readonly Announcement[];
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message ?? "Comunicação indisponível.");
      setAnnouncements(payload.announcements ?? []);
      setMessage(payload.announcements?.length
        ? "Comunicados atualizados."
        : "Nenhum comunicado ativo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar comunicados.");
    }
  },[]);

  useEffect(() => { void load(); },[load]);

  async function markRead(id: string) {
    await fetch(`${API_URL}/v1/community/announcements/${id}/read`, {
      method: "POST"
    });
    await load();
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · COMUNIDADE</p>
          <h1>O beta aprende em público, sem esconder os riscos.</h1>
          <p>
            Atualizações operacionais, mudanças de onda e decisões de produto
            aparecem aqui com prioridade e vigência.
          </p>
        </div>
        <nav>
          <Link href="/community/social">Hub social</Link>
          <Link href="/feedback">Enviar feedback</Link>
          <Link href="/beta-control">Meu beta</Link>
          <Link href="/status">Status</Link>
          <button type="button" onClick={() => void load()}>Atualizar</button>
        </nav>
      </header>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>

      <section className={styles.list}>
        {announcements.map((announcement) => (
          <article className={styles.section} key={announcement.id}>
            <p className={styles.eyebrow}>
              {announcement.severity.toUpperCase()} · {announcement.announcementKey}
            </p>
            <h2>{announcement.title}</h2>
            <p>{announcement.body}</p>
            <div className={styles.actions}>
              <span className={styles.tag}>
                {announcement.publishedAt
                  ? new Date(announcement.publishedAt).toLocaleString("pt-BR")
                  : "Publicação pendente"}
              </span>
              {!announcement.readAt ? (
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => void markRead(announcement.id)}
                >
                  Marcar como lido
                </button>
              ) : <span className={`${styles.tag} ${styles.good}`}>Lido</span>}
            </div>
          </article>
        ))}
      </section>

      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}
