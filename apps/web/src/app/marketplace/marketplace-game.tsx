"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./marketplace.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ALICE = "alice@nova-aurora.local";
const BOB = "bob@nova-aurora.local";

type ActorMode = "alice" | "bob";

type CatalogEntry = Readonly<{
  id: string;
  buildingId: string;
  title: string;
  description: string;
  category: string;
  unitPriceMinor: number;
  capacityPerCycle: number;
}>;

type Company = Readonly<{
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  buildingId: string | null;
  buildingName: string | null;
  buildingType: string | null;
  level: number;
  condition: number;
  locationName: string | null;
  districtName: string | null;
  reputationScore: number;
  reviewCount: number;
  activeEmployees: number;
  recentVisitors: number;
  recentCustomers: number;
  recentRevenueMinor: number;
  latestNetResultMinor: number;
  riskScore: number;
  riskLabel: "baixo" | "médio" | "alto";
  catalog: readonly CatalogEntry[];
}>;

type Job = Readonly<{
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  description: string;
  wageMinor: number;
  slots: number;
  filledSlots: number;
  status: string;
}>;

type ShareListing = Readonly<{
  id: string;
  companyId: string;
  companyName: string;
  sellerId: string;
  sellerName: string;
  unitsRemaining: number;
  unitPriceMinor: number;
}>;

type MarketplaceState = Readonly<{
  actor: Readonly<{
    id: string;
    displayName: string;
    balanceMinor: number;
    currentLocationCode: string;
  }>;
  companies: readonly Company[];
  jobs: readonly Job[];
  employments: readonly Readonly<{
    id: string;
    companyId: string;
    companyName: string;
    roleCode: string;
    wageMinor: number;
    status: string;
  }>[];
  shareListings: readonly ShareListing[];
  positions: readonly Readonly<{
    companyId: string;
    companyName: string;
    units: number;
    ownershipPercent: number;
    averageCostMinor: number;
  }>[];
}>;

function aurora(minor: number): string {
  return `${(minor / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} CA`;
}

function key(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function request<T>(
  path: string,
  actor: ActorMode,
  options: Readonly<{ method?: "GET" | "POST"; body?: unknown; idempotencyKey?: string }> = {}
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-actor-email": actor === "alice" ? ALICE : BOB,
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {})
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "A operação não pôde ser concluída.");
  return payload;
}

export function MarketplaceGame() {
  const [actor, setActor] = useState<ActorMode>("alice");
  const [state, setState] = useState<MarketplaceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Sincronizando mercado público...");

  const refresh = useCallback(async () => {
    try {
      setState(await request<MarketplaceState>("/v1/marketplace/state", actor));
      setMessage("Mercado público sincronizado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "API indisponível.");
    }
  }, [actor]);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (label: string, operation: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(label);
    try {
      await operation();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha na operação.");
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const ownedCompany = useMemo(
    () => state?.companies.find((company) => company.ownerId === state.actor.id) ?? null,
    [state]
  );
  const openJob = state?.jobs.find((job) => job.status === "open") ?? null;
  const openShare = state?.shareListings.find((listing) => listing.sellerId !== state.actor.id) ?? null;

  if (!state) return <section className={styles.loading}>{message}</section>;

  return (
    <section className={styles.workspace}>
      <div className={styles.controlbar}>
        <div>
          <span>Operador</span>
          <strong>{state.actor.displayName}</strong>
        </div>
        <div>
          <span>Carteira</span>
          <strong>{aurora(state.actor.balanceMinor)}</strong>
        </div>
        <div className={styles.actorSwitch}>
          <button disabled={busy || actor === "alice"} onClick={() => setActor("alice")}>Alice</button>
          <button disabled={busy || actor === "bob"} onClick={() => setActor("bob")}>Bob</button>
        </div>
      </div>

      <p aria-live="polite" className={styles.message}>{message}</p>

      <section className={styles.companyGrid}>
        {state.companies.map((company) => (
          <article className={styles.companyCard} key={company.id}>
            <header>
              <div>
                <span className={styles.kicker}>{company.districtName ?? "Sem endereço"}</span>
                <h2>{company.name}</h2>
                <p>{company.buildingName ?? "Empresa sem estabelecimento construído"}</p>
              </div>
              <span className={`${styles.risk} ${styles[`risk-${company.riskLabel}`]}`}>
                Risco {company.riskLabel}
              </span>
            </header>

            <div className={styles.metrics}>
              <div><span>Reputação</span><strong>{company.reputationScore}/100</strong></div>
              <div><span>Clientes</span><strong>{company.recentCustomers}</strong></div>
              <div><span>Receita 7d</span><strong>{aurora(company.recentRevenueMinor)}</strong></div>
              <div><span>Equipe</span><strong>{company.activeEmployees}</strong></div>
            </div>

            <div className={styles.catalog}>
              {company.catalog.length === 0 ? (
                <p>Nenhuma oferta pública configurada.</p>
              ) : company.catalog.map((entry) => (
                <div key={entry.id}>
                  <div><strong>{entry.title}</strong><span>{entry.category}</span></div>
                  <p>{entry.description}</p>
                  <b>{aurora(entry.unitPriceMinor)}</b>
                </div>
              ))}
            </div>

            {company.ownerId === state.actor.id && company.buildingId ? (
              <div className={styles.actions}>
                {company.catalog.length === 0 && (
                  <button disabled={busy} onClick={() => void run(
                    "Configurando vitrine pública...",
                    () => request(`/v1/marketplace/buildings/${company.buildingId}/catalog`, actor, {
                      method: "POST",
                      idempotencyKey: key("catalog"),
                      body: {
                        code: "signature-offer",
                        title: "Oferta assinatura da casa",
                        description: "Produto principal preparado para consumidores do distrito.",
                        category: company.buildingType === "bakery" ? "food" : "services",
                        unitPriceMinor: company.buildingType === "bakery" ? 2200 : 4800,
                        capacityPerCycle: 20
                      }
                    })
                  )}>Criar vitrine</button>
                )}
                {company.catalog.length > 0 && (
                  <button disabled={busy} onClick={() => void run(
                    "Processando demanda regional...",
                    () => request(`/v1/marketplace/buildings/${company.buildingId}/demand-cycle`, actor, {
                      method: "POST",
                      idempotencyKey: key("demand")
                    })
                  )}>Atender clientes NPC</button>
                )}
                <button disabled={busy} onClick={() => void run(
                  "Publicando vaga...",
                  () => request(`/v1/marketplace/companies/${company.id}/jobs`, actor, {
                    method: "POST",
                    idempotencyKey: key("job"),
                    body: {
                      buildingId: company.buildingId,
                      roleCode: "attendant",
                      title: "Atendente de estabelecimento",
                      description: "Atendimento, organização e relacionamento com clientes.",
                      wageMinor: 1800,
                      slots: 1
                    }
                  })
                )}>Abrir vaga</button>
                {company.activeEmployees > 0 && (
                  <button disabled={busy} onClick={() => void run(
                    "Liquidando folha salarial...",
                    () => request(`/v1/marketplace/companies/${company.id}/payroll`, actor, {
                      method: "POST",
                      idempotencyKey: key("payroll")
                    })
                  )}>Pagar equipe</button>
                )}
                <button disabled={busy} onClick={() => void run(
                  "Publicando participação no mercado interno...",
                  () => request("/v1/marketplace/shares/listings", actor, {
                    method: "POST",
                    idempotencyKey: key("shares"),
                    body: { companyId: company.id, units: 100, unitPriceMinor: 30 }
                  })
                )}>Listar 100 unidades</button>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className={styles.marketPanels}>
        <article>
          <h2>Empregos públicos</h2>
          {state.jobs.length === 0 ? <p>Nenhuma vaga aberta.</p> : state.jobs.map((job) => (
            <div className={styles.row} key={job.id}>
              <div><strong>{job.title}</strong><span>{job.companyName} · {aurora(job.wageMinor)}</span></div>
              {job.status === "open" && job.companyId !== ownedCompany?.id && (
                <button disabled={busy} onClick={() => void run(
                  "Aceitando vínculo profissional...",
                  () => request(`/v1/marketplace/jobs/${job.id}/accept`, actor, {
                    method: "POST",
                    idempotencyKey: key("accept-job")
                  })
                )}>Aceitar</button>
              )}
            </div>
          ))}
          {state.employments.map((employment) => (
            <p className={styles.employment} key={employment.id}>
              Empregado em <strong>{employment.companyName}</strong> como {employment.roleCode}.
            </p>
          ))}
        </article>

        <article>
          <h2>Participações internas</h2>
          {state.shareListings.length === 0 ? <p>Nenhuma oferta secundária aberta.</p> : state.shareListings.map((listing) => (
            <div className={styles.row} key={listing.id}>
              <div>
                <strong>{listing.companyName}</strong>
                <span>{listing.unitsRemaining} unidades · {aurora(listing.unitPriceMinor)} cada</span>
              </div>
              {listing.sellerId !== state.actor.id && (
                <button disabled={busy} onClick={() => void run(
                  "Comprando participação interna...",
                  () => request(`/v1/marketplace/shares/listings/${listing.id}/buy`, actor, {
                    method: "POST",
                    idempotencyKey: key("buy-share"),
                    body: { units: Math.min(10, listing.unitsRemaining) }
                  })
                )}>Comprar 10</button>
              )}
            </div>
          ))}
          {state.positions.map((position) => (
            <p className={styles.position} key={position.companyId}>
              {position.companyName}: <strong>{position.units} unidades</strong> ({position.ownershipPercent}%).
            </p>
          ))}
        </article>
      </section>

      {!openJob && !openShare && <p className={styles.hint}>Use Alice para publicar operações e Bob para aceitar vagas ou comprar participações.</p>}
    </section>
  );
}
