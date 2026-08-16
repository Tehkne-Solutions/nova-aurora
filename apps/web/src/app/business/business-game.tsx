"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth-provider";
import styles from "./business.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Building = Readonly<{
  id: string;
  plotCode: string;
  companyId: string;
  name: string;
  buildingType: string;
  level: number;
  condition: number;
  capacity: number;
  status: string;
}>;

type Plot = Readonly<{
  id: string;
  code: string;
  locationCode: string;
  locationName: string;
  name: string;
  propertyType: string;
  sizeClass: string;
  baseValueMinor: number;
  constructionCostMinor: number;
  maintenanceMinor: number;
  status: string;
  maxLevel: number;
  ownerCompanyId: string | null;
  ownerCompanyName: string | null;
  building: Building | null;
  recentVisits: number;
}>;

type Offering = Readonly<{
  id: string;
  companyId: string;
  companyName: string;
  ownerId: string;
  unitsTotal: number;
  unitsRemaining: number;
  unitPriceMinor: number;
  status: string;
}>;

type Cycle = Readonly<{
  id: string;
  buildingId: string;
  cycleNumber: number;
  revenueMinor: number;
  operatingCostMinor: number;
  maintenanceMinor: number;
  taxMinor: number;
  netResultMinor: number;
  status: string;
}>;

type BusinessState = Readonly<{
  actor: Readonly<{
    id: string;
    displayName: string;
    balanceMinor: number;
    currentLocationCode: string;
  }>;
  company: Readonly<{
    id: string;
    name: string;
    ownerId: string;
    isOwner: boolean;
    accountBalanceMinor: number;
    totalUnits: number;
    outsideLimitUnits: number;
    ownedUnits: number;
    ownershipPercent: number;
  }>;
  plots: readonly Plot[];
  portfolio: readonly Readonly<{
    companyId: string;
    companyName: string;
    ownerId: string;
    units: number;
    totalUnits: number;
    ownershipPercent: number;
    averageCostMinor: number;
  }>[];
  offerings: readonly Offering[];
  cycles: readonly Cycle[];
  distributionsReceivedMinor: number;
}>;

function money(minor: number): string {
  return `${(minor / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} CA`;
}

function operationKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function api<T>(
  path: string,
  options: Readonly<{
    method?: "GET" | "POST";
    body?: unknown;
    idempotencyKey?: string;
  }> = {}
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.idempotencyKey
        ? { "idempotency-key": options.idempotencyKey }
        : {})
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) })
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "A operação empresarial falhou.");
  }
  return payload;
}

function buildingDefaults(plot: Plot): Readonly<{ type: string; name: string }> {
  if (plot.propertyType === "industrial") return { type: "workshop", name: "Oficina Nova Aurora" };
  if (plot.propertyType === "agricultural") return { type: "mill", name: "Moinho Vale Verde" };
  if (plot.propertyType === "creative") return { type: "studio", name: "Estúdio Aurora" };
  return { type: "bakery", name: "Padaria Aurora" };
}

export function BusinessGame() {
  const { identity } = useAuth();
  const [state, setState] = useState<BusinessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Carregando empresas de Nova Aurora...");

  const refresh = useCallback(async () => {
    try {
      const next = await api<BusinessState>("/v1/business/state");
      setState(next);
      setMessage("Dados empresariais sincronizados com sua sessão.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "API indisponível.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async (
    label: string,
    operation: () => Promise<unknown>
  ) => {
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

  const ownedPlots = useMemo(
    () => state?.plots.filter((plot) => plot.ownerCompanyId === state.company.id) ?? [],
    [state]
  );

  if (!state) {
    return <section className={styles.loading}>{message}</section>;
  }

  const move = (locationCode: string) => run(
    "Viajando até o endereço empresarial...",
    () => api("/v1/city/move", {
      method: "POST",
      body: { locationCode },
      idempotencyKey: operationKey("business-move")
    })
  );

  return (
    <div aria-label="Economia empresarial autenticada de Nova Aurora" className={styles.workspace} data-authenticated="true">
      <section className={styles.commandPanel}>
        <div className={styles.metrics}>
          <article>
            <span>Jogador autenticado</span>
            <strong>{identity?.displayName ?? state.actor.displayName}</strong>
          </article>
          <article>
            <span>Carteira pessoal</span>
            <strong>{money(state.actor.balanceMinor)}</strong>
          </article>
          <article>
            <span>Caixa da empresa</span>
            <strong>{money(state.company.accountBalanceMinor)}</strong>
          </article>
          <article>
            <span>Empresa</span>
            <strong>{state.company.name}</strong>
          </article>
          <article>
            <span>Participação principal</span>
            <strong>{state.company.ownershipPercent.toLocaleString("pt-BR")}%</strong>
          </article>
        </div>

        <p className={styles.status} aria-live="polite">{message}</p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>MAPA DE OPORTUNIDADES</span>
            <h2>Terrenos e estabelecimentos</h2>
          </div>
          <strong>{ownedPlots.length} propriedades</strong>
        </div>

        <div className={styles.plotGrid}>
          {state.plots.map((plot) => {
            const atLocation = state.actor.currentLocationCode === plot.locationCode;
            const ownedByActor = plot.ownerCompanyId === state.company.id;
            const defaults = buildingDefaults(plot);
            return (
              <article className={styles.plotCard} key={plot.code}>
                <div className={styles.plotVisual} data-type={plot.propertyType}>
                  <span>{plot.propertyType.slice(0, 1).toUpperCase()}</span>
                  {plot.building && <b>Nível {plot.building.level}</b>}
                </div>
                <div className={styles.plotHeader}>
                  <div>
                    <small>{plot.locationName}</small>
                    <h3>{plot.name}</h3>
                  </div>
                  <span className={styles.badge}>{plot.sizeClass}</span>
                </div>
                <dl>
                  <div><dt>Aquisição</dt><dd>{money(plot.baseValueMinor)}</dd></div>
                  <div><dt>Construção</dt><dd>{money(plot.constructionCostMinor)}</dd></div>
                  <div><dt>Visitas recentes</dt><dd>{plot.recentVisits}</dd></div>
                </dl>
                {plot.building && (
                  <div className={styles.buildingInfo}>
                    <strong>{plot.building.name}</strong>
                    <span>Condição {plot.building.condition}% · capacidade {plot.building.capacity}</span>
                  </div>
                )}
                <div className={styles.actions}>
                  {!atLocation && (
                    <button disabled={busy} onClick={() => void move(plot.locationCode)}>Viajar</button>
                  )}
                  {atLocation && plot.status === "available" && (
                    <button
                      disabled={busy}
                      onClick={() => void run(
                        "Adquirindo concessão do terreno...",
                        () => api(`/v1/properties/${plot.code}/acquire`, {
                          method: "POST",
                          idempotencyKey: operationKey("acquire-plot")
                        })
                      )}
                    >
                      Adquirir terreno
                    </button>
                  )}
                  {atLocation && ownedByActor && !plot.building && (
                    <button
                      disabled={busy}
                      onClick={() => void run(
                        "Construindo estabelecimento...",
                        () => api(`/v1/properties/${plot.code}/buildings`, {
                          method: "POST",
                          body: { buildingType: defaults.type, name: defaults.name },
                          idempotencyKey: operationKey("construct-building")
                        })
                      )}
                    >
                      Construir {defaults.name}
                    </button>
                  )}
                  {atLocation && plot.building && (
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void run(
                        "Registrando visita ao estabelecimento...",
                        () => api(`/v1/properties/${plot.code}/visit`, {
                          method: "POST",
                          idempotencyKey: operationKey("property-visit")
                        })
                      )}
                    >
                      Visitar
                    </button>
                  )}
                  {ownedByActor && plot.building && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => void run(
                          "Executando ciclo operacional...",
                          () => api(`/v1/business/buildings/${plot.building?.id}/operate`, {
                            method: "POST",
                            idempotencyKey: operationKey("operate-business")
                          })
                        )}
                      >
                        Operar negócio
                      </button>
                      <button
                        className={styles.secondary}
                        disabled={busy || plot.building.level >= plot.maxLevel}
                        onClick={() => void run(
                          "Expandindo o estabelecimento...",
                          () => api(`/v1/business/buildings/${plot.building?.id}/upgrade`, {
                            method: "POST",
                            idempotencyKey: operationKey("upgrade-building")
                          })
                        )}
                      >
                        Melhorar estrutura
                      </button>
                    </>
                  )}
                </div>
                {plot.ownerCompanyName && <p className={styles.owner}>Operado por {plot.ownerCompanyName}</p>}
              </article>
            );
          })}
        </div>
      </section>

      <div className={styles.columns}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>MICROPARTICIPAÇÕES SIMULADAS</span>
              <h2>Capital e investidores</h2>
            </div>
          </div>
          <p className={styles.notice}>
            Estas unidades são internas, não conversíveis e não representam valores mobiliários,
            promessa de renda ou token blockchain.
          </p>
          {state.company.isOwner && (
            <button
              disabled={busy}
              onClick={() => void run(
                "Publicando 300 unidades virtuais...",
                () => api("/v1/business/share-offerings", {
                  method: "POST",
                  body: { units: 300, unitPriceMinor: 20 },
                  idempotencyKey: operationKey("share-offering")
                })
              )}
            >
              Ofertar 3% por {money(6000)}
            </button>
          )}
          <div className={styles.list}>
            {state.offerings.map((offering) => (
              <article key={offering.id}>
                <div>
                  <strong>{offering.companyName}</strong>
                  <span>{offering.unitsRemaining} unidades · {money(offering.unitPriceMinor)} cada</span>
                </div>
                {offering.ownerId !== state.actor.id && (
                  <button
                    disabled={busy || offering.unitsRemaining < 100}
                    onClick={() => void run(
                      "Liquidando participação virtual...",
                      () => api(`/v1/business/share-offerings/${offering.id}/invest`, {
                        method: "POST",
                        body: { units: 100 },
                        idempotencyKey: operationKey("investment")
                      })
                    )}
                  >
                    Investir em 1%
                  </button>
                )}
              </article>
            ))}
            {state.offerings.length === 0 && <p>Nenhuma oferta aberta.</p>}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>PORTFÓLIO INTERNO</span>
              <h2>Posições do jogador</h2>
            </div>
          </div>
          <div className={styles.list}>
            {state.portfolio.map((position) => (
              <article key={position.companyId}>
                <div>
                  <strong>{position.companyName}</strong>
                  <span>{position.units} unidades · {position.ownershipPercent.toLocaleString("pt-BR")}%</span>
                </div>
              </article>
            ))}
            {state.portfolio.length === 0 && <p>Nenhuma posição de investimento.</p>}
          </div>
          <div className={styles.distributionTotal}>
            <span>Resultados recebidos</span>
            <strong>{money(state.distributionsReceivedMinor)}</strong>
          </div>
        </section>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>OPERAÇÃO</span>
            <h2>Ciclos financeiros da empresa</h2>
          </div>
        </div>
        <div className={styles.cycleGrid}>
          {state.cycles.map((cycle) => (
            <article key={cycle.id}>
              <span>Ciclo {cycle.cycleNumber}</span>
              <strong className={cycle.netResultMinor >= 0 ? styles.positive : styles.negative}>
                {money(cycle.netResultMinor)}
              </strong>
              <small>
                Receita {money(cycle.revenueMinor)} · custos{" "}
                {money(cycle.operatingCostMinor + cycle.maintenanceMinor + cycle.taxMinor)}
              </small>
              {cycle.status === "settled" && cycle.netResultMinor > 0 && (
                <button
                  disabled={busy}
                  onClick={() => void run(
                    "Distribuindo parte do resultado...",
                    () => api(`/v1/business/cycles/${cycle.id}/distribute`, {
                      method: "POST",
                      idempotencyKey: operationKey("distribution")
                    })
                  )}
                >
                  Distribuir 40% do resultado
                </button>
              )}
            </article>
          ))}
          {state.cycles.length === 0 && <p>Execute o primeiro ciclo operacional.</p>}
        </div>
      </section>
    </div>
  );
}

// Tehkné Solutions
