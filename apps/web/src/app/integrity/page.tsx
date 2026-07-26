"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "../account/account.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Control = Readonly<{
  itemId: string;
  itemCode: string;
  itemName: string;
  assetClass: string;
  tokenizationStatus: string;
  externalTransferEnabled: boolean;
  status: string;
  referencePriceMinor: number | null;
  maxDeviationBps: number;
  maxOrderGrossMinor: number;
  maxDailyGrossMinor: number;
  maxOpenOrders: number;
  maxOrdersPerMinute: number;
  tripReason: string | null;
}>;

type FraudEvent = Readonly<{
  id: string;
  eventType: string;
  severity: string;
  status: string;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: string;
}>;

type ChangeRequest = Readonly<{
  id: string;
  itemCode: string;
  changeType: string;
  status: string;
  reason: string;
  proposedBy: string;
  approvedBy: string | null;
  createdAt: string;
}>;

type IntegrityState = Readonly<{
  integrity: Readonly<{
    controls: readonly Control[];
    fraudEvents: readonly FraudEvent[];
    changeRequests: readonly ChangeRequest[];
  }>;
}>;

function aurora(minor: number | null): string {
  if (minor === null) return "Sem referência";
  return `${(minor / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} CA`;
}

export default function IntegrityPage() {
  const [state, setState] = useState<IntegrityState | null>(null);
  const [itemCode, setItemCode] = useState("bread");
  const [changeType, setChangeType] = useState<"pause" | "resume" | "limits" | "reset-reference" | "asset-classification">("pause");
  const [reason, setReason] = useState("Revisão operacional preventiva do mercado.");
  const [maxOrder, setMaxOrder] = useState("5000000");
  const [reference, setReference] = useState("1000");
  const [assetClass, setAssetClass] = useState("internal-consumable");
  const [targetUserId, setTargetUserId] = useState("");
  const [riskStatus, setRiskStatus] = useState<"normal" | "monitored" | "restricted" | "frozen">("monitored");
  const [riskScore, setRiskScore] = useState("300");
  const [message, setMessage] = useState("Carregando controles de integridade…");

  const load = useCallback(async () => {
    const response = await fetch(`${API_URL}/v1/integrity/state`, { cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json() as { message?: string };
      setState(null);
      setMessage(payload.message ?? "Acesso administrativo indisponível.");
      return;
    }
    setState(await response.json() as IntegrityState);
    setMessage("Controles, eventos e propostas sincronizados.");
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function propose() {
    let payload: Record<string, unknown> = {};
    if (changeType === "limits") payload = { maxOrderGrossMinor: Number(maxOrder) };
    if (changeType === "reset-reference") payload = { referencePriceMinor: Number(reference) };
    if (changeType === "asset-classification") {
      payload = {
        assetClass,
        tokenizationStatus: "not-tokenized",
        externalTransferEnabled: false,
        legalClassification: "virtual-game-asset"
      };
    }
    const response = await fetch(`${API_URL}/v1/integrity/changes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemCode, changeType, payload, reason })
    });
    const result = await response.json() as { requestId?: string; message?: string };
    if (!response.ok) return setMessage(result.message ?? "Mudança não pôde ser proposta.");
    setMessage(`Proposta ${result.requestId} criada. Outra pessoa administradora deve aprovar.`);
    await load();
  }

  async function approve(requestId: string) {
    const response = await fetch(`${API_URL}/v1/integrity/changes/${requestId}/approve`, { method: "POST" });
    if (!response.ok) {
      const result = await response.json() as { message?: string };
      return setMessage(result.message ?? "Aprovação recusada.");
    }
    setMessage("Mudança aprovada e aplicada.");
    await load();
  }

  async function resolve(eventId: string, status: "resolved" | "false-positive") {
    const response = await fetch(`${API_URL}/v1/integrity/fraud-events/${eventId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!response.ok) return setMessage("Evento não pôde ser encerrado.");
    setMessage("Evento de integridade revisado.");
    await load();
  }

  async function reviewUser() {
    const response = await fetch(`${API_URL}/v1/integrity/users/${targetUserId}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: riskStatus,
        score: Number(riskScore),
        reason: reason || "Revisão manual do perfil econômico."
      })
    });
    if (!response.ok) {
      const result = await response.json() as { message?: string };
      return setMessage(result.message ?? "Perfil não pôde ser revisado.");
    }
    setMessage("Perfil econômico atualizado e auditado.");
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NOVA AURORA · ECONOMY INTEGRITY</p>
          <h1>Mercado protegido por regras auditáveis.</h1>
          <p>Limites transacionais, circuit breakers, antifraude e governança com dupla aprovação.</p>
        </div>
        <nav>
          <Link href="/game">Cidade</Link>
          <Link href="/dashboard">Economia</Link>
          <Link href="/account">Conta</Link>
        </nav>
      </header>

      <p className={styles.message} aria-live="polite">{message}</p>

      <section className={styles.metrics}>
        <article><span>Ativos controlados</span><strong>{state?.integrity.controls.length ?? 0}</strong></article>
        <article><span>Mercados interrompidos</span><strong>{state?.integrity.controls.filter((item) => item.status !== "open").length ?? 0}</strong></article>
        <article><span>Eventos abertos</span><strong>{state?.integrity.fraudEvents.length ?? 0}</strong></article>
        <article><span>Propostas pendentes</span><strong>{state?.integrity.changeRequests.filter((item) => item.status === "proposed").length ?? 0}</strong></article>
      </section>

      <section className={styles.panel}>
        <h2>Controles por ativo</h2>
        <div className={styles.list}>
          {state?.integrity.controls.map((control) => (
            <div key={control.itemId}>
              <div>
                <strong>{control.itemName} · {control.itemCode}</strong>
                <span>{control.assetClass} · {control.tokenizationStatus}</span>
                <small>Ordem: {aurora(control.maxOrderGrossMinor)} · Dia: {aurora(control.maxDailyGrossMinor)} · Desvio: {(control.maxDeviationBps / 100).toLocaleString("pt-BR")}%</small>
              </div>
              <div>
                <strong>{control.status}</strong>
                <span>{aurora(control.referencePriceMinor)}</span>
                {control.tripReason ? <small>{control.tripReason}</small> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <h2>Propor mudança</h2>
          <div className={styles.list}>
            <label>Ativo<input value={itemCode} onChange={(event) => setItemCode(event.target.value)} /></label>
            <label>Tipo<select value={changeType} onChange={(event) => setChangeType(event.target.value as typeof changeType)}><option value="pause">Pausar mercado</option><option value="resume">Reabrir mercado</option><option value="limits">Alterar limite</option><option value="reset-reference">Redefinir referência</option><option value="asset-classification">Classificar ativo</option></select></label>
            {changeType === "limits" ? <label>Limite por ordem em centavos de CA<input value={maxOrder} onChange={(event) => setMaxOrder(event.target.value)} inputMode="numeric" /></label> : null}
            {changeType === "reset-reference" ? <label>Preço de referência em centavos de CA<input value={reference} onChange={(event) => setReference(event.target.value)} inputMode="numeric" /></label> : null}
            {changeType === "asset-classification" ? <label>Classe<select value={assetClass} onChange={(event) => setAssetClass(event.target.value)}><option value="internal-consumable">Interno consumível</option><option value="internal-equity">Participação interna</option><option value="collectible">Colecionável interno</option><option value="tokenized-collectible">Colecionável tokenizado</option><option value="regulated-instrument">Instrumento regulado</option></select></label> : null}
            <label>Justificativa<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            <button type="button" onClick={() => void propose()}>Criar proposta auditável</button>
          </div>
        </article>

        <article className={styles.panel}>
          <h2>Revisar perfil econômico</h2>
          <div className={styles.list}>
            <label>ID do usuário<input value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} /></label>
            <label>Status<select value={riskStatus} onChange={(event) => setRiskStatus(event.target.value as typeof riskStatus)}><option value="normal">Normal</option><option value="monitored">Monitorado</option><option value="restricted">Restrito</option><option value="frozen">Congelado</option></select></label>
            <label>Pontuação<input value={riskScore} onChange={(event) => setRiskScore(event.target.value)} inputMode="numeric" /></label>
            <button type="button" onClick={() => void reviewUser()}>Aplicar revisão</button>
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <h2>Governança de mudanças</h2>
        <div className={styles.list}>
          {state?.integrity.changeRequests.map((request) => (
            <div key={request.id}>
              <div><strong>{request.changeType} · {request.itemCode}</strong><span>{request.reason}</span><small>Proposta por {request.proposedBy}</small></div>
              <div><strong>{request.status}</strong>{request.status === "proposed" ? <button type="button" onClick={() => void approve(request.id)}>Aprovar como segunda pessoa</button> : <small>{request.approvedBy ?? "Sem aprovação"}</small>}</div>
            </div>
          ))}
          {!state?.integrity.changeRequests.length ? <p>Nenhuma proposta registrada.</p> : null}
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Eventos antifraude</h2>
        <div className={styles.list}>
          {state?.integrity.fraudEvents.map((event) => (
            <div key={event.id}>
              <div><strong>{event.eventType}</strong><span>{event.resourceType ?? "evento"} · {event.resourceId ?? "sem recurso"}</span><small>{new Date(event.createdAt).toLocaleString("pt-BR")}</small></div>
              <div><strong>{event.severity}</strong><div className={styles.actions}><button type="button" onClick={() => void resolve(event.id, "resolved")}>Resolver</button><button type="button" onClick={() => void resolve(event.id, "false-positive")}>Falso positivo</button></div></div>
            </div>
          ))}
          {!state?.integrity.fraudEvents.length ? <p>Nenhum evento aberto.</p> : null}
        </div>
      </section>

      <footer>Tehkné Solutions</footer>
    </main>
  );
}
