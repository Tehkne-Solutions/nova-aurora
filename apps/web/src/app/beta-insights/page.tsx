"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth-provider";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type State = Readonly<{
  readiness: Readonly<{
    ready: boolean;
    eventCount24h: number;
    supportBreaches: number;
    openCriticalTickets: number;
    approvedFlags: number;
    blockers: readonly string[];
  }>;
  metrics: Readonly<{
    events24h: number;
    activeUsers7d: number;
    averageRating: number | null;
    openFeedback: number;
    openSupport: number;
    supportBreaches: number;
    criticalTickets: number;
  }>;
  funnel: readonly Readonly<{ eventKey: string; total: number; users: number }>[];
  tickets: readonly Readonly<{ id: string; ticketKey: string; priority: string; subject: string; status: string; firstResponseDueAt: string }>[];
  flags: readonly Readonly<{ id: string; key: string; label: string; status: string; rolloutPercent: number; approvals: number; rejections: number }>[];
}>;

export default function BetaInsightsPage() {
  const { identity } = useAuth();
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState("Carregando insights do beta…");
  const [busy, setBusy] = useState(false);
  const [flagKey, setFlagKey] = useState("new-market-experience");
  const [flagLabel, setFlagLabel] = useState("Nova experiência do mercado");
  const [rolloutPercent, setRolloutPercent] = useState(10);

  const isAdmin = identity?.roles.includes("platform-admin") || identity?.roles.includes("municipal-admin");
  const isPlatformAdmin = identity?.roles.includes("platform-admin") ?? false;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/beta-insights/admin`, { cache: "no-store" });
      const payload = await response.json() as State & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Insights indisponíveis.");
      setState(payload);
      setMessage(payload.readiness.ready
        ? "Telemetria, suporte e rollout estão operacionais."
        : "Ainda existem bloqueadores de produto no beta.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar insights.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  async function createFlag(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/beta-insights/admin/flags`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `flag-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          key: flagKey,
          label: flagLabel,
          description: "Rollout controlado criado pela central de insights do beta.",
          defaultVariant: "control",
          variants: ["control", "treatment"],
          rolloutPercent,
          targetWaveIds: [],
          safetyThresholds: { maxErrorRatePercent: 2, maxP95LatencyMs: 1200 }
        })
      });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Flag não criada.");
      setMessage("Flag criada como rascunho. São necessárias duas aprovações independentes.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar flag.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshGates(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/beta-insights/admin/refresh-gates`, { method: "POST" });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Gates não atualizados.");
      setMessage("Gates de produto atualizados com os dados atuais.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar gates.");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return <main className={styles.shell}><p className={styles.message}>Área restrita à operação do beta.</p></main>;
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · BETA INSIGHTS 0.18</p>
          <h1>Decisões de produto baseadas em evidência.</h1>
          <p>
            Eventos minimizados, feedback criptografado, suporte com SLA e flags
            graduais formam o ciclo operacional do beta.
          </p>
        </div>
        <nav>
          <Link href="/beta-control">Beta controlado</Link>
          <Link href="/moderation">Moderação</Link>
          <button type="button" onClick={() => void refreshGates()} disabled={busy}>Atualizar gates</button>
        </nav>
      </header>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>

      <section className={styles.metrics}>
        <article className={styles.metric}><span>Eventos 24h</span><strong>{state?.metrics.events24h ?? 0}</strong></article>
        <article className={styles.metric}><span>Usuários ativos 7d</span><strong>{state?.metrics.activeUsers7d ?? 0}</strong></article>
        <article className={styles.metric}><span>Tickets abertos</span><strong>{state?.metrics.openSupport ?? 0}</strong></article>
        <article className={styles.metric}><span>Nota média</span><strong>{state?.metrics.averageRating?.toFixed(2) ?? "—"}</strong></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>PRONTIDÃO</p>
          <h2>{state?.readiness.ready ? "Operacional" : "Bloqueada"}</h2>
          <ul>
            {state?.readiness.blockers.length
              ? state.readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)
              : <li>Nenhum bloqueador de produto registrado.</li>}
          </ul>
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>FUNIL DO BETA</p>
          <div className={styles.list}>
            {state?.funnel.length
              ? state.funnel.map((item) => (
                <div className={styles.item} key={item.eventKey}>
                  <div><strong>{item.eventKey}</strong><span>{item.users} usuários únicos</span></div>
                  <span>{item.total}</span>
                </div>
              ))
              : <p>Nenhum evento válido registrado.</p>}
          </div>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>SUPORTE E SLA</p>
          <div className={styles.list}>
            {state?.tickets.length
              ? state.tickets.slice(0, 20).map((ticket) => (
                <div className={styles.item} key={ticket.id}>
                  <div>
                    <strong>{ticket.ticketKey} · {ticket.subject}</strong>
                    <span>{ticket.priority} · vence {new Date(ticket.firstResponseDueAt).toLocaleString("pt-BR")}</span>
                  </div>
                  <span>{ticket.status}</span>
                </div>
              ))
              : <p>Fila de suporte vazia.</p>}
          </div>
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>FEATURE FLAGS</p>
          <div className={styles.list}>
            {state?.flags.length
              ? state.flags.map((flag) => (
                <div className={styles.item} key={flag.id}>
                  <div><strong>{flag.key}</strong><span>{flag.label} · {flag.rolloutPercent}%</span></div>
                  <span>{flag.status} · {flag.approvals}/2</span>
                </div>
              ))
              : <p>Nenhuma flag registrada.</p>}
          </div>
        </article>
      </section>

      {isPlatformAdmin ? (
        <section className={styles.section}>
          <p className={styles.eyebrow}>NOVA FLAG</p>
          <h2>Preparar rollout gradual</h2>
          <form className={styles.form} onSubmit={createFlag}>
            <label>Chave<input className={styles.input} value={flagKey} onChange={(event) => setFlagKey(event.target.value)} required /></label>
            <label>Rótulo<input className={styles.input} value={flagLabel} onChange={(event) => setFlagLabel(event.target.value)} required /></label>
            <label>Percentual inicial<input className={styles.input} type="number" min={0} max={100} value={rolloutPercent} onChange={(event) => setRolloutPercent(Number(event.target.value))} /></label>
            <button className={styles.button} type="submit" disabled={busy}>Criar rascunho</button>
          </form>
        </section>
      ) : null}

      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}
