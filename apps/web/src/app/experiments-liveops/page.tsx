"use client";

import Link from "next/link";
import { useCallback,useEffect,useMemo,useState,type FormEvent } from "react";
import { useAuth } from "../auth-provider";
import styles from "../launch-ops.module.css";

const API_URL=process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Experiment=Readonly<{
  id:string; experimentKey:string; flagKey:string; label:string; hypothesis:string;
  primaryMetric:string; status:string; approvals:number; rejections:number;
  minimumSample:number; minimumRuntimeHours:number; minimumLiftPercent:number;
}>;
type Result=Readonly<{
  id:string; experimentId:string; variant:string; periodStart:string; periodEnd:string;
  exposedUsers:number; activeUsers:number; primaryMetricValue:number;
  recommendation:string; evidence:unknown; computedAt:string;
}>;
type LiveOpsEvent=Readonly<{
  id:string; eventKey:string; experimentId:string|null; experimentKey:string|null;
  eventType:string; title:string; description:string; status:string; startsAt:string;
  endsAt:string|null; severity:string;
}>;
type TimelineEntry=Readonly<{
  id:string; kind:string; event:string; status:string|null; actorId:string|null;
  occurredAt:string; details:unknown;
}>;
type State=Readonly<{
  experiments:readonly Experiment[];
  results:readonly Result[];
}>;
type LiveOpsState=Readonly<{
  calendar:readonly LiveOpsEvent[];
  activeIncidents:number;
  upcoming:number;
}>;

function dateTime(value:string):string {
  return new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date(value));
}

async function post(url:string,body?:unknown,idempotencyKey?:string):Promise<Response> {
  const headers:Record<string,string>={};
  const init:RequestInit={method:"POST"};
  if (body!==undefined) {
    headers["content-type"]="application/json";
    init.body=JSON.stringify(body);
  }
  if (idempotencyKey) headers["idempotency-key"]=idempotencyKey;
  if (Object.keys(headers).length) init.headers=headers;
  return fetch(url,init);
}

export default function ExperimentsLiveOpsPage() {
  const {identity}=useAuth();
  const isPlatformAdmin=identity?.roles.includes("platform-admin") ?? false;
  const isAdmin=isPlatformAdmin || (identity?.roles.includes("municipal-admin") ?? false);
  const [state,setState]=useState<State|null>(null);
  const [liveOps,setLiveOps]=useState<LiveOpsState|null>(null);
  const [timeline,setTimeline]=useState<readonly TimelineEntry[]>([]);
  const [selectedExperiment,setSelectedExperiment]=useState("");
  const [message,setMessage]=useState("Carregando experimentação e LiveOps…");
  const [busy,setBusy]=useState(false);
  const [eventType,setEventType]=useState("experiment-review");
  const [severity,setSeverity]=useState("info");
  const [title,setTitle]=useState("Revisão operacional do experimento");
  const [description,setDescription]=useState("Revisar maturidade, lift, guardrails e impacto operacional antes da decisão humana.");
  const [startsAt,setStartsAt]=useState(()=>new Date(Date.now()+3_600_000).toISOString().slice(0,16));

  const load=useCallback(async()=>{
    try {
      const [experimentResponse,liveOpsResponse]=await Promise.all([
        fetch(`${API_URL}/v1/beta-experiments/admin/state`,{cache:"no-store"}),
        fetch(`${API_URL}/v1/beta-liveops/admin/state`,{cache:"no-store"})
      ]);
      const experimentPayload=await experimentResponse.json() as State & {message?:string};
      const liveOpsPayload=await liveOpsResponse.json() as LiveOpsState & {message?:string};
      if (!experimentResponse.ok) throw new Error(experimentPayload.message ?? "Experimentos indisponíveis.");
      if (!liveOpsResponse.ok) throw new Error(liveOpsPayload.message ?? "LiveOps indisponível.");
      setState(experimentPayload);
      setLiveOps(liveOpsPayload);
      if (!selectedExperiment && experimentPayload.experiments[0]) {
        setSelectedExperiment(experimentPayload.experiments[0].id);
      }
      setMessage("Experimentos, resultados e agenda operacional sincronizados.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao carregar o dashboard.");
    }
  },[selectedExperiment]);

  useEffect(()=>{ if (isAdmin) void load(); },[isAdmin,load]);

  useEffect(()=>{
    if (!selectedExperiment || !isAdmin) {
      setTimeline([]);
      return;
    }
    void fetch(`${API_URL}/v1/beta-liveops/experiments/${selectedExperiment}/timeline`,{cache:"no-store"})
      .then(async(response)=>{
        const payload=await response.json() as {timeline?:readonly TimelineEntry[];message?:string};
        if (!response.ok) throw new Error(payload.message ?? "Timeline indisponível.");
        setTimeline(payload.timeline ?? []);
      })
      .catch((error:unknown)=>setMessage(error instanceof Error ? error.message : "Falha na timeline."));
  },[selectedExperiment,isAdmin]);

  const selected=state?.experiments.find((item)=>item.id===selectedExperiment) ?? null;
  const selectedResults=useMemo(
    ()=>state?.results.filter((item)=>item.experimentId===selectedExperiment) ?? [],
    [state,selectedExperiment]
  );
  const running=state?.experiments.filter((item)=>item.status==="running").length ?? 0;
  const guardrails=selectedResults.filter((item)=>["reduce","stop"].includes(item.recommendation)).length;

  async function createEvent(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isPlatformAdmin) return;
    setBusy(true);
    try {
      const startIso=new Date(startsAt).toISOString();
      const response=await post(`${API_URL}/v1/beta-liveops/events`,{
        eventKey:`liveops-${crypto.randomUUID()}`,
        ...(selectedExperiment?{experimentId:selectedExperiment}:{}),
        eventType,title,description,status:"scheduled",startsAt:startIso,severity
      },`liveops-${crypto.randomUUID()}`);
      const payload=await response.json() as {message?:string};
      if (!response.ok) throw new Error(payload.message ?? "Evento LiveOps não criado.");
      setMessage("Evento LiveOps agendado e registrado na trilha auditável.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar evento.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(event:LiveOpsEvent,status:"active"|"completed"|"cancelled") {
    setBusy(true);
    try {
      const response=await post(`${API_URL}/v1/beta-liveops/events/${event.id}/status`,{
        status,reason:`Transição ${status} registrada pela central LiveOps.`
      });
      if (!response.ok) {
        const payload=await response.json() as {message?:string};
        throw new Error(payload.message ?? "Transição não concluída.");
      }
      setMessage(`Evento ${event.eventKey} atualizado para ${status}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na transição LiveOps.");
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return <main className={styles.shell}><section className={styles.section}>
      <p className={styles.eyebrow}>ACESSO RESTRITO</p><h1>Experimentação e LiveOps</h1>
      <p>Esta área exige papel administrativo.</p><Link className={styles.link} href="/">Voltar</Link>
    </section></main>;
  }

  return <main className={styles.shell}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>NOVA AURORA · SPRINT 20</p>
        <h1>Experimentar com evidência. Operar com controle.</h1>
        <p>Coortes, lift, guardrails, decisões humanas, calendário e incidentes em uma única central auditável.</p>
      </div>
      <nav><Link href="/beta-insights">Beta Insights</Link><Link href="/release">Release</Link>
        <button type="button" onClick={()=>void load()} disabled={busy}>Atualizar</button></nav>
    </header>

    <p className={styles.message} role="status" aria-live="polite">{message}</p>

    <section className={styles.metrics}>
      <article className={styles.metric}><span>Experimentos ativos</span><strong>{running}</strong></article>
      <article className={styles.metric}><span>Guardrails acionados</span><strong>{guardrails}</strong></article>
      <article className={styles.metric}><span>Incidentes ativos</span><strong>{liveOps?.activeIncidents ?? 0}</strong></article>
      <article className={styles.metric}><span>Eventos futuros</span><strong>{liveOps?.upcoming ?? 0}</strong></article>
    </section>

    <section className={styles.grid}>
      <article className={styles.section}>
        <p className={styles.eyebrow}>EXPERIMENTOS</p><h2>Selecionar análise</h2>
        <label>Experimento<select className={styles.select} value={selectedExperiment}
          onChange={(event)=>setSelectedExperiment(event.target.value)}>
          <option value="">Selecione</option>
          {state?.experiments.map((item)=><option value={item.id} key={item.id}>{item.experimentKey} · {item.status}</option>)}
        </select></label>
        {selected?<ul><li>Flag: {selected.flagKey}</li><li>Métrica: {selected.primaryMetric}</li>
          <li>Amostra mínima: {selected.minimumSample} por variante</li>
          <li>Maturidade: {selected.minimumRuntimeHours} horas</li>
          <li>Lift mínimo: {selected.minimumLiftPercent}%</li>
          <li>Aprovações: {selected.approvals} · rejeições: {selected.rejections}</li></ul>:<p>Nenhum experimento selecionado.</p>}
      </article>

      <article className={styles.section}>
        <p className={styles.eyebrow}>AGENDA LIVEOPS</p><h2>Agendar intervenção</h2>
        {isPlatformAdmin?<form className={styles.form} onSubmit={createEvent}>
          <label>Tipo<select className={styles.select} value={eventType} onChange={(event)=>setEventType(event.target.value)}>
            <option value="experiment-review">Revisão</option><option value="experiment-pause">Pausa</option>
            <option value="communication">Comunicação</option><option value="maintenance">Manutenção</option>
            <option value="incident">Incidente</option><option value="experiment-complete">Conclusão</option>
          </select></label>
          <label>Severidade<select className={styles.select} value={severity} onChange={(event)=>setSeverity(event.target.value)}>
            <option value="info">Informativa</option><option value="success">Sucesso</option>
            <option value="warning">Alerta</option><option value="critical">Crítica</option>
          </select></label>
          <label>Início<input className={styles.input} type="datetime-local" value={startsAt} onChange={(event)=>setStartsAt(event.target.value)}/></label>
          <label>Título<input className={styles.input} value={title} onChange={(event)=>setTitle(event.target.value)} required/></label>
          <label>Descrição<textarea className={styles.textarea} value={description} onChange={(event)=>setDescription(event.target.value)} required/></label>
          <button className={styles.button} disabled={busy}>Agendar evento</button>
        </form>:<p>Alterações exigem administração da plataforma.</p>}
      </article>
    </section>

    <section className={styles.grid}>
      <article className={styles.section}><p className={styles.eyebrow}>RESULTADOS POR VARIANTE</p>
        <div className={styles.list}>{selectedResults.length?selectedResults.map((result)=><div className={styles.item} key={result.id}>
          <div><strong>{result.variant} · {result.recommendation}</strong>
            <span>{result.exposedUsers} expostos · {result.activeUsers} ativos</span>
            <span>Métrica {result.primaryMetricValue.toFixed(4)} · período {result.periodStart} → {result.periodEnd}</span></div>
          <span className={styles.tag}>{dateTime(result.computedAt)}</span>
        </div>):<p>Nenhum resultado calculado.</p>}</div>
      </article>
      <article className={styles.section}><p className={styles.eyebrow}>TIMELINE AUDITÁVEL</p>
        <div className={styles.list}>{timeline.length?timeline.map((entry)=><div className={styles.item} key={entry.id}>
          <div><strong>{entry.kind} · {entry.event}</strong><span>{entry.status ?? "sem status"}</span></div>
          <span className={styles.tag}>{dateTime(entry.occurredAt)}</span>
        </div>):<p>Nenhum evento registrado na timeline.</p>}</div>
      </article>
    </section>

    <section className={styles.section}><p className={styles.eyebrow}>CALENDÁRIO OPERACIONAL</p>
      <div className={styles.list}>{liveOps?.calendar.length?liveOps.calendar.map((event)=><div className={styles.item} key={event.id}>
        <div><strong>{event.title} · {event.severity}</strong>
          <span>{event.eventType} · {event.status} · {dateTime(event.startsAt)}</span>
          <span>{event.experimentKey ?? "operação global"} · {event.description}</span>
          {isPlatformAdmin?<div className={styles.actions}>
            <button className={styles.button} type="button" disabled={busy || event.status!=="scheduled"} onClick={()=>void transition(event,"active")}>Iniciar</button>
            <button className={styles.button} type="button" disabled={busy || event.status!=="active"} onClick={()=>void transition(event,"completed")}>Concluir</button>
            <button className={styles.button} type="button" disabled={busy || !["scheduled","active"].includes(event.status)} onClick={()=>void transition(event,"cancelled")}>Cancelar</button>
          </div>:null}
        </div><span className={styles.tag}>{event.eventKey}</span>
      </div>):<p>Nenhum evento LiveOps registrado.</p>}</div>
    </section>

    <footer className={styles.footer}>Tehkné Solutions</footer>
  </main>;
}
