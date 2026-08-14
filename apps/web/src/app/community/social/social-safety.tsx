"use client";

import { useCallback, useEffect, useId, useState } from "react";
import styles from "./social.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type SocialSafetyResourceType =
  | "creator_content"
  | "creator_channel"
  | "creator_comment"
  | "creator_message";

export type SocialSafetyTarget = Readonly<{
  resourceType: SocialSafetyResourceType;
  resourceId: string;
  userId: string;
  label: string;
}>;

type ReportCategory =
  | "spam"
  | "fraud"
  | "scam"
  | "harassment"
  | "hate"
  | "sexual"
  | "violence"
  | "illegal"
  | "ip"
  | "misleading_ad"
  | "unsafe_ugc"
  | "other";

type ApiError = { message?: string; error?: string };

type BlockedUser = Readonly<{
  userId: string;
  displayName: string;
  blockedAt: string;
}>;

const reportCategories: readonly Readonly<{ value: ReportCategory; label: string }>[] = [
  { value: "spam", label: "Spam" },
  { value: "fraud", label: "Fraude" },
  { value: "scam", label: "Golpe" },
  { value: "harassment", label: "Assédio" },
  { value: "hate", label: "Ódio" },
  { value: "sexual", label: "Conteúdo sexual impróprio" },
  { value: "violence", label: "Violência" },
  { value: "illegal", label: "Atividade ilegal" },
  { value: "ip", label: "Propriedade intelectual" },
  { value: "misleading_ad", label: "Publicidade enganosa" },
  { value: "unsafe_ugc", label: "UGC inseguro" },
  { value: "other", label: "Outro" }
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    let detail = `Falha ${response.status}`;
    try {
      const body = await response.json() as ApiError;
      detail = body.message ?? body.error ?? detail;
    } catch {
      // Mantém o status HTTP quando não houver JSON.
    }
    throw new Error(detail);
  }
  return response.json() as Promise<T>;
}

function reportRequest(target: SocialSafetyTarget, category: ReportCategory, reason: string): Promise<unknown> {
  if (target.resourceType === "creator_comment") {
    return api(`/v1/creator/comments/${target.resourceId}/report`, {
      method: "POST",
      body: JSON.stringify({ category, reason })
    });
  }
  if (target.resourceType === "creator_message") {
    return api(`/v1/creator/dm/messages/${target.resourceId}/report`, {
      method: "POST",
      body: JSON.stringify({ category, reason })
    });
  }
  return api("/v1/creator-moderation/reports", {
    method: "POST",
    body: JSON.stringify({
      resourceType: target.resourceType,
      resourceId: target.resourceId,
      category,
      reason
    })
  });
}

export function SocialSafetyAction({
  target,
  disabled = false,
  onChanged
}: {
  target: SocialSafetyTarget;
  disabled?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const panelId = useId();
  const categoryId = useId();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<ReportCategory>("harassment");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "A ação de segurança não foi concluída.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReport() {
    const reportReason = reason.trim();
    if (reportReason.length < 10) {
      setError("Descreva o motivo da denúncia com pelo menos 10 caracteres.");
      return;
    }
    await run(async () => {
      await reportRequest(target, category, reportReason);
      setReason("");
      setNotice("Denúncia registrada na fila de moderação.");
    });
  }

  async function blockUser() {
    await run(async () => {
      await api(`/v1/creator/users/${target.userId}/block`, { method: "POST" });
      setNotice("Conta bloqueada. Interações e conversas futuras foram interrompidas.");
      if (onChanged) await onChanged();
    });
  }

  return (
    <div>
      <button
        className={styles.buttonQuiet}
        type="button"
        disabled={disabled || busy}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((current) => !current);
          setNotice(null);
          setError(null);
        }}
      >
        Segurança
      </button>
      {open ? (
        <section id={panelId} className={styles.panel} aria-label={`Ações de segurança para ${target.label}`}>
          <div className={styles.formRow}>
            <label htmlFor={categoryId}>Motivo da denúncia</label>
            <select
              id={categoryId}
              className={styles.select}
              value={category}
              disabled={busy}
              onChange={(event) => setCategory(event.target.value as ReportCategory)}
            >
              {reportCategories.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className={styles.formRow}>
            <label htmlFor={reasonId}>Contexto para a moderação</label>
            <textarea
              id={reasonId}
              className={styles.textarea}
              minLength={10}
              maxLength={1000}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Explique o que ocorreu sem incluir dados pessoais desnecessários."
            />
          </div>
          <div className={styles.actions}>
            <button className={styles.button} type="button" disabled={busy || reason.trim().length < 10} onClick={() => void submitReport()}>
              Enviar denúncia
            </button>
            <button className={styles.buttonQuiet} type="button" disabled={busy} onClick={() => void blockUser()}>
              Bloquear conta
            </button>
          </div>
          {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

export function SocialSafetyPanel() {
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBlockedUsers = useCallback(async () => {
    setError(null);
    try {
      const result = await api<{ blockedUsers: BlockedUser[] }>("/v1/creator/blocks/me?limit=100");
      setBlockedUsers(result.blockedUsers);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as contas bloqueadas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBlockedUsers();
  }, [loadBlockedUsers]);

  async function unblock(user: BlockedUser) {
    setBusyUserId(user.userId);
    setNotice(null);
    setError(null);
    try {
      await api(`/v1/creator/users/${user.userId}/block`, { method: "DELETE" });
      await loadBlockedUsers();
      setNotice(`${user.displayName} foi desbloqueado. Conversas anteriores não são reabertas automaticamente.`);
    } catch (unblockError) {
      setError(unblockError instanceof Error ? unblockError.message : "Não foi possível desbloquear a conta.");
    } finally {
      setBusyUserId(null);
    }
  }

  return (
    <section aria-labelledby="social-safety-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="social-safety-title">Contas bloqueadas</h2>
          <p>Bloqueios interrompem interações sociais e fecham conversas abertas sem apagar evidências de moderação.</p>
        </div>
        <button className={styles.buttonQuiet} type="button" disabled={loading} onClick={() => void loadBlockedUsers()}>
          Atualizar
        </button>
      </div>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {loading ? <div className={styles.empty}>Carregando bloqueios...</div> : blockedUsers.length === 0 ? (
        <div className={styles.empty}>Você não bloqueou nenhuma conta.</div>
      ) : (
        <div className={styles.activityList}>
          {blockedUsers.map((user) => (
            <article className={styles.activity} key={user.userId}>
              <div>
                <h3>{user.displayName}</h3>
                <p>Bloqueado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(user.blockedAt))}</p>
              </div>
              <button className={styles.buttonQuiet} type="button" disabled={busyUserId === user.userId} onClick={() => void unblock(user)}>
                Desbloquear
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

// Tehkné Solutions
