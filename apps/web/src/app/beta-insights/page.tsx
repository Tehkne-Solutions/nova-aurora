"use client";

import Link from "next/link";
import { useAuth } from "../auth-provider";
import { useCallback,useEffect,useMemo,useState,type FormEvent } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type State = Readonly<{
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

export default function BetaInsightsPage() {
  const { identity } = useAuth();
  const [state,setState] = useState<State | null>(null);
  const [message,setMessage] = useState("Carregando aprendizado do beta…");
  const [busy,setBusy] = useState(false);
  const [title,setTitle] = useState("Atualização operacional do beta");
  const [body,setBody] = useState(
    "A onda permanece controlada enquanto avaliamos retenção, erros e feedback."
  );

  const isAdmin = identity?.roles.includes("platform-admin")
    || identity?.roles.includes("municipal-admin");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/beta-insights/state`, {
        cache: "no-store"
      });
      const payload = await response.json() as State & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Insights indisponíveis.");
      setState(payload);
      setMessage(payload.readiness.ready
        ? "Comunicação e feedback atendem ao gate operacional."
        : "Existem bloqueadores de comunicação ou feedback crítico.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar insights.");
    }
  },[]);

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
          <p className={styles.eyebrow}>NOVA AURORA · BETA INSIGHTS 0.18</p>
          <h1>Expandir, manter ou reduzir com evidência.</h1>
          <p>
            Health score combina confiabilidade, retenção, feedback, conversão e
            estabilidade econômica. A recomendação não altera a onda automaticamente.
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
          <button
            className={styles.button}
            type="button"
            onClick={() => void recompute()}
            disabled={busy}
          >
            Recalcular hoje
          </button>
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>COMUNICAÇÃO</p>
          <h2>Publicar atualização</h2>
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
