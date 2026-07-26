"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import styles from "../launch-ops.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type BetaState = Readonly<{
  readiness: Readonly<{
    ready: boolean; mode: string; status: string; killSwitch: boolean;
    plannedWaves: number; activeWaves: number; blockers: readonly string[];
  }>;
  control: Readonly<{
    mode: string; status: string; killSwitch: boolean;
    activeWaveId: string | null; reason: string | null;
  }>;
  waves: readonly Readonly<{
    id: string; waveKey: string; label: string; status: string;
    targetPercent: number; maxActivations: number; members: number; activeMembers: number;
  }>[];
  observations: readonly Readonly<{
    id: string; waveId: string | null; errorRatePercent: number;
    p95LatencyMs: number; criticalReports: number; activeUsers: number; recordedAt: string;
  }>[];
}>;

export default function BetaControlPage() {
  const [state, setState] = useState<BetaState | null>(null);
  const [message, setMessage] = useState("Carregando o controle do beta…");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("Onda inicial controlada");
  const [targetPercent, setTargetPercent] = useState("5");
  const [maxActivations, setMaxActivations] = useState("50");
  const [selectedWave, setSelectedWave] = useState("");
  const [userIds, setUserIds] = useState("");
  const [errorRate, setErrorRate] = useState("0");
  const [latency, setLatency] = useState("0");
  const [criticalReports, setCriticalReports] = useState("0");
  const [activeUsers, setActiveUsers] = useState("0");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/beta-control/state`, { cache: "no-store" });
      const payload = await response.json() as BetaState & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Controle de beta indisponível.");
      setState(payload);
      if (!selectedWave && payload.waves[0]) setSelectedWave(payload.waves[0].id);
      setMessage(payload.readiness.ready
        ? "Existe uma onda preparada e o kill switch está disponível."
        : "A ativação controlada possui bloqueadores.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar controle.");
    }
  }, [selectedWave]);

  useEffect(() => { void load(); }, [load]);

  async function post(path: string, body: unknown, idempotent = false) {
    setBusy(true);
    try {
      const headers = new Headers({ "content-type": "application/json" });
      if (idempotent) headers.set("idempotency-key", `beta-${crypto.randomUUID()}`);
      const response = await fetch(`${API_URL}${path}`, {
        method: "POST", headers, body: JSON.stringify(body)
      });
      const payload = response.status === 204 ? {} : await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Operação não concluída.");
      setMessage("Controle de rollout atualizado.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  }

  async function createWave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await post("/v1/beta-control/waves", {
      label,
      targetPercent: Number(targetPercent),
      maxActivations: Number(maxActivations),
      eligibility: { emailVerified: true, trustReady: true },
      thresholds: { maxErrorRatePercent: 2, maxP95LatencyMs: 1200, maxCriticalReports: 0 }
    }, true);
  }

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ids = userIds.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
    await post(`/v1/beta-control/waves/${selectedWave}/enroll`, { userIds: ids });
  }

  async function observe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await post("/v1/beta-control/observations", {
      ...(selectedWave ? { waveId: selectedWave } : {}),
      errorRatePercent: Number(errorRate),
      p95LatencyMs: Number(latency),
      criticalReports: Number(criticalReports),
      activeUsers: Number(activeUsers),
      metadata: { source: "operations-console" }
    });
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · BETA CONTROLADO 0.17</p>
          <h1>Ativar em ondas, observar e recuar.</h1>
          <p>Gates, moderação, componentes e limites de saúde são verificados antes e durante cada onda.</p>
        </div>
        <nav>
          <Link href="/moderation" className={styles.link}>Moderação</Link>
          <Link href="/release" className={styles.link}>Release</Link>
          <Link href="/status" className={styles.link}>Status</Link>
          <button type="button" onClick={() => void load()} disabled={busy}>Atualizar</button>
        </nav>
      </header>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>
      <section className={styles.metrics}>
        <article className={styles.metric}><span>Modo</span><strong>{state?.control.mode ?? "—"}</strong></article>
        <article className={styles.metric}><span>Estado</span><strong>{state?.control.status ?? "—"}</strong></article>
        <article className={styles.metric}><span>Kill switch</span><strong>{state?.control.killSwitch ? "ATIVO" : "PRONTO"}</strong></article>
        <article className={styles.metric}><span>Ondas ativas</span><strong>{state?.readiness.activeWaves ?? 0}</strong></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>NOVA ONDA</p>
          <h2>Definir limite de exposição</h2>
          <form className={styles.form} onSubmit={createWave}>
            <label>Nome<input className={styles.input} value={label} onChange={(event) => setLabel(event.target.value)} required/></label>
            <label>Percentual alvo<input className={styles.input} type="number" min="1" max="100" value={targetPercent} onChange={(event) => setTargetPercent(event.target.value)} required/></label>
            <label>Máximo de ativações<input className={styles.input} type="number" min="1" value={maxActivations} onChange={(event) => setMaxActivations(event.target.value)} required/></label>
            <button className={styles.button} type="submit" disabled={busy}>Preparar onda</button>
          </form>
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>KILL SWITCH</p>
          <h2>Interrupção imediata</h2>
          <p>{state?.control.reason ?? "Nenhum motivo operacional registrado."}</p>
          <div className={styles.actions}>
            <button className={styles.button} type="button" disabled={busy} onClick={() => void post("/v1/beta-control/kill-switch", {
              enabled: true, reason: "Interrupção manual pelo painel operacional."
            })}>Ativar kill switch</button>
            <button className={styles.button} type="button" disabled={busy} onClick={() => void post("/v1/beta-control/kill-switch", {
              enabled: false, reason: "Kill switch rearmado após revisão operacional."
            })}>Rearmar</button>
          </div>
          <ul>{state?.readiness.blockers.length
            ? state.readiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)
            : <li>Nenhum bloqueador da preparação.</li>}</ul>
        </article>
      </section>

      <section className={styles.section}>
        <p className={styles.eyebrow}>ONDAS</p>
        <h2>Progressão e reversão</h2>
        <div className={styles.list}>{state?.waves.length ? state.waves.map((wave) => (
          <div className={styles.item} key={wave.id}>
            <div>
              <strong>{wave.waveKey} · {wave.label}</strong>
              <span>{wave.targetPercent}% · limite {wave.maxActivations} · membros {wave.members} · ativos {wave.activeMembers}</span>
            </div>
            <div className={styles.actions}>
              <span className={styles.tag}>{wave.status}</span>
              <button className={styles.button} type="button" disabled={busy} onClick={() => {
                setSelectedWave(wave.id);
                void post(`/v1/beta-control/waves/${wave.id}/start`, { reason: "Início aprovado pelo painel operacional." });
              }}>Iniciar</button>
              <button className={styles.button} type="button" disabled={busy} onClick={() => void post(`/v1/beta-control/waves/${wave.id}/pause`, { reason: "Pausa operacional preventiva." })}>Pausar</button>
              <button className={styles.button} type="button" disabled={busy} onClick={() => void post(`/v1/beta-control/waves/${wave.id}/rollback`, { reason: "Rollback manual da onda." })}>Rollback</button>
              <button className={styles.button} type="button" disabled={busy} onClick={() => void post(`/v1/beta-control/waves/${wave.id}/complete`, { reason: "Critérios da onda concluídos." })}>Concluir</button>
            </div>
          </div>
        )) : <p>Nenhuma onda preparada.</p>}</div>
      </section>

      <section className={styles.grid}>
        <article className={styles.section}>
          <p className={styles.eyebrow}>MEMBROS</p>
          <h2>Inscrição explícita</h2>
          <form className={styles.form} onSubmit={enroll}>
            <label>Onda<select className={styles.select} value={selectedWave} onChange={(event) => setSelectedWave(event.target.value)}>
              <option value="">Selecione</option>
              {state?.waves.map((wave) => <option key={wave.id} value={wave.id}>{wave.waveKey} · {wave.label}</option>)}
            </select></label>
            <label>UUIDs dos usuários<textarea className={styles.textarea} value={userIds} onChange={(event) => setUserIds(event.target.value)} placeholder="Separe por vírgula, espaço ou linha" required/></label>
            <button className={styles.button} type="submit" disabled={busy || !selectedWave}>Inscrever usuários</button>
          </form>
        </article>

        <article className={styles.section}>
          <p className={styles.eyebrow}>OBSERVAÇÃO</p>
          <h2>Aplicar limites automáticos</h2>
          <form className={styles.form} onSubmit={observe}>
            <label>Taxa de erro (%)<input className={styles.input} type="number" step="0.01" min="0" value={errorRate} onChange={(event) => setErrorRate(event.target.value)} required/></label>
            <label>Latência p95 (ms)<input className={styles.input} type="number" min="0" value={latency} onChange={(event) => setLatency(event.target.value)} required/></label>
            <label>Denúncias críticas<input className={styles.input} type="number" min="0" value={criticalReports} onChange={(event) => setCriticalReports(event.target.value)} required/></label>
            <label>Usuários ativos<input className={styles.input} type="number" min="0" value={activeUsers} onChange={(event) => setActiveUsers(event.target.value)} required/></label>
            <button className={styles.button} type="submit" disabled={busy}>Registrar observação</button>
          </form>
        </article>
      </section>
      <footer className={styles.footer}>Tehkné Solutions</footer>
    </main>
  );
}
