"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth-provider";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type State = Readonly<{
  readiness: Readonly<{
    ready: boolean;
    activeOrUpcomingModerators: number;
    overdueCriticalReports: number;
    overdueHighReports: number;
    pendingAppeals: number;
    blockers: readonly string[];
  }>;
  reports: readonly Readonly<{
    id: string; reportKey: string; summary: string; details: string;
    category: string; priority: string; status: string;
    firstResponseDueAt: string | null;
  }>[];
  appeals: readonly Readonly<{
    id: string; appealKey: string; statement: string; status: string;
  }>[];
}>;

export default function ModerationPage() {
  const { identity } = useAuth();
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState("Carregando a operação de moderação…");
  const [busy, setBusy] = useState(false);
  const [reportId, setReportId] = useState("");
  const [subjectUserId, setSubjectUserId] = useState("");
  const [actionType, setActionType] = useState("warning");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/moderation/state`, { cache: "no-store" });
      const payload = await response.json() as State & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Operação indisponível.");
      setState(payload);
      setMessage(payload.readiness.ready
        ? "Cobertura e SLA estão dentro dos critérios registrados."
        : "A operação de moderação possui bloqueadores.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar moderação.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function post(path: string, body: unknown, idempotent = false) {
    setBusy(true);
    try {
      const headers = new Headers({ "content-type": "application/json" });
      if (idempotent) headers.set("idempotency-key", `moderation-${crypto.randomUUID()}`);
      const response = await fetch(`${API_URL}${path}`, {
        method: "POST", headers, body: JSON.stringify(body)
      });
      const payload = response.status === 204 ? {} : await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Operação não concluída.");
      setMessage("Operação registrada com trilha de auditoria.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  }

  async function applyAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await post("/v1/moderation/actions", {
      ...(reportId ? { reportId } : {}),
      ...(subjectUserId ? { subjectUserId } : {}),
      actionType,
      reason
    }, true);
  }

  async function scheduleCoverage() {
    if (!identity) return;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
    await post("/v1/moderation/shifts", {
      moderatorId: identity.userId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      notes: "Cobertura de 24 horas criada pelo painel operacional."
    });
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · MODERAÇÃO 0.17</p>
          <h1>Casos, SLA, ações e recursos.</h1>
          <p>Operação humana auditável para triagem, investigação, sanções proporcionais e revisão de recursos.</p>
        </div>
        <nav>
          <Link href="/operations" className={styles.link}>Operações</Link>
          <Link href="/beta-control" className={styles.link}>Beta controlado</Link>
          <Link href="/status" className={styles.link}>Status</Link>
          <button type="button" onClick={() => void load()} disabled={busy}>Atualizar</button>
        </nav>
      </header>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>
      <section className={styles.metrics}>
        <article className={styles.metric}><span>Prontidão</span><strong>{state?.readiness.ready ? "OK" : "BLOQUEADA"}</strong></article>
        <article className={styles.metric}><span>Moderadores 24h</span><strong>{state?.readiness.activeOrUpcomingModerators ?? 0}</strong></article>
        <article className={styles.metric}><span>Críticos vencidos</span><strong>{state?.readiness.overdueCriticalReports ?? 0}</strong></article>
        <article className={styles.metric}><span>Recursos pendentes</span><strong>{state?.readiness.pendingAppeals ?? 0}</strong></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>AÇÃO MODERATIVA</p>
          <h2>Registrar decisão proporcional</h2>
          <form className={styles.form} onSubmit={applyAction}>
            <label>ID da denúncia<input className={styles.input} value={reportId} onChange={(event) => setReportId(event.target.value)}/></label>
            <label>ID do usuário<input className={styles.input} value={subjectUserId} onChange={(event) => setSubjectUserId(event.target.value)}/></label>
            <label>Tipo<select className={styles.select} value={actionType} onChange={(event) => setActionType(event.target.value)}>
              <option value="warning">Advertência</option>
              <option value="restrict-economy">Restringir economia</option>
              <option value="suspend-account">Suspender conta</option>
              <option value="remove-content">Remover conteúdo</option>
              <option value="no-action">Sem ação</option>
            </select></label>
            <label>Fundamentação<textarea className={styles.textarea} value={reason} onChange={(event) => setReason(event.target.value)} minLength={8} required/></label>
            <button className={styles.button} type="submit" disabled={busy}>Registrar ação</button>
          </form>
        </article>
        <article className={styles.section}>
          <p className={styles.eyebrow}>COBERTURA</p>
          <h2>Plantão das próximas 24 horas</h2>
          <button className={styles.button} type="button" disabled={busy || !identity} onClick={() => void scheduleCoverage()}>
            Assumir cobertura de 24h
          </button>
          <ul>{state?.readiness.blockers.length
            ? state.readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)
            : <li>Nenhum bloqueador operacional.</li>}</ul>
        </article>
      </section>

      <section className={styles.section}>
        <p className={styles.eyebrow}>FILA PRIORITÁRIA</p>
        <h2>Denúncias em atendimento</h2>
        <div className={styles.list}>{state?.reports.length ? state.reports.map((report) => (
          <div className={styles.item} key={report.id}>
            <div>
              <strong>{report.reportKey} · {report.summary}</strong>
              <span>{report.category} · {report.priority} · {report.status}</span>
              <span>{report.details}</span>
              <span>Primeiro atendimento: {report.firstResponseDueAt ? new Date(report.firstResponseDueAt).toLocaleString("pt-BR") : "não calculado"}</span>
            </div>
            <div className={styles.actions}>
              <button className={styles.button} type="button" disabled={busy || !identity}
                onClick={() => identity && void post(`/v1/moderation/reports/${report.id}/assign`, { moderatorId: identity.userId })}>Assumir</button>
              <button className={styles.button} type="button" disabled={busy}
                onClick={() => void post(`/v1/moderation/reports/${report.id}/acknowledge`, {})}>Iniciar análise</button>
            </div>
          </div>
        )) : <p>Nenhuma denúncia registrada.</p>}</div>
      </section>

      <section className={styles.section}>
        <p className={styles.eyebrow}>RECURSOS</p>
        <h2>Revisão de sanções</h2>
        <div className={styles.list}>{state?.appeals.length ? state.appeals.map((appeal) => (
          <div className={styles.item} key={appeal.id}>
            <div><strong>{appeal.appealKey}</strong><span>{appeal.statement}</span></div>
            <div className={styles.actions}>
              <span className={styles.tag}>{appeal.status}</span>
              <button className={styles.button} type="button" disabled={busy}
                onClick={() => void post(`/v1/moderation/appeals/${appeal.id}/review`, { decision: "upheld", note: "Recurso acolhido após revisão humana." })}>Acolher</button>
              <button className={styles.button} type="button" disabled={busy}
                onClick={() => void post(`/v1/moderation/appeals/${appeal.id}/review`, { decision: "denied", note: "Ação mantida após revisão humana." })}>Negar</button>
            </div>
          </div>
        )) : <p>Nenhum recurso pendente.</p>}</div>
      </section>
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}
