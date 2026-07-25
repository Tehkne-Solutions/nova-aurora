"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./municipality.module.css";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ALICE = "alice@nova-aurora.local";
const BOB = "bob@nova-aurora.local";

type ActorMode = "alice" | "bob";

type Candidate = Readonly<{
  id: string;
  displayName: string;
  slogan: string;
  platform: string;
  reputation: number;
  status: string;
  votes: number;
}>;

type Policy = Readonly<{
  id: string;
  title: string;
  description: string;
  policyArea: string;
  districtName: string | null;
  budgetImpactMinor: number;
  status: string;
  votesFor: number;
  votesAgainst: number;
  createdByName: string;
  ownVote: "support" | "oppose" | null;
}>;

type Emergency = Readonly<{
  id: string;
  districtName: string;
  eventType: string;
  severity: number;
  title: string;
  status: string;
  responseCostMinor: number;
}>;

type MunicipalState = Readonly<{
  actor: Readonly<{
    displayName: string;
    civicReputation: number;
    activeMandate: boolean;
  }>;
  treasury: Readonly<{
    operatingMinor: number;
    publicInvestmentMinor: number;
    serviceOperationsMinor: number;
    emergencyReserveMinor: number;
  }>;
  budgetCycle: Readonly<{
    id: string;
    code: string;
    status: string;
    startsAt: string;
    endsAt: string;
    taxRevenueMinor: number;
    licenseRevenueMinor: number;
    serviceCostMinor: number;
    emergencyCostMinor: number;
  }> | null;
  services: readonly Readonly<{
    districtName: string;
    districtCode: string;
    serviceCode: string;
    monthlyCostMinor: number;
    conditionScore: number;
    capacityScore: number;
    status: string;
  }>[];
  election: Readonly<{
    id: string;
    title: string;
    seats: number;
    status: string;
    ownCandidateId: string | null;
    ownBallotCandidateId: string | null;
  }> | null;
  candidates: readonly Candidate[];
  mandates: readonly Readonly<{
    id: string;
    displayName: string;
    office: string;
    status: string;
    ownMandate: boolean;
  }>[];
  policies: readonly Policy[];
  emergencies: readonly Emergency[];
  approval: Readonly<{
    approvalScore: number;
    transparencyScore: number;
    serviceScore: number;
    fiscalScore: number;
  }> | null;
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

function serviceLabel(code: string): string {
  const labels: Record<string, string> = {
    energy: "Energia",
    transport: "Transporte",
    safety: "Segurança",
    education: "Educação",
    environment: "Ambiente"
  };
  return labels[code] ?? code;
}

export function MunicipalOperationsGame() {
  const [mode, setMode] = useState<ActorMode>("alice");
  const [state, setState] = useState<MunicipalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Carregando operações municipais…");

  const actorEmail = mode === "alice" ? ALICE : BOB;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/v1/municipal/state`, {
        cache: "no-store",
        headers: { "x-actor-email": actorEmail }
      });
      if (!response.ok) throw new Error(await response.text());
      setState(await response.json() as MunicipalState);
      setMessage("Prefeitura sincronizada com PostgreSQL e ledger.");
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
      const payload = await response.json() as MunicipalState | { message?: string };
      if (!response.ok) {
        throw new Error("message" in payload ? payload.message : "Ação municipal recusada.");
      }
      setState(payload as MunicipalState);
      setMessage("Decisão municipal registrada e auditada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setBusy(false);
    }
  }, [actorEmail]);

  const lowestService = useMemo(() => {
    if (!state?.services.length) return null;
    return [...state.services].sort(
      (left, right) => left.conditionScore - right.conditionScore
    )[0] ?? null;
  }, [state]);

  const activeEmergency = state?.emergencies.find((item) => item.status === "active");
  const debatePolicy = state?.policies.find((item) => item.status === "debate");
  const activePolicy = state?.policies.find((item) => item.status === "active");
  const activeMandates = state?.mandates.filter((item) => item.status === "active") ?? [];

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
          <span>Reputação cívica</span>
          <strong>{state.actor.civicReputation}/100</strong>
        </div>
        <div>
          <span>Mandato ativo</span>
          <strong>{state.actor.activeMandate ? "Sim" : "Não"}</strong>
        </div>
      </section>

      <p className={styles.message} aria-live="polite">{message}</p>

      <section className={styles.metrics}>
        <article>
          <span>Tesouro operacional</span>
          <strong>{aurora(state.treasury.operatingMinor)}</strong>
        </article>
        <article>
          <span>Investimento público</span>
          <strong>{aurora(state.treasury.publicInvestmentMinor)}</strong>
        </article>
        <article>
          <span>Serviços urbanos</span>
          <strong>{aurora(state.treasury.serviceOperationsMinor)}</strong>
        </article>
        <article>
          <span>Reserva emergencial</span>
          <strong>{aurora(state.treasury.emergencyReserveMinor)}</strong>
        </article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>CICLO ORÇAMENTÁRIO</p>
              <h2>{state.budgetCycle?.code ?? "Sem ciclo aberto"}</h2>
            </div>
            <span className={styles.badge}>{state.budgetCycle?.status ?? "indisponível"}</span>
          </header>
          {state.budgetCycle ? (
            <dl className={styles.dataList}>
              <div><dt>Receita tributária</dt><dd>{aurora(state.budgetCycle.taxRevenueMinor)}</dd></div>
              <div><dt>Receita de licenças</dt><dd>{aurora(state.budgetCycle.licenseRevenueMinor)}</dd></div>
              <div><dt>Custo de serviços</dt><dd>{aurora(state.budgetCycle.serviceCostMinor)}</dd></div>
              <div><dt>Emergências</dt><dd>{aurora(state.budgetCycle.emergencyCostMinor)}</dd></div>
            </dl>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void action(
              "/v1/municipal/budget-cycles/settle",
              {},
              "municipal-cycle"
            )}
          >Fechar ciclo e abrir próximo</button>
        </article>

        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>APROVAÇÃO POPULAR</p>
              <h2>{state.approval?.approvalScore ?? "—"}/100</h2>
            </div>
          </header>
          <dl className={styles.dataList}>
            <div><dt>Transparência</dt><dd>{state.approval?.transparencyScore ?? "—"}</dd></div>
            <div><dt>Serviços</dt><dd>{state.approval?.serviceScore ?? "—"}</dd></div>
            <div><dt>Responsabilidade fiscal</dt><dd>{state.approval?.fiscalScore ?? "—"}</dd></div>
          </dl>
          <p>O índice combina serviço público, saúde fiscal e transparência do ciclo.</p>
        </article>
      </section>

      <section className={styles.panel}>
        <header>
          <div>
            <p className={styles.eyebrow}>SERVIÇOS URBANOS</p>
            <h2>Condição por distrito</h2>
          </div>
          {lowestService ? (
            <span className={styles.badge}>
              Prioridade: {lowestService.districtName} · {serviceLabel(lowestService.serviceCode)}
            </span>
          ) : null}
        </header>
        <div className={styles.serviceGrid}>
          {state.services.map((service) => (
            <article key={`${service.districtCode}-${service.serviceCode}`}>
              <span>{service.districtName}</span>
              <strong>{serviceLabel(service.serviceCode)}</strong>
              <div className={styles.progress}>
                <i style={{ width: `${service.conditionScore}%` }} />
              </div>
              <small>
                Condição {service.conditionScore} · Capacidade {service.capacityScore}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>ELEIÇÃO MUNICIPAL</p>
              <h2>{state.election?.title ?? "Nenhuma eleição"}</h2>
            </div>
            <span className={styles.badge}>{state.election?.status ?? "—"}</span>
          </header>
          <div className={styles.actionRow}>
            {state.election?.status === "registration" && !state.election.ownCandidateId ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(
                  "/v1/municipal/elections/candidates",
                  {
                    electionId: state.election?.id,
                    slogan: mode === "alice"
                      ? "Transparência e serviços confiáveis"
                      : "Bairros fortes e oportunidades",
                    platform: mode === "alice"
                      ? "Orçamento aberto, manutenção urbana e políticas avaliadas por resultados."
                      : "Mobilidade, segurança e expansão equilibrada entre todos os distritos."
                  },
                  "candidacy"
                )}
              >Registrar candidatura</button>
            ) : null}
            {state.election?.status === "registration" ? (
              <button
                type="button"
                disabled={busy || state.candidates.length === 0}
                onClick={() => void action(
                  `/v1/municipal/elections/${state.election?.id}/open`,
                  {},
                  "election-open"
                )}
              >Abrir votação</button>
            ) : null}
            {state.election?.status === "voting" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(
                  `/v1/municipal/elections/${state.election?.id}/certify`,
                  {},
                  "election-certify"
                )}
              >Certificar resultado</button>
            ) : null}
          </div>
          <div className={styles.cards}>
            {state.candidates.map((candidate) => (
              <article key={candidate.id}>
                <strong>{candidate.displayName}</strong>
                <span>{candidate.slogan}</span>
                <small>{candidate.votes} voto(s) · reputação {candidate.reputation}</small>
                {state.election?.status === "voting" ? (
                  <button
                    type="button"
                    disabled={busy || Boolean(state.election.ownBallotCandidateId)}
                    onClick={() => void action(
                      "/v1/municipal/elections/vote",
                      { electionId: state.election?.id, candidateId: candidate.id },
                      "election-vote"
                    )}
                  >Votar</button>
                ) : null}
              </article>
            ))}
          </div>
          {activeMandates.length > 0 ? (
            <p>Conselho ativo: {activeMandates.map((item) => item.displayName).join(" · ")}</p>
          ) : null}
        </article>

        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>EMERGÊNCIAS</p>
              <h2>Centro de resposta urbana</h2>
            </div>
          </header>
          <div className={styles.actionRow}>
            <button
              type="button"
              disabled={busy || Boolean(activeEmergency)}
              onClick={() => void action(
                "/v1/municipal/emergencies",
                { districtCode: "central", eventType: "energy-failure", severity: 2 },
                "emergency-trigger"
              )}
            >Simular falha de energia</button>
            {activeEmergency ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void action(
                  `/v1/municipal/emergencies/${activeEmergency.id}/respond`,
                  {},
                  "emergency-response"
                )}
              >Executar resposta</button>
            ) : null}
          </div>
          <div className={styles.cards}>
            {state.emergencies.slice(0, 4).map((emergency) => (
              <article key={emergency.id}>
                <strong>{emergency.title}</strong>
                <span>{emergency.districtName} · severidade {emergency.severity}</span>
                <small>{emergency.status} · {aurora(emergency.responseCostMinor)}</small>
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <header>
          <div>
            <p className={styles.eyebrow}>CONSELHO MUNICIPAL</p>
            <h2>Políticas públicas</h2>
          </div>
          {activePolicy ? <span className={styles.badge}>Ativa: {activePolicy.title}</span> : null}
        </header>
        <div className={styles.actionRow}>
          <button
            type="button"
            disabled={busy || !state.actor.activeMandate || Boolean(debatePolicy)}
            onClick={() => void action(
              "/v1/municipal/policies",
              {
                districtCode: "central",
                title: "Plano de mobilidade cívica",
                description: "Reforça as rotas do Centro Cívico e publica indicadores de desempenho.",
                policyArea: "transport",
                budgetImpactMinor: 2000
              },
              "policy-create"
            )}
          >Apresentar política</button>
          {debatePolicy ? (
            <button
              type="button"
              disabled={busy || !state.actor.activeMandate || Boolean(debatePolicy.ownVote)}
              onClick={() => void action(
                `/v1/municipal/policies/${debatePolicy.id}/vote`,
                { choice: "support" },
                "policy-vote"
              )}
            >Votar a favor</button>
          ) : null}
          {debatePolicy ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void action(
                `/v1/municipal/policies/${debatePolicy.id}/enact`,
                {},
                "policy-enact"
              )}
            >Promulgar</button>
          ) : null}
        </div>
        <div className={styles.cards}>
          {state.policies.map((policy) => (
            <article key={policy.id}>
              <strong>{policy.title}</strong>
              <span>{policy.policyArea} · {policy.districtName ?? "Toda a cidade"}</span>
              <small>
                {policy.status} · {policy.votesFor} a favor · {policy.votesAgainst} contra · {aurora(policy.budgetImpactMinor)}
              </small>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
