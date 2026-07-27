"use client";

import Link from "next/link";
import { useAuth } from "../auth-provider";
import { useCallback,useEffect,useMemo,useState,type FormEvent } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type BetaState = Readonly<{
  readiness: Readonly<{
    ready: boolean;
    activeAnnouncement: boolean;
    unresolvedCriticalFeedback: number;
    blockers: readonly string[];
  }>;
  metrics: readonly Readonly<{
    metricDate: string;
    waveKey: string;
    activatedUsers: number;
    activeUsers: number;
    retentionD1Percent: number;
    retentionD7Percent: number;
    errorRatePercent: number;
    averageFeedbackScore: number;
    healthScore: number;
    recommendation: string;
  }>[];
  feedback: readonly Readonly<{
    id: string;
    feedbackKey: string;
    category: string;
    score: number;
    summary: string;
    status: string;
    priority: string;
  }>[];
  announcements: readonly Readonly<{
    id: string;
    announcementKey: string;
    title: string;
    status: string;
    severity: string;
  }>[];
  reports: readonly Readonly<{
    id: string;
    reportKey: string;
    waveKey: string;
    recommendation: string;
    status: string;
  }>[];
}>;

type SupportTicket = Readonly<{
  id: string;
  ticketKey: string;
  userId: string;
  category: string;
  priority: string;
  subject: string;
  status: string;
  firstResponseDueAt: string;
  resolutionDueAt: string;
}>;

type FeatureFlag = Readonly<{
  id: string;
  flagKey: string;
  label: string;
  description: string;
  status: string;
  defaultVariant: string;
  variants: readonly string[];
  rolloutPercent: number;
  approvals: number;
  rejections: number;
}>;

type SupportState = Readonly<{
  readiness: Readonly<{
    ready: boolean;
    supportHealthy: boolean;
    rolloutPrepared: boolean;
    supportBreaches: number;
    openCriticalTickets: number;
    approvedFlags: number;
    blockers: readonly string[];
  }>;
  tickets: readonly SupportTicket[];
  flags: readonly FeatureFlag[];
}>;

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR",{
    dateStyle: "short",timeStyle: "short"
  }).format(new Date(value));
}

export default function BetaInsightsPage() {
  const { identity } = useAuth();
  const [state,setState] = useState<BetaState | null>(null);
  const [supportState,setSupportState] = useState<SupportState | null>(null);
  const [message,setMessage] = useState("Carregando operações do beta…");
  const [busy,setBusy] = useState(false);
  const [title,setTitle] = useState("Atualização operacional do beta");
  const [body,setBody] = useState(
    "A onda permanece controlada enquanto avaliamos retenção, erros e feedback."
  );
  const [selectedTicketId,setSelectedTicketId] = useState("");
  const [ticketStatus,setTicketStatus] = useState("acknowledged");
  const [ticketPriority,setTicketPriority] = useState("normal");
  const [ticketMessage,setTicketMessage] = useState(
    "Recebemos sua solicitação e iniciamos a análise."
  );
  const [flagKey,setFlagKey] = useState("");
  const [flagLabel,setFlagLabel] = useState("");
  const [flagDescription,setFlagDescription] = useState("");
  const [flagVariants,setFlagVariants] = useState("candidate");
  const [flagPercent,setFlagPercent] = useState(10);

  const isPlatformAdmin = identity?.roles.includes("platform-admin") ?? false;
  const isAdmin = isPlatformAdmin
    || identity?.roles.includes("municipal-admin");

  const load = useCallback(async () => {
    try {
      const [insightsResponse,supportResponse] = await Promise.all([
        fetch(`${API_URL}/v1/beta-insights/state`,{ cache: "no-store" }),
        fetch(`${API_URL}/v1/beta-support/admin/state`,{ cache: "no-store" })
      ]);
      const insights = await insightsResponse.json() as BetaState & { message?: string };
      const support = await supportResponse.json() as SupportState & { message?: string };
      if (!insightsResponse.ok) {
        throw new Error(insights.message ?? "Insights indisponíveis.");
      }
      if (!supportResponse.ok) {
        throw new Error(support.message ?? "Operações de suporte indisponíveis.");
      }
      setState(insights);
      setSupportState(support);
      if (!selectedTicketId && support.tickets[0]) {
        setSelectedTicketId(support.tickets[0].id);
        setTicketPriority(support.tickets[0].priority);
      }
      setMessage(
        insights.readiness.ready && support.readiness.ready
          ? "Comunidade, suporte e rollout atendem aos gates operacionais."
          : "Existem bloqueadores de comunicação, suporte ou rollout."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar operações.");
    }
  },[selectedTicketId]);

  useEffect(() => { if (isAdmin) void load(); },[isAdmin,load]);
  const latest = state?.metrics[0] ?? null;
  const progress = useMemo(() => {
    if (!state) return 0;
    return state.readiness.ready ? 100 : state.readiness.activeAnnouncement ? 50 : 0;
  },[state]);

  async function recompute() {
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/beta-insights/recompute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = await response.json() as { computed?: number; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Métricas não calculadas.");
      setMessage(`${payload.computed ?? 0} onda(s) recalculada(s).`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao recalcular.");
    } finally {
      setBusy(false);
    }
  }

  async function createAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/beta-insights/announcements`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `announcement-${crypto.randomUUID()}`
        },
        body: JSON.stringify({ title,body,audience: "beta",severity: "info" })
      });
      const payload = await response.json() as {
        announcement?: { id: string };
        message?: string;
      };
      if (!response.ok || !payload.announcement) {
        throw new Error(payload.message ?? "Anúncio não criado.");
      }
      const publish = await fetch(
        `${API_URL}/v1/beta-insights/announcements/${payload.announcement.id}/publish`,
        { method: "POST" }
      );
      if (!publish.ok) throw new Error("Anúncio criado, mas não publicado.");
      setMessage("Anúncio criado e publicado.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao publicar.");
    } finally {
      setBusy(false);
    }
  }

  async function updateTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTicketId) {
      setMessage("Selecione um ticket para atualizar.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${API_URL}/v1/beta-support/admin/tickets/${selectedTicketId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: ticketStatus,
            priority: ticketPriority,
            message: ticketMessage,
            visibleToUser: true
          })
        }
      );
      if (!response.ok) {
        const payload = await response.json() as { message?: string };
        throw new Error(payload.message ?? "Ticket não atualizado.");
      }
      setMessage("Ticket atualizado e resposta publicada ao usuário.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar ticket.");
    } finally {
      setBusy(false);
    }
  }

  async function createFlag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const variants = flagVariants.split(",").map((value) => value.trim()).filter(Boolean);
      const response = await fetch(`${API_URL}/v1/feature-flags`,{
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `feature-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          flagKey,
          label: flagLabel,
          description: flagDescription,
          defaultVariant: "control",
          variants,
          rolloutPercent: flagPercent,
          targetWaveIds: [],
          safetyThresholds: {}
        })
      });
      const payload = await response.json() as { flag?: FeatureFlag; message?: string };
      if (!response.ok || !payload.flag) {
        throw new Error(payload.message ?? "Feature flag não criada.");
      }
      setFlagKey("");
      setFlagLabel("");
      setFlagDescription("");
      setMessage(`Flag ${payload.flag.flagKey} criada em modo draft.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar flag.");
    } finally {
      setBusy(false);
    }
  }

  async function flagAction(
    flag: FeatureFlag,
    action: "approve" | "activate" | "pause"
  ) {
    setBusy(true);
    try {
      const endpoint = action === "approve"
        ? `${API_URL}/v1/feature-flags/${flag.id}/approvals`
        : `${API_URL}/v1/feature-flags/${flag.id}/${action}`;
      const bodyPayload = action === "approve"
        ? { decision: "approve",note: "Aprovado após revisão operacional." }
        : action === "pause"
          ? { reason: "Pausa operacional solicitada pela central do beta." }
          : undefined;
      const response = await fetch(endpoint,{
        method: "POST",
        headers: bodyPayload ? { "content-type": "application/json" } : undefined,
        body: bodyPayload ? JSON.stringify(bodyPayload) : undefined
      });
      if (!response.ok) {
        const payload = await response.json() as { message?: string };
        throw new Error(payload.message ?? "Operação de rollout não concluída.");
      }
      setMessage(`Ação ${action} aplicada à flag ${flag.flagKey}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na operação de rollout.");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <main className={styles.shell}>
        <section className={styles.section}>
          <p className={styles.eyebrow}>ACESSO RESTRITO</p>
          <h1>Aprendizado do beta</h1>
          <p>Esta área exige papel administrativo.</p>
          <Link className={styles.link} href="/">Voltar</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · BETA INSIGHTS 0.19</p>
          <h1>Aprender, responder e liberar com evidência.</h1>
          <p>
            Telemetria e feedback orientam a decisão. Suporte controla SLA e
            feature flags entregam funcionalidades de forma gradual e reversível.
          </p>
        </div>
        <nav>
          <Link href="/moderation">Moderação</Link>
          <Link href="/community">Comunidade</Link>
          <Link href="/release">Release</Link>
          <button type="button" onClick={() => void load()} disabled={busy}>
            Atualizar
          </button>
        </nav>
      </header>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>

      <section className={styles.metrics}>
        <article className={styles.metric}>
          <span>Prontidão comunitária</span><strong>{progress}%</strong>
        </article>
        <article className={styles.metric}>
          <span>Health score</span><strong>{latest?.healthScore.toFixed(1) ?? "—"}</strong>
        </article>
        <article className={styles.metric}>
          <span>Retenção D7</span>
          <strong>{latest ? `${latest.retentionD7Percent.toFixed(1)}%` : "—"}</strong>
        </article>
        <article className={styles.metric}>
          <span>Recomendação</span><strong>{latest?.recommendation ?? "hold"}</strong>
        </article>
      </section>

      <section className={styles.metrics}>
        <article className={styles.metric}>
          <span>SLA vencido</span>
          <strong>{supportState?.readiness.supportBreaches ?? 0}</strong>
        </article>
        <article className={styles.metric}>
          <span>Tickets críticos</span>
          <strong>{supportState?.readiness.openCriticalTickets ?? 0}</strong>
        </article>
        <article className={styles.metric}>
          <span>Flags aprovadas</span>
          <strong>{supportState?.readiness.approvedFlags ?? 0}</strong>
        </article>
        <article className={styles.metric}>
          <span>Rollout preparado</span>
          <strong>{supportState?.readiness.rolloutPrepared ? "sim" : "não"}</strong>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>TELEMETRIA</p>
          <h2>Último retrato da onda</h2>
          {latest ? (
            <ul>
              <li>{latest.activeUsers}/{latest.activatedUsers} usuários ativos</li>
              <li>Retenção D1: {latest.retentionD1Percent.toFixed(2)}%</li>
              <li>Retenção D7: {latest.retentionD7Percent.toFixed(2)}%</li>
              <li>Erro: {latest.errorRatePercent.toFixed(2)}%</li>
              <li>Feedback médio: {latest.averageFeedbackScore.toFixed(2)}</li>
            </ul>
          ) : <p>Nenhuma métrica calculada.</p>}
          {isPlatformAdmin ? (
            <button
              className={styles.button}
              type="button"
              onClick={() => void recompute()}
              disabled={busy}
            >
              Recalcular dia concluído
            </button>
          ) : (
            <p>Recomputação disponível somente para administração da plataforma.</p>
          )}
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>COMUNICAÇÃO</p>
          <h2>Publicar atualização</h2>
          {isPlatformAdmin ? (
            <form className={styles.form} onSubmit={createAnnouncement}>
              <label>
                Título
                <input
                  className={styles.input}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label>
                Mensagem
                <textarea
                  className={styles.textarea}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
              </label>
              <button className={styles.button} disabled={busy}>Publicar</button>
            </form>
          ) : (
            <p>Publicação disponível somente para administração da plataforma.</p>
          )}
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>FILA DE SUPORTE</p>
          <h2>Responder e atualizar SLA</h2>
          <form className={styles.form} onSubmit={updateTicket}>
            <label>
              Ticket
              <select
                className={styles.select}
                value={selectedTicketId}
                onChange={(event) => {
                  const id = event.target.value;
                  setSelectedTicketId(id);
                  const ticket = supportState?.tickets.find((item) => item.id === id);
                  if (ticket) setTicketPriority(ticket.priority);
                }}
              >
                <option value="">Selecione</option>
                {supportState?.tickets.map((ticket) => (
                  <option key={ticket.id} value={ticket.id}>
                    {ticket.ticketKey} · {ticket.subject}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Estado
              <select
                className={styles.select}
                value={ticketStatus}
                onChange={(event) => setTicketStatus(event.target.value)}
              >
                <option value="acknowledged">Reconhecido</option>
                <option value="in-progress">Em andamento</option>
                <option value="waiting-user">Aguardando usuário</option>
                <option value="resolved">Resolvido</option>
                <option value="closed">Fechado</option>
              </select>
            </label>
            <label>
              Prioridade
              <select
                className={styles.select}
                value={ticketPriority}
                onChange={(event) => setTicketPriority(event.target.value)}
              >
                <option value="low">Baixa</option>
                <option value="normal">Normal</option>
                <option value="high">Alta</option>
                <option value="critical">Crítica</option>
              </select>
            </label>
            <label>
              Resposta pública
              <textarea
                className={styles.textarea}
                minLength={3}
                maxLength={8000}
                value={ticketMessage}
                onChange={(event) => setTicketMessage(event.target.value)}
              />
            </label>
            <button className={styles.button} disabled={busy || !selectedTicketId}>
              Atualizar ticket
            </button>
          </form>
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>FEATURE FLAGS</p>
          <h2>Criar rollout gradual</h2>
          {isPlatformAdmin ? (
            <form className={styles.form} onSubmit={createFlag}>
              <label>
                Chave
                <input
                  className={styles.input}
                  placeholder="gameplay.new-loop"
                  value={flagKey}
                  onChange={(event) => setFlagKey(event.target.value)}
                  required
                />
              </label>
              <label>
                Nome
                <input
                  className={styles.input}
                  value={flagLabel}
                  onChange={(event) => setFlagLabel(event.target.value)}
                  required
                />
              </label>
              <label>
                Descrição e risco controlado
                <textarea
                  className={styles.textarea}
                  value={flagDescription}
                  onChange={(event) => setFlagDescription(event.target.value)}
                  required
                />
              </label>
              <label>
                Variantes habilitadas, separadas por vírgula
                <input
                  className={styles.input}
                  value={flagVariants}
                  onChange={(event) => setFlagVariants(event.target.value)}
                />
              </label>
              <label>
                Percentual inicial
                <input
                  className={styles.input}
                  type="number"
                  min={0}
                  max={100}
                  value={flagPercent}
                  onChange={(event) => setFlagPercent(Number(event.target.value))}
                />
              </label>
              <button className={styles.button} disabled={busy}>Criar flag</button>
            </form>
          ) : (
            <p>Criação e controle de flags exigem administração da plataforma.</p>
          )}
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>TICKETS ATIVOS</p>
          <div className={styles.list}>
            {supportState?.tickets.length ? supportState.tickets.slice(0,30).map((ticket) => (
              <div className={styles.item} key={ticket.id}>
                <div>
                  <strong>{ticket.ticketKey} · {ticket.subject}</strong>
                  <span>{ticket.category} · {ticket.priority} · {ticket.status}</span>
                  <span>
                    resposta {dateTime(ticket.firstResponseDueAt)} · resolução {dateTime(ticket.resolutionDueAt)}
                  </span>
                </div>
                <span className={styles.tag}>{ticket.userId.slice(0,8)}</span>
              </div>
            )) : <p>Nenhum ticket registrado.</p>}
          </div>
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>ROLLOUTS</p>
          <div className={styles.list}>
            {supportState?.flags.length ? supportState.flags.map((flag) => (
              <div className={styles.item} key={flag.id}>
                <div>
                  <strong>{flag.flagKey} · {flag.label}</strong>
                  <span>
                    {flag.status} · {flag.rolloutPercent}% · {flag.approvals} aprovação(ões) · {flag.rejections} rejeição(ões)
                  </span>
                  {isPlatformAdmin ? (
                    <div className={styles.actions}>
                      <button
                        className={styles.button}
                        type="button"
                        disabled={busy || flag.status === "active" || flag.status === "retired"}
                        onClick={() => void flagAction(flag,"approve")}
                      >
                        Aprovar
                      </button>
                      <button
                        className={styles.button}
                        type="button"
                        disabled={busy || !["ready","paused"].includes(flag.status)}
                        onClick={() => void flagAction(flag,"activate")}
                      >
                        Ativar
                      </button>
                      <button
                        className={styles.button}
                        type="button"
                        disabled={busy || flag.status !== "active"}
                        onClick={() => void flagAction(flag,"pause")}
                      >
                        Pausar
                      </button>
                    </div>
                  ) : null}
                </div>
                <span className={styles.tag}>{flag.defaultVariant}</span>
              </div>
            )) : <p>Nenhuma feature flag criada.</p>}
          </div>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>FEEDBACK</p>
          <div className={styles.list}>
            {state?.feedback.slice(0,20).map((item) => (
              <div className={styles.item} key={item.id}>
                <div>
                  <strong>{item.feedbackKey} · {item.category}</strong>
                  <span>{item.summary}</span>
                </div>
                <span>{item.priority} · {item.status}</span>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>RELATÓRIOS DE APRENDIZADO</p>
          <div className={styles.list}>
            {state?.reports.length
              ? state.reports.map((report) => (
                <div className={styles.item} key={report.id}>
                  <div>
                    <strong>{report.reportKey} · {report.waveKey}</strong>
                    <span>{report.recommendation}</span>
                  </div>
                  <span>{report.status}</span>
                </div>
              ))
              : <p>Nenhum relatório gerado.</p>}
          </div>
        </article>
      </section>

      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}
