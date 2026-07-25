"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./governance.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ALICE = "alice@nova-aurora.local";
const BOB = "bob@nova-aurora.local";

type ActorMode = "alice" | "bob";

type District = Readonly<{
  id: string;
  code: string;
  name: string;
  expansionStatus: string;
  population: number;
  qualityOfLifeScore: number;
  energyScore: number;
  transportScore: number;
  safetyScore: number;
  educationScore: number;
  environmentScore: number;
}>;

type License = Readonly<{
  id: string;
  districtName: string;
  licenseTypeName: string;
  feeMinor: number;
  status: string;
  expiresAt: string;
}>;

type Contract = Readonly<{
  id: string;
  title: string;
  districtName: string | null;
  category: string;
  budgetMinor: number;
  status: string;
  awardedCompanyName: string | null;
  awardedAmountMinor: number | null;
  bids: number;
  ownBidId: string | null;
}>;

type Proposal = Readonly<{
  id: string;
  districtName: string;
  title: string;
  category: string;
  requestedBudgetMinor: number;
  status: string;
  supportScore: number;
  oppositionScore: number;
  createdByName: string;
  ownVote: "support" | "oppose" | null;
}>;

type GovernanceState = Readonly<{
  actor: Readonly<{
    displayName: string;
    walletBalanceMinor: number;
    civicReputation: number;
    proposalsSubmitted: number;
    votesCast: number;
    contractsCompleted: number;
  }>;
  company: Readonly<{
    id: string;
    name: string;
    accountBalanceMinor: number;
  }>;
  treasury: Readonly<{
    operatingBalanceMinor: number;
    publicInvestmentBalanceMinor: number;
  }>;
  districts: readonly District[];
  licenseTypes: readonly Readonly<{
    code: string;
    name: string;
    feeMinor: number;
  }>[];
  licenses: readonly License[];
  contracts: readonly Contract[];
  proposals: readonly Proposal[];
  civicRanking: readonly Readonly<{
    displayName: string;
    score: number;
    contractsCompleted: number;
  }>[];
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

function scoreTone(score: number): string {
  if (score >= 75) return styles.good ?? "";
  if (score >= 55) return styles.stable ?? "";
  return styles.warning ?? "";
}

export function GovernanceGame() {
  const [mode, setMode] = useState<ActorMode>("alice");
  const [state, setState] = useState<GovernanceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Carregando governo de Nova Aurora…");

  const actorEmail = mode === "alice" ? ALICE : BOB;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/governance/state`, {
        cache: "no-store",
        headers: { "x-actor-email": actorEmail }
      });
      if (!response.ok) throw new Error(await response.text());
      setState(await response.json() as GovernanceState);
      setMessage("Governança sincronizada com o PostgreSQL e o ledger.");
    } catch {
      setState(null);
      setMessage("API indisponível. Inicie banco, migrations e serviços.");
    }
  }, [actorEmail]);

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
          "x-actor-email": actorEmail,
          "idempotency-key": key(actionKey)
        },
        body: JSON.stringify(body)
      });
      const payload = await response.json() as GovernanceState | { message?: string };
      if (!response.ok) {
        throw new Error("message" in payload ? payload.message : "Ação recusada.");
      }
      setState(payload as GovernanceState);
      setMessage("Decisão registrada no ledger e na governança cívica.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setBusy(false);
    }
  }, [actorEmail]);

  const plannedDistrict = useMemo(
    () => state?.districts.find((district) => district.expansionStatus !== "active"),
    [state]
  );
  const openProposal = state?.proposals.find((proposal) => proposal.status === "open");
  const fundableProposal = state?.proposals.find(
    (proposal) => proposal.status === "open" && proposal.supportScore > proposal.oppositionScore
  );
  const openContract = state?.contracts.find((contract) => contract.status === "open");
  const contractWithBids = state?.contracts.find(
    (contract) => contract.status === "open" && contract.bids > 0
  );
  const awardedContract = state?.contracts.find(
    (contract) => contract.status === "awarded"
      && contract.awardedCompanyName === state.company.name
  );

  if (!state) {
    return (
      <section className={styles.empty}>
        <strong>{message}</strong>
        <button type="button" onClick={() => void load()}>Tentar novamente</button>
      </section>
    );
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.toolbar}>
        <div>
          <span>Cidadão</span>
          <strong>{state.actor.displayName}</strong>
        </div>
        <div className={styles.switcher}>
          <button
            type="button"
            aria-pressed={mode === "alice"}
            onClick={() => setMode("alice")}
          >Alice</button>
          <button
            type="button"
            aria-pressed={mode === "bob"}
            onClick={() => setMode("bob")}
          >Bob</button>
        </div>
        <div>
          <span>Empresa</span>
          <strong>{state.company.name}</strong>
        </div>
      </section>

      <p className={styles.message} role="status">{message}</p>

      <section className={styles.metrics}>
        <article>
          <span>Tesouro operacional</span>
          <strong>{aurora(state.treasury.operatingBalanceMinor)}</strong>
        </article>
        <article>
          <span>Fundo de investimento</span>
          <strong>{aurora(state.treasury.publicInvestmentBalanceMinor)}</strong>
        </article>
        <article>
          <span>Reputação cívica</span>
          <strong>{state.actor.civicReputation}/100</strong>
        </article>
        <article>
          <span>Caixa empresarial</span>
          <strong>{aurora(state.company.accountBalanceMinor)}</strong>
        </article>
      </section>

      <section className={styles.actionBar}>
        <button
          type="button"
          disabled={busy || state.licenses.some((license) => license.status === "active")}
          onClick={() => void action(
            "/v1/governance/licenses",
            { districtCode: "central", licenseTypeCode: "local-commerce" },
            "governance-license"
          )}
        >Solicitar licença comercial</button>
        <button
          type="button"
          disabled={busy || !plannedDistrict}
          onClick={() => plannedDistrict && void action(
            "/v1/governance/proposals",
            {
              districtCode: plannedDistrict.code,
              title: `Ativação de ${plannedDistrict.name}`,
              description: "Financiar infraestrutura, serviços urbanos e abertura comunitária do distrito.",
              category: "expansion",
              requestedBudgetMinor: 15000
            },
            "governance-proposal"
          )}
        >Propor expansão distrital</button>
        <button
          type="button"
          disabled={busy || !openProposal || openProposal.ownVote === "support"}
          onClick={() => openProposal && void action(
            `/v1/governance/proposals/${openProposal.id}/vote`,
            { choice: "support" },
            "governance-vote"
          )}
        >Apoiar proposta</button>
        <button
          type="button"
          disabled={busy || !fundableProposal}
          onClick={() => fundableProposal && void action(
            `/v1/governance/proposals/${fundableProposal.id}/fund`,
            {},
            "governance-fund"
          )}
        >Financiar proposta aprovada</button>
        <button
          type="button"
          disabled={busy || !openContract || Boolean(openContract.ownBidId)}
          onClick={() => openContract && void action(
            `/v1/governance/contracts/${openContract.id}/bids`,
            {
              amountMinor: Math.max(1000, openContract.budgetMinor - 5000),
              deliveryDays: 14,
              proposal: "Execução técnica com equipe local, transparência e indicadores públicos."
            },
            "governance-bid"
          )}
        >Enviar proposta à licitação</button>
        <button
          type="button"
          disabled={busy || !contractWithBids}
          onClick={() => contractWithBids && void action(
            `/v1/governance/contracts/${contractWithBids.id}/award`,
            {},
            "governance-award"
          )}
        >Adjudicar melhor proposta</button>
        <button
          type="button"
          disabled={busy || !awardedContract}
          onClick={() => awardedContract && void action(
            `/v1/governance/contracts/${awardedContract.id}/complete`,
            {},
            "governance-complete"
          )}
        >Concluir contrato vencedor</button>
      </section>

      <section className={styles.districtGrid}>
        {state.districts.map((district) => (
          <article className={styles.districtCard} key={district.id}>
            <header>
              <div>
                <span className={styles.label}>{district.expansionStatus}</span>
                <h2>{district.name}</h2>
              </div>
              <strong className={scoreTone(district.qualityOfLifeScore)}>
                {district.qualityOfLifeScore}
              </strong>
            </header>
            <p>{district.population.toLocaleString("pt-BR")} habitantes</p>
            <dl>
              <div><dt>Energia</dt><dd>{district.energyScore}</dd></div>
              <div><dt>Transporte</dt><dd>{district.transportScore}</dd></div>
              <div><dt>Segurança</dt><dd>{district.safetyScore}</dd></div>
              <div><dt>Educação</dt><dd>{district.educationScore}</dd></div>
              <div><dt>Ambiente</dt><dd>{district.environmentScore}</dd></div>
            </dl>
          </article>
        ))}
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header><div><span className={styles.label}>ORÇAMENTO PARTICIPATIVO</span><h2>Propostas</h2></div></header>
          {state.proposals.length === 0 ? <p>Nenhuma proposta apresentada.</p> : state.proposals.map((proposal) => (
            <div className={styles.listItem} key={proposal.id}>
              <div>
                <strong>{proposal.title}</strong>
                <span>{proposal.districtName} · {proposal.category}</span>
              </div>
              <div className={styles.values}>
                <span>{aurora(proposal.requestedBudgetMinor)}</span>
                <b>{proposal.supportScore} × {proposal.oppositionScore}</b>
              </div>
            </div>
          ))}
        </article>

        <article className={styles.panel}>
          <header><div><span className={styles.label}>LICITAÇÕES</span><h2>Contratos públicos</h2></div></header>
          {state.contracts.map((contract) => (
            <div className={styles.listItem} key={contract.id}>
              <div>
                <strong>{contract.title}</strong>
                <span>{contract.districtName ?? "Toda a cidade"} · {contract.status}</span>
              </div>
              <div className={styles.values}>
                <span>{aurora(contract.awardedAmountMinor ?? contract.budgetMinor)}</span>
                <b>{contract.bids} propostas</b>
              </div>
            </div>
          ))}
        </article>

        <article className={styles.panel}>
          <header><div><span className={styles.label}>LICENCIAMENTO</span><h2>Licenças da empresa</h2></div></header>
          {state.licenses.length === 0 ? <p>Nenhuma licença ativa.</p> : state.licenses.map((license) => (
            <div className={styles.listItem} key={license.id}>
              <div>
                <strong>{license.licenseTypeName}</strong>
                <span>{license.districtName} · {license.status}</span>
              </div>
              <span>{aurora(license.feeMinor)}</span>
            </div>
          ))}
        </article>

        <article className={styles.panel}>
          <header><div><span className={styles.label}>REPUTAÇÃO CÍVICA</span><h2>Lideranças</h2></div></header>
          <ol className={styles.ranking}>
            {state.civicRanking.map((citizen, index) => (
              <li key={`${citizen.displayName}-${index}`}>
                <span>{index + 1}. {citizen.displayName}</span>
                <strong>{citizen.score}</strong>
              </li>
            ))}
          </ol>
        </article>
      </section>
    </div>
  );
}
