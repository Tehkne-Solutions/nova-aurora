"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./management.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Stock = Readonly<{
  buildingId: string;
  buildingName: string;
  catalogEntryId: string;
  catalogTitle: string;
  category: string;
  quantity: number;
  reorderPoint: number;
  averageUnitCostMinor: number;
}>;

type SupplierOffer = Readonly<{
  id: string;
  supplierCompanyId: string;
  supplierCompanyName: string;
  itemCode: string;
  title: string;
  category: string;
  unitCostMinor: number;
  minimumQuantity: number;
  availableQuantity: number;
  status: string;
}>;

type Contract = Readonly<{
  id: string;
  buyerCompanyName: string;
  supplierCompanyName: string;
  itemCode: string;
  quantity: number;
  grossMinor: number;
  createdAt: string;
}>;

type CampaignChannel = "local" | "social" | "outdoor" | "influencer";

type Campaign = Readonly<{
  id: string;
  buildingId: string;
  buildingName: string;
  name: string;
  channel: CampaignChannel;
  budgetMinor: number;
  visitorBoostPct: number;
  conversions: number;
  attributedRevenueMinor: number;
  status: string;
  endsAt: string;
}>;

type Goal = Readonly<{
  id: string;
  metric: string;
  title: string;
  targetValue: number;
  currentValue: number;
  progressPercent: number;
  status: string;
  deadlineAt: string;
}>;

type TeamMember = Readonly<{
  employmentId: string;
  displayName: string;
  roleCode: string;
  wageMinor: number;
  productivityScore: number;
  satisfactionScore: number;
  trainingLevel: number;
}>;

type DistrictMetric = Readonly<{
  districtId: string;
  districtName: string;
  metricDate: string;
  visitors: number;
  customers: number;
  grossRevenueMinor: number;
  activeEmployees: number;
  averageReputation: number;
}>;

type Alert = Readonly<{
  id: string;
  code: string;
  severity: string;
  message: string;
  status: string;
  createdAt: string;
}>;

type RegionalState = Readonly<{
  actor: Readonly<{
    id: string;
    displayName: string;
    balanceMinor: number;
  }>;
  company: Readonly<{
    id: string;
    name: string;
    accountBalanceMinor: number;
  }>;
  stocks: readonly Stock[];
  supplierOffers: readonly SupplierOffer[];
  contracts: readonly Contract[];
  campaigns: readonly Campaign[];
  goals: readonly Goal[];
  team: readonly TeamMember[];
  districtMetrics: readonly DistrictMetric[];
  alerts: readonly Alert[];
}>;

function aurora(minor: number): string {
  return `${(minor / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} CA`;
}

function key(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function channelLabel(channel: CampaignChannel): string {
  if (channel === "local") return "Mídia local";
  if (channel === "social") return "Mídia social";
  if (channel === "outdoor") return "Mídia urbana";
  return "Criadores e influenciadores";
}

export function RegionalManagementGame() {
  const [state, setState] = useState<RegionalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Carregando gestão regional autenticada…");
  const [campaignChannel, setCampaignChannel] = useState<CampaignChannel>("local");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/management/state`, {
        cache: "no-store"
      });
      const payload = await response.json() as RegionalState | { message?: string };
      if (!response.ok) {
        throw new Error("message" in payload ? payload.message : "Gestão regional indisponível.");
      }
      setState(payload as RegionalState);
      setMessage("Gestão regional sincronizada com sua sessão e o ledger da cidade.");
    } catch (error) {
      setState(null);
      setMessage(error instanceof Error ? error.message : "API de gestão regional indisponível.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const action = useCallback(async (
    endpoint: string,
    body: Readonly<Record<string, unknown>>,
    actionKey: string
  ) => {
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key(actionKey)
        },
        body: JSON.stringify(body)
      });
      const payload = await response.json() as RegionalState | { message?: string };
      if (!response.ok) {
        throw new Error("message" in payload ? payload.message : "Ação recusada.");
      }
      setState(payload as RegionalState);
      setMessage("Operação confirmada no ledger e na gestão regional.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setBusy(false);
    }
  }, []);

  const ownStock = state?.stocks[0];
  const externalOffer = useMemo(
    () => state?.supplierOffers.find(
      (offer) => offer.supplierCompanyId !== state.company.id
    ),
    [state]
  );
  const trainable = state?.team[0];
  const activeAlert = state?.alerts[0];

  if (!state) {
    return (
      <section className={styles.empty}>
        <strong>{message}</strong>
        <button type="button" onClick={() => void load()}>Tentar novamente</button>
      </section>
    );
  }

  return (
    <div
      aria-label="Gestão regional autenticada de Nova Aurora"
      className={styles.workspace}
      data-authenticated="true"
    >
      <section className={styles.toolbar}>
        <div>
          <span>Operador autenticado</span>
          <strong>{state.actor.displayName}</strong>
        </div>
        <div>
          <span>Empresa</span>
          <strong>{state.company.name}</strong>
        </div>
        <div>
          <span>Caixa empresarial</span>
          <strong>{aurora(state.company.accountBalanceMinor)}</strong>
        </div>
        <button type="button" disabled={busy} onClick={() => void load()}>Atualizar</button>
      </section>

      <p className={styles.message} aria-live="polite">{message}</p>

      <section className={styles.metrics}>
        <article>
          <span>Itens em estoque</span>
          <strong>{state.stocks.reduce((sum, stock) => sum + stock.quantity, 0)}</strong>
        </article>
        <article>
          <span>Campanhas ativas</span>
          <strong>{state.campaigns.filter((campaign) => campaign.status === "active").length}</strong>
        </article>
        <article>
          <span>Equipe ativa</span>
          <strong>{state.team.length}</strong>
        </article>
        <article>
          <span>Alertas abertos</span>
          <strong>{state.alerts.length}</strong>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header>
            <div>
              <span className={styles.label}>SUPRIMENTOS</span>
              <h2>Estoque e fornecedores</h2>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void action(
                "/v1/management/supplier-offers",
                {
                  itemCode: "operational-supply",
                  title: "Lote de suprimentos empresariais",
                  category: "food",
                  unitCostMinor: 300,
                  minimumQuantity: 5,
                  availableQuantity: 100
                },
                "supplier-offer"
              )}
            >
              Publicar oferta
            </button>
          </header>

          <div className={styles.cardList}>
            {state.stocks.length === 0 ? (
              <p>Crie um estabelecimento e catálogo em Propriedades e Mercado Público.</p>
            ) : state.stocks.map((stock) => (
              <div className={styles.itemCard} key={stock.catalogEntryId}>
                <div>
                  <strong>{stock.catalogTitle}</strong>
                  <span>{stock.buildingName}</span>
                </div>
                <b className={stock.quantity <= stock.reorderPoint ? styles.warning : ""}>
                  {stock.quantity} un.
                </b>
                <small>Custo médio {aurora(stock.averageUnitCostMinor)}</small>
              </div>
            ))}
          </div>

          {externalOffer && ownStock ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void action(
                `/v1/management/supplier-offers/${externalOffer.id}/accept`,
                {
                  buildingId: ownStock.buildingId,
                  catalogEntryId: ownStock.catalogEntryId,
                  quantity: Math.max(externalOffer.minimumQuantity, 10)
                },
                "supplier-contract"
              )}
            >
              Comprar de {externalOffer.supplierCompanyName}
            </button>
          ) : (
            <small>Ofertas B2B de outras empresas aparecerão aqui quando estiverem disponíveis.</small>
          )}
        </article>

        <article className={styles.panel}>
          <header>
            <div>
              <span className={styles.label}>CRESCIMENTO E MÍDIA</span>
              <h2>Campanhas e metas</h2>
            </div>
          </header>

          <div className={styles.actionRow}>
            <label>
              Canal da campanha
              <select
                disabled={busy}
                value={campaignChannel}
                onChange={(event) => setCampaignChannel(event.target.value as CampaignChannel)}
              >
                <option value="local">Mídia local</option>
                <option value="social">Mídia social</option>
                <option value="outdoor">Mídia urbana</option>
                <option value="influencer">Criadores e influenciadores</option>
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !ownStock}
              onClick={() => ownStock && void action(
                "/v1/management/campaigns",
                {
                  buildingId: ownStock.buildingId,
                  name: `${channelLabel(campaignChannel)} · ${ownStock.buildingName}`,
                  channel: campaignChannel,
                  budgetMinor: 3000,
                  visitorBoostPct: 30,
                  durationDays: 7
                },
                "campaign"
              )}
            >
              Iniciar campanha · 30,00 CA
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void action(
                "/v1/management/goals",
                {
                  metric: "revenue",
                  title: "Faturar 250,00 CA",
                  targetValue: 25000,
                  deadlineAt: new Date(Date.now() + 7 * 86_400_000).toISOString()
                },
                "goal"
              )}
            >
              Criar meta
            </button>
          </div>

          {state.goals.map((goal) => (
            <div className={styles.goal} key={goal.id}>
              <div>
                <strong>{goal.title}</strong>
                <span>{goal.progressPercent}% · {goal.status}</span>
              </div>
              <div className={styles.progress}>
                <i style={{ width: `${goal.progressPercent}%` }} />
              </div>
            </div>
          ))}
          {state.campaigns.slice(0, 5).map((campaign) => (
            <div className={styles.itemCard} key={campaign.id}>
              <div>
                <strong>{campaign.name}</strong>
                <span>{channelLabel(campaign.channel)} · +{campaign.visitorBoostPct}% visitantes</span>
              </div>
              <b>{campaign.conversions} conversões</b>
              <small>{aurora(campaign.attributedRevenueMinor)} atribuídos</small>
            </div>
          ))}
        </article>

        <article className={styles.panel}>
          <header>
            <div>
              <span className={styles.label}>EQUIPE</span>
              <h2>Produtividade e satisfação</h2>
            </div>
            <button
              type="button"
              disabled={busy || !trainable}
              onClick={() => trainable && void action(
                `/v1/management/employees/${trainable.employmentId}/train`,
                { focus: "productivity" },
                "training"
              )}
            >
              Treinar equipe
            </button>
          </header>

          {state.team.length === 0 ? (
            <p>Contrate jogadores pelo Mercado Público para formar a equipe.</p>
          ) : state.team.map((member) => (
            <div className={styles.employee} key={member.employmentId}>
              <div>
                <strong>{member.displayName}</strong>
                <span>{member.roleCode} · nível {member.trainingLevel}</span>
              </div>
              <dl>
                <div><dt>Produtividade</dt><dd>{member.productivityScore}</dd></div>
                <div><dt>Satisfação</dt><dd>{member.satisfactionScore}</dd></div>
              </dl>
            </div>
          ))}
        </article>

        <article className={styles.panel}>
          <header>
            <div>
              <span className={styles.label}>OPERAÇÃO REGIONAL</span>
              <h2>Atender demanda do distrito</h2>
            </div>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || !ownStock || ownStock.quantity <= 0}
              onClick={() => ownStock && void action(
                "/v1/management/regional-cycles",
                {
                  buildingId: ownStock.buildingId,
                  catalogEntryId: ownStock.catalogEntryId
                },
                "regional-cycle"
              )}
            >
              Executar ciclo
            </button>
          </header>

          {state.districtMetrics.slice(0, 4).map((metric) => (
            <div className={styles.district} key={`${metric.districtId}:${metric.metricDate}`}>
              <div>
                <strong>{metric.districtName}</strong>
                <span>{metric.metricDate}</span>
              </div>
              <dl>
                <div><dt>Visitantes</dt><dd>{metric.visitors}</dd></div>
                <div><dt>Clientes</dt><dd>{metric.customers}</dd></div>
                <div><dt>Receita</dt><dd>{aurora(metric.grossRevenueMinor)}</dd></div>
              </dl>
            </div>
          ))}
          {state.districtMetrics.length === 0 && (
            <p>Execute o primeiro ciclo regional para gerar indicadores.</p>
          )}
        </article>
      </section>

      <section className={styles.bottomGrid}>
        <article className={styles.panel}>
          <span className={styles.label}>CONTRATOS B2B</span>
          <h2>Histórico de fornecimento</h2>
          {state.contracts.slice(0, 6).map((contract) => (
            <div className={styles.contract} key={contract.id}>
              <div>
                <strong>{contract.supplierCompanyName}</strong>
                <span>{contract.itemCode} · {contract.quantity} unidades</span>
              </div>
              <b>{aurora(contract.grossMinor)}</b>
            </div>
          ))}
          {state.contracts.length === 0 && <p>Nenhum contrato B2B liquidado.</p>}
        </article>

        <article className={styles.panel}>
          <span className={styles.label}>CENTRAL DE ALERTAS</span>
          <h2>Riscos operacionais</h2>
          {state.alerts.map((alert) => (
            <div className={`${styles.alert} ${styles[alert.severity]}`} key={alert.id}>
              <div>
                <strong>{alert.severity}</strong>
                <span>{alert.message}</span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(
                  `/v1/management/alerts/${alert.id}/acknowledge`,
                  {},
                  "alert"
                )}
              >
                Reconhecer
              </button>
            </div>
          ))}
          {!activeAlert && <p>Nenhum alerta operacional aberto.</p>}
        </article>
      </section>

      <footer>Tehkné Solutions</footer>
    </div>
  );
}

// Tehkné Solutions
