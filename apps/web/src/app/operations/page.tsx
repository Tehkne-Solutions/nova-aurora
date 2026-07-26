"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../auth-provider";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type State = Readonly<{
  readiness: Readonly<{
    launchReady: boolean;
    operationalComponents: number;
    requiredComponents: number;
    incidentExerciseCurrent: boolean;
    launchRehearsalCurrent: boolean;
    rollbackRehearsalCurrent: boolean;
    openCriticalReports: number;
    blockers: readonly string[];
  }>;
  reports: readonly Readonly<{ id:string; reportKey:string; category:string; summary:string; details:string; priority:string; status:string; createdAt:string }>[];
  exercises: readonly Readonly<{ id:string; exerciseKey:string; scenario:string; status:string; scheduledAt:string; completedAt:string|null }>[];
  rehearsals: readonly Readonly<{ id:string; rehearsalKey:string; rehearsalType:string; environment:string; status:string; completedAt:string|null }>[];
  components: readonly Readonly<{ key:string; label:string; status:string; publicMessage:string|null; updatedAt:string }>[];
}>;

export default function OperationsPage() {
  const { identity } = useAuth();
  const [state, setState] = useState<State | null>(null);
  const [message, setMessage] = useState("Carregando prontidão operacional…");
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState("Comprometimento de credencial administrativa e tentativa de fraude econômica");
  const [rehearsalType, setRehearsalType] = useState("public-beta-open");

  const isAdmin = identity?.roles.includes("platform-admin") || identity?.roles.includes("municipal-admin");
  const isPlatformAdmin = identity?.roles.includes("platform-admin") ?? false;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/launch-operations/state`, { cache:"no-store" });
      const payload = await response.json() as State & { message?:string };
      if (!response.ok) throw new Error(payload.message ?? "Operação indisponível.");
      setState(payload);
      setMessage(payload.readiness.launchReady
        ? "Operação pronta para o gate registrado."
        : "Exercícios, ensaios ou filas críticas ainda bloqueiam a abertura.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar operação.");
    }
  }, []);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);
  const progress = useMemo(() => {
    if (!state) return 0;
    const readiness = state.readiness;
    const total = readiness.requiredComponents + 3;
    const complete = readiness.operationalComponents
      + Number(readiness.incidentExerciseCurrent)
      + Number(readiness.launchRehearsalCurrent)
      + Number(readiness.rollbackRehearsalCurrent);
    return Math.round(complete / total * 100);
  }, [state]);

  async function createExercise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/launch-operations/exercises`, {
        method:"POST",
        headers:{"content-type":"application/json","idempotency-key":`exercise-${crypto.randomUUID()}`},
        body:JSON.stringify({scenario,scheduledAt:new Date().toISOString(),objectives:["detectar","conter","comunicar","recuperar"]})
      });
      const payload = await response.json() as {message?:string};
      if (!response.ok) throw new Error(payload.message ?? "Exercício não criado.");
      setMessage("Exercício registrado. A aprovação exige evidência posterior.");
      await load();
    } catch(error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar exercício.");
    } finally { setBusy(false); }
  }

  async function createRehearsal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch(`${API_URL}/v1/launch-operations/rehearsals`, {
        method:"POST",
        headers:{"content-type":"application/json","idempotency-key":`rehearsal-${crypto.randomUUID()}`},
        body:JSON.stringify({rehearsalType,environment:"staging",checklist:["backup verificado","comunicação pronta","rollback testado","métricas observadas"]})
      });
      const payload = await response.json() as {message?:string};
      if (!response.ok) throw new Error(payload.message ?? "Ensaio não criado.");
      setMessage("Ensaio registrado. A prontidão só muda após conclusão com evidência.");
      await load();
    } catch(error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar ensaio.");
    } finally { setBusy(false); }
  }

  if (!isAdmin) {
    return <main className={styles.shell}><section className={styles.section}><p className={styles.eyebrow}>NOVA AURORA · OPERAÇÕES</p><h1>Acesso administrativo necessário</h1><Link href="/account" className={styles.link}>Voltar à conta</Link></section><footer className={styles.footer}>Tehkné Solutions</footer></main>;
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>NOVA AURORA · LAUNCH OPERATIONS 0.16</p><h1>Abertura ensaiada, não presumida.</h1><p>Fila de denúncias, exercícios, status dos serviços e ensaios de abertura e rollback.</p></div>
        <nav><Link href="/release" className={styles.link}>Release</Link><Link href="/status" className={styles.link}>Status público</Link><button type="button" onClick={() => void load()} disabled={busy}>Atualizar</button></nav>
      </header>
      <p className={styles.message} role="status">{message}</p>
      <section className={styles.metrics}>
        <article className={styles.metric}><span>Prontidão operacional</span><strong>{progress}%</strong></article>
        <article className={styles.metric}><span>Componentes</span><strong>{state?.readiness.operationalComponents ?? 0}/{state?.readiness.requiredComponents ?? 0}</strong></article>
        <article className={styles.metric}><span>Denúncias críticas</span><strong className={(state?.readiness.openCriticalReports ?? 0) > 0 ? styles.bad : styles.good}>{state?.readiness.openCriticalReports ?? 0}</strong></article>
        <article className={styles.metric}><span>Abertura</span><strong className={state?.readiness.launchReady ? styles.good : styles.warn}>{state?.readiness.launchReady ? "Pronta" : "Bloqueada"}</strong></article>
      </section>
      <section className={styles.grid}>
        <article className={styles.section}><h2>Novo exercício</h2><form className={styles.form} onSubmit={createExercise}><label>Cenário<textarea className={styles.textarea} value={scenario} onChange={(event) => setScenario(event.target.value)} minLength={8} required/></label><button className={styles.button} disabled={busy || !isPlatformAdmin}>Registrar exercício</button></form></article>
        <article className={styles.section}><h2>Novo ensaio</h2><form className={styles.form} onSubmit={createRehearsal}><label>Tipo<select className={styles.select} value={rehearsalType} onChange={(event) => setRehearsalType(event.target.value)}><option value="public-beta-open">Abertura do beta</option><option value="rollback">Rollback</option><option value="provider-delivery">Entrega do provedor</option><option value="backup-restore">Backup e restauração</option></select></label><button className={styles.button} disabled={busy || !isPlatformAdmin}>Registrar ensaio</button></form></article>
      </section>
      <section className={styles.section}><p className={styles.eyebrow}>BLOQUEADORES</p><div className={styles.list}>{state?.readiness.blockers.length ? state.readiness.blockers.map((blocker) => <div className={styles.item} key={blocker}><strong>{blocker}</strong><span className={`${styles.tag} ${styles.warn}`}>pendente</span></div>) : <p>Nenhum bloqueador operacional.</p>}</div></section>
      <section className={styles.grid}>
        <article className={styles.section}><h2>Componentes</h2><div className={styles.list}>{state?.components.map((component) => <div className={styles.item} key={component.key}><div><strong>{component.label}</strong><span>{component.publicMessage ?? "Sem observação"}</span></div><span className={styles.tag}>{component.status}</span></div>)}</div></article>
        <article className={styles.section}><h2>Fila de denúncias</h2><div className={styles.list}>{state?.reports.slice(0,12).map((report) => <div className={styles.item} key={report.id}><div><strong>{report.reportKey} · {report.summary}</strong><span>{report.category} · {new Date(report.createdAt).toLocaleString("pt-BR")}</span><span>{report.details}</span></div><span className={styles.tag}>{report.priority}/{report.status}</span></div>)}</div></article>
      </section>
      <section className={styles.grid}>
        <article className={styles.section}><h2>Exercícios</h2><div className={styles.list}>{state?.exercises.slice(0,10).map((exercise) => <div className={styles.item} key={exercise.id}><div><strong>{exercise.exerciseKey}</strong><span>{exercise.scenario}</span></div><span className={styles.tag}>{exercise.status}</span></div>)}</div></article>
        <article className={styles.section}><h2>Ensaios</h2><div className={styles.list}>{state?.rehearsals.slice(0,10).map((rehearsal) => <div className={styles.item} key={rehearsal.id}><div><strong>{rehearsal.rehearsalKey}</strong><span>{rehearsal.rehearsalType} · {rehearsal.environment}</span></div><span className={styles.tag}>{rehearsal.status}</span></div>)}</div></article>
      </section>
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}
