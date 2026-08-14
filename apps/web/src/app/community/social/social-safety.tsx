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

type SafetyActivity = Readonly<{
  id: string;
  type: string;
  title: string;
  entity: { type: string; id: string | null };
  metadata: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}>;

type CreatorAppeal = Readonly<{
  id: string;
  report_id: string;
  reason: string;
  status: "pending" | "in_review" | "upheld" | "overturned";
  decision_reason: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resource_type: string;
  resource_id: string;
  category: string;
  priority: string;
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

function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function resourceLabel(resourceType: unknown): string {
  const labels: Record<string, string> = {
    creator_content: "Conteúdo",
    creator_channel: "Canal",
    creator_comment: "Comentário",
    creator_message: "Mensagem privada",
    ugc_blueprint: "UGC",
    ad_campaign: "Campanha",
    ad_surface: "Superfície publicitária",
    competition: "Competição"
  };
  return labels[String(resourceType)] ?? String(resourceType ?? "Recurso");
}

function appealStatusLabel(status: CreatorAppeal["status"]): string {
  if (status === "pending") return "Aguardando revisão";
  if (status === "in_review") return "Em revisão";
  if (status === "overturned") return "Apelação acolhida";
  return "Decisão mantida";
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
  const [safetyActivities, setSafetyActivities] = useState<SafetyActivity[]>([]);
  const [appeals, setAppeals] = useState<CreatorAppeal[]>([]);
  const [appealReasons, setAppealReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSafetyData = useCallback(async () => {
    setError(null);
    try {
      const [blockResult, activityResult, appealResult] = await Promise.all([
        api<{ blockedUsers: BlockedUser[] }>("/v1/creator/blocks/me?limit=100"),
        api<{ items: SafetyActivity[] }>("/v1/creator/activity?category=safety&limit=100"),
        api<{ appeals: CreatorAppeal[] }>("/v1/creator-moderation/appeals/me?limit=100")
      ]);
      setBlockedUsers(blockResult.blockedUsers);
      setSafetyActivities(activityResult.items);
      setAppeals(appealResult.appeals);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a central de segurança.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSafetyData();
  }, [loadSafetyData]);

  async function unblock(user: BlockedUser) {
    setBusyUserId(user.userId);
    setNotice(null);
    setError(null);
    try {
      await api(`/v1/creator/users/${user.userId}/block`, { method: "DELETE" });
      await loadSafetyData();
      setNotice(`${user.displayName} foi desbloqueado. Conversas anteriores não são reabertas automaticamente.`);
    } catch (unblockError) {
      setError(unblockError instanceof Error ? unblockError.message : "Não foi possível desbloquear a conta.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function fileAppeal(reportId: string) {
    const reason = (appealReasons[reportId] ?? "").trim();
    if (reason.length < 10) {
      setError("Explique a apelação com pelo menos 10 caracteres.");
      return;
    }
    setBusyReportId(reportId);
    setNotice(null);
    setError(null);
    try {
      await api(`/v1/creator-moderation/reports/${reportId}/appeal`, {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      setAppealReasons((current) => ({ ...current, [reportId]: "" }));
      await loadSafetyData();
      setNotice("Apelação registrada para revisão independente.");
    } catch (appealError) {
      setError(appealError instanceof Error ? appealError.message : "Não foi possível registrar a apelação.");
    } finally {
      setBusyReportId(null);
    }
  }

  const restrictionActivities = safetyActivities.filter((activity) => activity.type === "moderation_restricted");
  const appealByReport = new Map(appeals.map((appeal) => [appeal.report_id, appeal]));

  return (
    <section aria-labelledby="social-safety-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="social-safety-title">{loading ? "Carregando segurança..." : "Contas bloqueadas"}</h2>
          <p>Bloqueios interrompem interações sociais e fecham conversas abertas sem apagar evidências de moderação.</p>
        </div>
        <button className={styles.buttonQuiet} type="button" disabled={loading} onClick={() => void loadSafetyData()}>
          Atualizar
        </button>
      </div>

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      {!loading ? (
        <>
          {blockedUsers.length === 0 ? (
            <div className={styles.empty}>Você não bloqueou nenhuma conta.</div>
          ) : (
            <div className={styles.activityList}>
              {blockedUsers.map((user) => (
                <article className={styles.activity} key={user.userId}>
                  <div>
                    <h3>{user.displayName}</h3>
                    <p>Bloqueado em {dateTime(user.blockedAt)}</p>
                  </div>
                  <button className={styles.buttonQuiet} type="button" disabled={busyUserId === user.userId} onClick={() => void unblock(user)}>
                    Desbloquear
                  </button>
                </article>
              ))}
            </div>
          )}

          <section className={styles.detail} aria-labelledby="social-appeals-title">
            <div className={styles.sectionHeader}>
              <div>
                <h3 id="social-appeals-title">Restrições e apelações</h3>
                <p>Decisões da Creator Economy podem ser contestadas aqui sem copiar IDs manualmente.</p>
              </div>
            </div>

            {restrictionActivities.length === 0 ? (
              <div className={styles.empty}>Nenhuma restrição apelável registrada na sua atividade.</div>
            ) : (
              <div className={styles.activityList}>
                {restrictionActivities.map((activity) => {
                  const reportId = String(activity.metadata.reportId ?? activity.entity.id ?? "");
                  const resourceType = activity.metadata.resourceType;
                  const resourceId = String(activity.metadata.resourceId ?? "");
                  const existingAppeal = appealByReport.get(reportId);
                  const reason = appealReasons[reportId] ?? "";
                  const reasonId = `appeal-reason-${activity.id}`;
                  return (
                    <article className={styles.activity} key={activity.id}>
                      <div>
                        <h4>{resourceLabel(resourceType)} restringido</h4>
                        <p>Decisão registrada em {dateTime(activity.createdAt)}.</p>
                        {resourceId ? <p className={styles.code}>Recurso {resourceId}</p> : null}
                        {existingAppeal ? (
                          <>
                            <p><strong>{appealStatusLabel(existingAppeal.status)}</strong> · enviada em {dateTime(existingAppeal.created_at)}</p>
                            {existingAppeal.decision_reason ? <p>Fundamentação: {existingAppeal.decision_reason}</p> : null}
                          </>
                        ) : (
                          <div className={styles.formRow}>
                            <label htmlFor={reasonId}>Justificativa da apelação</label>
                            <textarea
                              id={reasonId}
                              className={styles.textarea}
                              minLength={10}
                              maxLength={1000}
                              value={reason}
                              disabled={busyReportId === reportId}
                              onChange={(event) => setAppealReasons((current) => ({
                                ...current,
                                [reportId]: event.target.value
                              }))}
                              placeholder="Explique por que a decisão deve ser revista por outra pessoa."
                            />
                            <div className={styles.actions}>
                              <button
                                className={styles.button}
                                type="button"
                                disabled={!reportId || busyReportId === reportId || reason.trim().length < 10}
                                onClick={() => void fileAppeal(reportId)}
                              >
                                Enviar apelação
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {appeals.length > 0 ? (
            <section className={styles.detail} aria-labelledby="appeal-history-title">
              <div className={styles.sectionHeader}>
                <div>
                  <h3 id="appeal-history-title">Histórico de apelações</h3>
                  <p>Acompanhe revisão, resultado e fundamentação das decisões.</p>
                </div>
              </div>
              <div className={styles.activityList}>
                {appeals.map((appeal) => (
                  <article className={styles.activity} key={appeal.id}>
                    <div>
                      <h4>{resourceLabel(appeal.resource_type)} · {appealStatusLabel(appeal.status)}</h4>
                      <p>Enviada em {dateTime(appeal.created_at)}{appeal.resolved_at ? ` · resolvida em ${dateTime(appeal.resolved_at)}` : ""}</p>
                      {appeal.decision_reason ? <p>Fundamentação: {appeal.decision_reason}</p> : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

// Tehkné Solutions
