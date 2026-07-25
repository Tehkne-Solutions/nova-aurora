import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";

export type MunicipalServiceView = Readonly<{
  districtName: string;
  districtCode: string;
  serviceCode: string;
  monthlyCostMinor: number;
  conditionScore: number;
  capacityScore: number;
  status: string;
}>;

export type MunicipalBudgetCycleView = Readonly<{
  id: string;
  code: string;
  status: string;
  startsAt: string;
  endsAt: string;
  taxRevenueMinor: number;
  licenseRevenueMinor: number;
  serviceCostMinor: number;
  emergencyCostMinor: number;
  closingTreasuryMinor: number | null;
}>;

export type CivicElectionView = Readonly<{
  id: string;
  code: string;
  title: string;
  office: string;
  seats: number;
  status: string;
  registrationDeadline: string;
  votingOpensAt: string;
  votingClosesAt: string;
  ownCandidateId: string | null;
  ownBallotCandidateId: string | null;
}>;

export type CivicCandidateView = Readonly<{
  id: string;
  electionId: string;
  displayName: string;
  slogan: string;
  platform: string;
  reputation: number;
  status: string;
  votes: number;
}>;

export type CivicMandateView = Readonly<{
  id: string;
  displayName: string;
  office: string;
  status: string;
  startsAt: string;
  endsAt: string;
  ownMandate: boolean;
}>;

export type PublicPolicyView = Readonly<{
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
  votingEndsAt: string;
}>;

export type CityEmergencyView = Readonly<{
  id: string;
  code: string;
  districtName: string;
  eventType: string;
  severity: number;
  title: string;
  description: string;
  status: string;
  responseCostMinor: number;
  startedAt: string;
  resolvedAt: string | null;
}>;

export type CityApprovalView = Readonly<{
  approvalScore: number;
  transparencyScore: number;
  serviceScore: number;
  fiscalScore: number;
  createdAt: string;
}>;

export type MunicipalOperationsState = Readonly<{
  actor: Readonly<{
    id: string;
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
  budgetCycle: MunicipalBudgetCycleView | null;
  services: readonly MunicipalServiceView[];
  election: CivicElectionView | null;
  candidates: readonly CivicCandidateView[];
  mandates: readonly CivicMandateView[];
  policies: readonly PublicPolicyView[];
  emergencies: readonly CityEmergencyView[];
  approval: CityApprovalView | null;
}>;

type PolicyArea =
  | "energy"
  | "transport"
  | "safety"
  | "education"
  | "environment"
  | "housing"
  | "fiscal";

type EmergencyType =
  | "energy-failure"
  | "transport-collapse"
  | "security-incident"
  | "flood"
  | "heat-wave";

const SERVICE_ACCOUNTS = [
  "city.treasury",
  "city.public-investment",
  "city.service-operations",
  "city.emergency-reserve"
] as const;

export class MunicipalOperationsService extends EconomyRepositoryBase {
  async state(ownerId: string): Promise<MunicipalOperationsState> {
    const [actorRows, accountRows, cycleRows, serviceRows, electionRows,
      candidateRows, mandateRows, policyRows, emergencyRows, approvalRows] =
      await Promise.all([
        this.sql`
          SELECT user_account.id,user_account.display_name,
            COALESCE(reputation.score,50)::int civic_reputation,
            EXISTS (
              SELECT 1 FROM civic_mandates mandate
              WHERE mandate.user_id=user_account.id AND mandate.status='active'
                AND mandate.ends_at>now()
            ) active_mandate
          FROM users user_account
          LEFT JOIN civic_reputation reputation ON reputation.user_id=user_account.id
          WHERE user_account.id=${ownerId}::uuid
        `,
        this.sql`
          SELECT account.code,COALESCE(balance.available_minor,0)::bigint available_minor
          FROM ledger_accounts account
          LEFT JOIN ledger_account_balances balance ON balance.account_id=account.id
          WHERE account.code IN ${this.sql(SERVICE_ACCOUNTS)}
        `,
        this.sql`
          SELECT id,code,status,starts_at,ends_at,tax_revenue_minor,
            license_revenue_minor,service_cost_minor,emergency_cost_minor,
            closing_treasury_minor
          FROM municipal_budget_cycles
          ORDER BY starts_at DESC LIMIT 1
        `,
        this.sql`
          SELECT district.name district_name,district.code district_code,
            operation.service_code,operation.monthly_cost_minor,
            operation.condition_score,operation.capacity_score,operation.status
          FROM municipal_service_operations operation
          JOIN city_districts district ON district.id=operation.district_id
          ORDER BY district.sort_order,operation.service_code
        `,
        this.sql`
          SELECT election.id,election.code,election.title,election.office,election.seats,
            election.status,election.registration_deadline,election.voting_opens_at,
            election.voting_closes_at,
            candidate.id own_candidate_id,ballot.candidate_id own_ballot_candidate_id
          FROM civic_elections election
          LEFT JOIN civic_candidates candidate
            ON candidate.election_id=election.id AND candidate.user_id=${ownerId}::uuid
          LEFT JOIN civic_ballots ballot
            ON ballot.election_id=election.id AND ballot.voter_id=${ownerId}::uuid
          ORDER BY election.created_at DESC LIMIT 1
        `,
        this.sql`
          SELECT candidate.id,candidate.election_id,user_account.display_name,
            candidate.slogan,candidate.platform,candidate.reputation_at_registration,
            candidate.status,candidate.votes
          FROM civic_candidates candidate
          JOIN users user_account ON user_account.id=candidate.user_id
          WHERE candidate.election_id=(
            SELECT id FROM civic_elections ORDER BY created_at DESC LIMIT 1
          )
          ORDER BY candidate.votes DESC,candidate.reputation_at_registration DESC,
            candidate.registered_at
        `,
        this.sql`
          SELECT mandate.id,user_account.display_name,mandate.office,mandate.status,
            mandate.starts_at,mandate.ends_at,mandate.user_id=${ownerId}::uuid own_mandate
          FROM civic_mandates mandate
          JOIN users user_account ON user_account.id=mandate.user_id
          ORDER BY mandate.created_at DESC
        `,
        this.sql`
          SELECT proposal.id,proposal.title,proposal.description,proposal.policy_area,
            district.name district_name,proposal.budget_impact_minor,proposal.status,
            proposal.votes_for,proposal.votes_against,creator.display_name created_by_name,
            own_vote.choice own_vote,proposal.voting_ends_at
          FROM public_policy_proposals proposal
          JOIN users creator ON creator.id=proposal.created_by
          LEFT JOIN city_districts district ON district.id=proposal.district_id
          LEFT JOIN public_policy_votes own_vote
            ON own_vote.proposal_id=proposal.id
            AND own_vote.council_member_id=${ownerId}::uuid
          ORDER BY proposal.created_at DESC
        `,
        this.sql`
          SELECT emergency.id,emergency.code,district.name district_name,
            emergency.event_type,emergency.severity,emergency.title,
            emergency.description,emergency.status,emergency.response_cost_minor,
            emergency.started_at,emergency.resolved_at
          FROM city_emergencies emergency
          JOIN city_districts district ON district.id=emergency.district_id
          ORDER BY emergency.started_at DESC
        `,
        this.sql`
          SELECT approval_score,transparency_score,service_score,fiscal_score,created_at
          FROM city_approval_snapshots ORDER BY created_at DESC LIMIT 1
        `
      ]);

    const actor = actorRows[0];
    if (!actor) throw new Error("Cidadão não encontrado.");
    const balances = new Map(
      accountRows.map((row) => [String(row.code), Number(row.available_minor)])
    );
    const cycle = cycleRows[0];
    const election = electionRows[0];
    const approval = approvalRows[0];

    return {
      actor: {
        id: String(actor.id),
        displayName: String(actor.display_name),
        civicReputation: Number(actor.civic_reputation),
        activeMandate: Boolean(actor.active_mandate)
      },
      treasury: {
        operatingMinor: balances.get("city.treasury") ?? 0,
        publicInvestmentMinor: balances.get("city.public-investment") ?? 0,
        serviceOperationsMinor: balances.get("city.service-operations") ?? 0,
        emergencyReserveMinor: balances.get("city.emergency-reserve") ?? 0
      },
      budgetCycle: cycle ? {
        id: String(cycle.id),
        code: String(cycle.code),
        status: String(cycle.status),
        startsAt: new Date(String(cycle.starts_at)).toISOString(),
        endsAt: new Date(String(cycle.ends_at)).toISOString(),
        taxRevenueMinor: Number(cycle.tax_revenue_minor),
        licenseRevenueMinor: Number(cycle.license_revenue_minor),
        serviceCostMinor: Number(cycle.service_cost_minor),
        emergencyCostMinor: Number(cycle.emergency_cost_minor),
        closingTreasuryMinor: cycle.closing_treasury_minor === null
          ? null
          : Number(cycle.closing_treasury_minor)
      } : null,
      services: serviceRows.map((row) => ({
        districtName: String(row.district_name),
        districtCode: String(row.district_code),
        serviceCode: String(row.service_code),
        monthlyCostMinor: Number(row.monthly_cost_minor),
        conditionScore: Number(row.condition_score),
        capacityScore: Number(row.capacity_score),
        status: String(row.status)
      })),
      election: election ? {
        id: String(election.id),
        code: String(election.code),
        title: String(election.title),
        office: String(election.office),
        seats: Number(election.seats),
        status: String(election.status),
        registrationDeadline: new Date(String(election.registration_deadline)).toISOString(),
        votingOpensAt: new Date(String(election.voting_opens_at)).toISOString(),
        votingClosesAt: new Date(String(election.voting_closes_at)).toISOString(),
        ownCandidateId: election.own_candidate_id
          ? String(election.own_candidate_id)
          : null,
        ownBallotCandidateId: election.own_ballot_candidate_id
          ? String(election.own_ballot_candidate_id)
          : null
      } : null,
      candidates: candidateRows.map((row) => ({
        id: String(row.id),
        electionId: String(row.election_id),
        displayName: String(row.display_name),
        slogan: String(row.slogan),
        platform: String(row.platform),
        reputation: Number(row.reputation_at_registration),
        status: String(row.status),
        votes: Number(row.votes)
      })),
      mandates: mandateRows.map((row) => ({
        id: String(row.id),
        displayName: String(row.display_name),
        office: String(row.office),
        status: String(row.status),
        startsAt: new Date(String(row.starts_at)).toISOString(),
        endsAt: new Date(String(row.ends_at)).toISOString(),
        ownMandate: Boolean(row.own_mandate)
      })),
      policies: policyRows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        description: String(row.description),
        policyArea: String(row.policy_area),
        districtName: row.district_name ? String(row.district_name) : null,
        budgetImpactMinor: Number(row.budget_impact_minor),
        status: String(row.status),
        votesFor: Number(row.votes_for),
        votesAgainst: Number(row.votes_against),
        createdByName: String(row.created_by_name),
        ownVote: row.own_vote === "support" || row.own_vote === "oppose"
          ? row.own_vote
          : null,
        votingEndsAt: new Date(String(row.voting_ends_at)).toISOString()
      })),
      emergencies: emergencyRows.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        districtName: String(row.district_name),
        eventType: String(row.event_type),
        severity: Number(row.severity),
        title: String(row.title),
        description: String(row.description),
        status: String(row.status),
        responseCostMinor: Number(row.response_cost_minor),
        startedAt: new Date(String(row.started_at)).toISOString(),
        resolvedAt: row.resolved_at
          ? new Date(String(row.resolved_at)).toISOString()
          : null
      })),
      approval: approval ? {
        approvalScore: Number(approval.approval_score),
        transparencyScore: Number(approval.transparency_score),
        serviceScore: Number(approval.service_score),
        fiscalScore: Number(approval.fiscal_score),
        createdAt: new Date(String(approval.created_at)).toISOString()
      } : null
    };
  }

  async settleMunicipalCycle(input: {
    ownerId: string;
    idempotencyKey: string;
  }): Promise<MunicipalOperationsState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertMunicipalAuthority(tx, input.ownerId);
      const cycles = await tx`
        SELECT * FROM municipal_budget_cycles
        WHERE status='open' ORDER BY starts_at LIMIT 1 FOR UPDATE
      `;
      const cycle = cycles[0];
      if (!cycle) throw new Error("Não existe ciclo orçamentário aberto.");

      const baseRows = await tx`
        SELECT
          COALESCE((
            SELECT SUM((quantity_minor*unit_price_minor)/100)
            FROM market_trades WHERE settled_at>=${String(cycle.starts_at)}::timestamptz
          ),0)::bigint
          + COALESCE((
            SELECT SUM(revenue_minor) FROM company_operating_cycles
            WHERE created_at>=${String(cycle.starts_at)}::timestamptz
          ),0)::bigint tax_base_minor,
          COALESCE((
            SELECT SUM(fee_minor) FROM business_licenses
            WHERE issued_at>=${String(cycle.starts_at)}::timestamptz
          ),0)::bigint license_revenue_minor
      `;
      const taxBaseMinor = Number(baseRows[0]?.tax_base_minor ?? 0);
      const licenseRevenueMinor = Number(baseRows[0]?.license_revenue_minor ?? 0);
      const taxRevenueMinor = Math.max(1000, Math.floor(taxBaseMinor * 0.015));

      const serviceRows = await tx`
        SELECT operation.*,district.expansion_status
        FROM municipal_service_operations operation
        JOIN city_districts district ON district.id=operation.district_id
        WHERE district.expansion_status='active'
        ORDER BY operation.district_id,operation.service_code FOR UPDATE
      `;
      const serviceCostMinor = serviceRows.reduce(
        (sum, row) => sum + Number(row.monthly_cost_minor),
        0
      );

      const treasury = await this.accountByCode(tx, "city.treasury");
      const serviceAccount = await this.accountByCode(tx, "city.service-operations");
      const issuance = await this.accountByCode(tx, "system.issuance");
      await this.assertBalance(tx, serviceAccount.id, serviceCostMinor);
      const transactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:ledger`,
        type: "municipal-budget-cycle-settlement",
        entries: [
          { accountId: issuance.id, amount: -taxRevenueMinor, memo: "Liquidação tributária da economia sistêmica" },
          { accountId: treasury.id, amount: taxRevenueMinor, memo: "Receita tributária municipal" },
          { accountId: serviceAccount.id, amount: -serviceCostMinor, memo: "Custeio mensal dos serviços urbanos" },
          { accountId: issuance.id, amount: serviceCostMinor, memo: "Consumo operacional dos serviços urbanos" }
        ]
      });

      for (const row of serviceRows) {
        const before = Number(row.condition_score);
        const degradation = Number(row.degradation_rate);
        const maintenanceBoost = before < 50 ? 5 : 3;
        const after = Math.max(0, Math.min(100, before - degradation + maintenanceBoost));
        const capacityAfter = Math.max(
          0,
          Math.min(100, Number(row.capacity_score) + (after >= 60 ? 1 : -2))
        );
        const status = after >= 65
          ? "operational"
          : after >= 45
            ? "strained"
            : after >= 20
              ? "critical"
              : "offline";
        const resultId = randomUUID();
        await tx`
          UPDATE municipal_service_operations SET
            condition_score=${after},capacity_score=${capacityAfter},status=${status},
            last_maintained_at=now(),updated_at=now()
          WHERE district_id=${String(row.district_id)}::uuid
            AND service_code=${String(row.service_code)}
        `;
        await tx`
          INSERT INTO municipal_service_cycle_results (
            id,budget_cycle_id,district_id,service_code,cost_minor,
            condition_before,condition_after,capacity_after,status
          ) VALUES (
            ${resultId}::uuid,${String(cycle.id)}::uuid,${String(row.district_id)}::uuid,
            ${String(row.service_code)},${Number(row.monthly_cost_minor)},${before},
            ${after},${capacityAfter},${status}
          )
        `;
        await this.updateUrbanMetric(
          tx,
          String(row.district_id),
          String(row.service_code),
          Math.round((after + capacityAfter) / 2)
        );
      }

      const closingRows = await tx`
        SELECT COALESCE(available_minor,0)::bigint available_minor
        FROM ledger_account_balances WHERE account_id=${treasury.id}::uuid
      `;
      const closingTreasuryMinor = Number(closingRows[0]?.available_minor ?? 0);
      await tx`
        UPDATE municipal_budget_cycles SET
          status='closed',tax_revenue_minor=${taxRevenueMinor},
          license_revenue_minor=${licenseRevenueMinor},service_cost_minor=${serviceCostMinor},
          closing_treasury_minor=${closingTreasuryMinor},settled_by=${input.ownerId}::uuid,
          ledger_transaction_id=${transactionId}::uuid,closed_at=now()
        WHERE id=${String(cycle.id)}::uuid
      `;

      const approval = await this.captureApproval(tx, String(cycle.id));
      const nextId = randomUUID();
      await tx`
        INSERT INTO municipal_budget_cycles (
          id,code,status,starts_at,ends_at,opening_treasury_minor
        ) VALUES (
          ${nextId}::uuid,${`cycle-${nextId.slice(0,8)}`},'open',now(),
          now()+interval '30 days',${closingTreasuryMinor}
        )
      `;
      await this.outbox(tx, String(cycle.id), "municipal.budget-cycle.closed", {
        taxRevenueMinor,
        licenseRevenueMinor,
        serviceCostMinor,
        approvalScore: approval.approvalScore
      });
      return { closedCycleId: String(cycle.id), nextCycleId: nextId };
    });
    return this.state(input.ownerId);
  }

  async registerCandidate(input: {
    ownerId: string;
    electionId: string;
    slogan: string;
    platform: string;
    idempotencyKey: string;
  }): Promise<MunicipalOperationsState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const elections = await tx`
        SELECT id,status,registration_deadline FROM civic_elections
        WHERE id=${input.electionId}::uuid FOR UPDATE
      `;
      const election = elections[0];
      if (!election || String(election.status) !== "registration") {
        throw new Error("A eleição não está recebendo candidaturas.");
      }
      const reputationRows = await tx`
        SELECT COALESCE(score,50)::int score FROM civic_reputation
        WHERE user_id=${input.ownerId}::uuid
      `;
      const reputation = Number(reputationRows[0]?.score ?? 50);
      if (reputation < 45) {
        throw new Error("Reputação cívica insuficiente para candidatura.");
      }
      const candidateId = randomUUID();
      await tx`
        INSERT INTO civic_candidates (
          id,election_id,user_id,slogan,platform,reputation_at_registration,
          status,idempotency_key
        ) VALUES (
          ${candidateId}::uuid,${input.electionId}::uuid,${input.ownerId}::uuid,
          ${input.slogan},${input.platform},${reputation},'active',${input.idempotencyKey}
        )
      `;
      await this.bumpCivic(tx, input.ownerId, 2);
      await this.outbox(tx, candidateId, "municipal.election.candidate-registered", {
        electionId: input.electionId,
        ownerId: input.ownerId
      });
      return { candidateId };
    });
    return this.state(input.ownerId);
  }

  async openElection(input: {
    ownerId: string;
    electionId: string;
    idempotencyKey: string;
  }): Promise<MunicipalOperationsState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertMunicipalAuthority(tx, input.ownerId);
      const elections = await tx`
        SELECT id,status,seats FROM civic_elections
        WHERE id=${input.electionId}::uuid FOR UPDATE
      `;
      const election = elections[0];
      if (!election || String(election.status) !== "registration") {
        throw new Error("Eleição não está em fase de registro.");
      }
      const countRows = await tx`
        SELECT COUNT(*)::int candidate_count FROM civic_candidates
        WHERE election_id=${input.electionId}::uuid AND status='active'
      `;
      if (Number(countRows[0]?.candidate_count ?? 0) < 1) {
        throw new Error("A eleição precisa de pelo menos uma candidatura.");
      }
      await tx`
        UPDATE civic_elections SET status='voting',voting_opens_at=now(),
          voting_closes_at=now()+interval '7 days'
        WHERE id=${input.electionId}::uuid
      `;
      await this.outbox(tx, input.electionId, "municipal.election.voting-opened", {});
      return { opened: true };
    });
    return this.state(input.ownerId);
  }

  async castElectionVote(input: {
    ownerId: string;
    electionId: string;
    candidateId: string;
    idempotencyKey: string;
  }): Promise<MunicipalOperationsState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const elections = await tx`
        SELECT id,status FROM civic_elections
        WHERE id=${input.electionId}::uuid FOR UPDATE
      `;
      if (!elections[0] || String(elections[0].status) !== "voting") {
        throw new Error("A eleição não está aberta para votação.");
      }
      const candidates = await tx`
        SELECT id FROM civic_candidates
        WHERE id=${input.candidateId}::uuid AND election_id=${input.electionId}::uuid
          AND status='active'
      `;
      if (!candidates[0]) throw new Error("Candidatura inválida.");
      await tx`
        INSERT INTO civic_ballots (
          election_id,voter_id,candidate_id,idempotency_key
        ) VALUES (
          ${input.electionId}::uuid,${input.ownerId}::uuid,
          ${input.candidateId}::uuid,${input.idempotencyKey}
        )
      `;
      await this.refreshCandidateVotes(tx, input.electionId);
      await this.bumpCivic(tx, input.ownerId, 1);
      await this.outbox(tx, input.electionId, "municipal.election.vote-cast", {
        voterId: input.ownerId
      });
      return { voted: true };
    });
    return this.state(input.ownerId);
  }

  async certifyElection(input: {
    ownerId: string;
    electionId: string;
    idempotencyKey: string;
  }): Promise<MunicipalOperationsState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertMunicipalAuthority(tx, input.ownerId);
      const elections = await tx`
        SELECT id,status,seats,office FROM civic_elections
        WHERE id=${input.electionId}::uuid FOR UPDATE
      `;
      const election = elections[0];
      if (!election || String(election.status) !== "voting") {
        throw new Error("Eleição não está pronta para certificação.");
      }
      await this.refreshCandidateVotes(tx, input.electionId);
      const winners = await tx`
        SELECT id,user_id FROM civic_candidates
        WHERE election_id=${input.electionId}::uuid AND status='active'
        ORDER BY votes DESC,reputation_at_registration DESC,registered_at
        LIMIT ${Number(election.seats)}
        FOR UPDATE
      `;
      if (!winners[0]) throw new Error("Nenhum candidato elegível.");
      await tx`
        UPDATE civic_mandates SET status='completed'
        WHERE status='active' AND ends_at>now()
      `;
      await tx`
        UPDATE civic_candidates SET status='not-elected'
        WHERE election_id=${input.electionId}::uuid AND status='active'
      `;
      for (const winner of winners) {
        const mandateId = randomUUID();
        await tx`
          UPDATE civic_candidates SET status='elected'
          WHERE id=${String(winner.id)}::uuid
        `;
        await tx`
          INSERT INTO civic_mandates (
            id,election_id,user_id,office,starts_at,ends_at,status
          ) VALUES (
            ${mandateId}::uuid,${input.electionId}::uuid,${String(winner.user_id)}::uuid,
            ${String(election.office)},now(),now()+interval '30 days','active'
          )
        `;
        await this.bumpCivic(tx, String(winner.user_id), 5);
      }
      await tx`
        UPDATE civic_elections SET status='certified',certified_at=now()
        WHERE id=${input.electionId}::uuid
      `;
      await this.outbox(tx, input.electionId, "municipal.election.certified", {
        winners: winners.map((winner) => String(winner.user_id))
      });
      return { certified: true };
    });
    return this.state(input.ownerId);
  }

  async createPolicy(input: {
    ownerId: string;
    districtCode?: string;
    title: string;
    description: string;
    policyArea: PolicyArea;
    budgetImpactMinor: number;
    idempotencyKey: string;
  }): Promise<MunicipalOperationsState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertCouncilMember(tx, input.ownerId);
      let districtId: string | null = null;
      if (input.districtCode) {
        const districts = await tx`
          SELECT id FROM city_districts WHERE code=${input.districtCode}
        `;
        if (!districts[0]) throw new Error("Distrito não encontrado.");
        districtId = String(districts[0].id);
      }
      const policyId = randomUUID();
      await tx`
        INSERT INTO public_policy_proposals (
          id,created_by,district_id,title,description,policy_area,
          budget_impact_minor,status,idempotency_key,voting_ends_at
        ) VALUES (
          ${policyId}::uuid,${input.ownerId}::uuid,${districtId}::uuid,
          ${input.title},${input.description},${input.policyArea},
          ${input.budgetImpactMinor},'debate',${input.idempotencyKey},now()+interval '7 days'
        )
      `;
      await this.outbox(tx, policyId, "municipal.policy.created", {
        policyArea: input.policyArea,
        budgetImpactMinor: input.budgetImpactMinor
      });
      return { policyId };
    });
    return this.state(input.ownerId);
  }

  async votePolicy(input: {
    ownerId: string;
    policyId: string;
    choice: "support" | "oppose";
    idempotencyKey: string;
  }): Promise<MunicipalOperationsState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertCouncilMember(tx, input.ownerId);
      const policies = await tx`
        SELECT id,status FROM public_policy_proposals
        WHERE id=${input.policyId}::uuid FOR UPDATE
      `;
      if (!policies[0] || String(policies[0].status) !== "debate") {
        throw new Error("Política não está em debate.");
      }
      await tx`
        INSERT INTO public_policy_votes (
          proposal_id,council_member_id,choice,idempotency_key
        ) VALUES (
          ${input.policyId}::uuid,${input.ownerId}::uuid,${input.choice},${input.idempotencyKey}
        )
        ON CONFLICT (proposal_id,council_member_id) DO UPDATE SET
          choice=EXCLUDED.choice,idempotency_key=EXCLUDED.idempotency_key,voted_at=now()
      `;
      await tx`
        UPDATE public_policy_proposals SET
          votes_for=COALESCE((
            SELECT COUNT(*) FROM public_policy_votes
            WHERE proposal_id=${input.policyId}::uuid AND choice='support'
          ),0),
          votes_against=COALESCE((
            SELECT COUNT(*) FROM public_policy_votes
            WHERE proposal_id=${input.policyId}::uuid AND choice='oppose'
          ),0)
        WHERE id=${input.policyId}::uuid
      `;
      await this.outbox(tx, input.policyId, "municipal.policy.voted", {
        ownerId: input.ownerId,
        choice: input.choice
      });
      return { voted: true };
    });
    return this.state(input.ownerId);
  }

  async enactPolicy(input: {
    ownerId: string;
    policyId: string;
    idempotencyKey: string;
  }): Promise<MunicipalOperationsState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertMunicipalAuthority(tx, input.ownerId);
      const policies = await tx`
        SELECT * FROM public_policy_proposals
        WHERE id=${input.policyId}::uuid FOR UPDATE
      `;
      const policy = policies[0];
      if (!policy || String(policy.status) !== "debate") {
        throw new Error("Política não pode ser promulgada.");
      }
      const seats = await tx`
        SELECT COUNT(*)::int seat_count FROM civic_mandates
        WHERE status='active' AND ends_at>now()
      `;
      const requiredVotes = Math.floor(Number(seats[0]?.seat_count ?? 0) / 2) + 1;
      if (Number(policy.votes_for) < requiredVotes
        || Number(policy.votes_for) <= Number(policy.votes_against)) {
        throw new Error("A política ainda não possui maioria no conselho.");
      }

      const budgetImpactMinor = Number(policy.budget_impact_minor);
      let transactionId: string | null = null;
      if (budgetImpactMinor > 0) {
        const publicAccount = await this.accountByCode(tx, "city.public-investment");
        const serviceAccount = await this.accountByCode(tx, "city.service-operations");
        await this.assertBalance(tx, publicAccount.id, budgetImpactMinor);
        transactionId = await this.postLedger(tx, {
          key: `${input.idempotencyKey}:ledger`,
          type: "municipal-policy-funding",
          entries: [
            { accountId: publicAccount.id, amount: -budgetImpactMinor, memo: "Financiamento de política pública" },
            { accountId: serviceAccount.id, amount: budgetImpactMinor, memo: "Recursos para execução da política" }
          ]
        });
      }
      if (policy.district_id && String(policy.policy_area) !== "fiscal") {
        await this.adjustService(
          tx,
          String(policy.district_id),
          String(policy.policy_area),
          5
        );
      }
      await tx`
        UPDATE public_policy_proposals SET status='active',enacted_at=now()
        WHERE id=${input.policyId}::uuid
      `;
      await this.bumpCivic(tx, String(policy.created_by), 4);
      await this.outbox(tx, input.policyId, "municipal.policy.enacted", {
        budgetImpactMinor,
        transactionId
      });
      return { enacted: true };
    });
    return this.state(input.ownerId);
  }

  async triggerEmergency(input: {
    ownerId: string;
    districtCode: string;
    eventType: EmergencyType;
    severity: number;
    idempotencyKey: string;
  }): Promise<MunicipalOperationsState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertMunicipalAuthority(tx, input.ownerId);
      const districts = await tx`
        SELECT id,name FROM city_districts WHERE code=${input.districtCode} FOR UPDATE
      `;
      const district = districts[0];
      if (!district) throw new Error("Distrito não encontrado.");
      const definition = this.emergencyDefinition(input.eventType, input.severity);
      const emergencyId = randomUUID();
      const code = `emergency-${emergencyId.slice(0,8)}`;
      await tx`
        INSERT INTO city_emergencies (
          id,code,district_id,event_type,severity,title,description,status,
          response_cost_minor,service_impacts,triggered_by
        ) VALUES (
          ${emergencyId}::uuid,${code},${String(district.id)}::uuid,
          ${input.eventType},${input.severity},${definition.title},${definition.description},
          'active',${definition.costMinor},${JSON.stringify(definition.impacts)}::jsonb,
          ${input.ownerId}::uuid
        )
      `;
      for (const [service, impact] of Object.entries(definition.impacts)) {
        await this.adjustService(tx, String(district.id), service, -impact);
      }
      await this.outbox(tx, emergencyId, "municipal.emergency.started", {
        districtCode: input.districtCode,
        eventType: input.eventType,
        severity: input.severity
      });
      return { emergencyId };
    });
    return this.state(input.ownerId);
  }

  async respondEmergency(input: {
    ownerId: string;
    emergencyId: string;
    idempotencyKey: string;
  }): Promise<MunicipalOperationsState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertMunicipalAuthority(tx, input.ownerId);
      const emergencies = await tx`
        SELECT * FROM city_emergencies
        WHERE id=${input.emergencyId}::uuid FOR UPDATE
      `;
      const emergency = emergencies[0];
      if (!emergency || String(emergency.status) !== "active") {
        throw new Error("Emergência não está ativa.");
      }
      const reserve = await this.accountByCode(tx, "city.emergency-reserve");
      const issuance = await this.accountByCode(tx, "system.issuance");
      const costMinor = Number(emergency.response_cost_minor);
      await this.assertBalance(tx, reserve.id, costMinor);
      const transactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:ledger`,
        type: "municipal-emergency-response",
        entries: [
          { accountId: reserve.id, amount: -costMinor, memo: "Resposta à emergência urbana" },
          { accountId: issuance.id, amount: costMinor, memo: "Custos sistêmicos da resposta emergencial" }
        ]
      });
      const impacts = this.objectNumberMap(emergency.service_impacts);
      for (const [service, impact] of Object.entries(impacts)) {
        await this.adjustService(
          tx,
          String(emergency.district_id),
          service,
          Math.max(2, impact - 1)
        );
      }
      await tx`
        UPDATE city_emergencies SET status='resolved',resolved_by=${input.ownerId}::uuid,
          ledger_transaction_id=${transactionId}::uuid,resolved_at=now()
        WHERE id=${input.emergencyId}::uuid
      `;
      await tx`
        UPDATE municipal_budget_cycles SET
          emergency_cost_minor=emergency_cost_minor+${costMinor}
        WHERE status='open'
      `;
      await this.bumpCivic(tx, input.ownerId, 3);
      await this.outbox(tx, input.emergencyId, "municipal.emergency.resolved", {
        costMinor,
        resolvedBy: input.ownerId
      });
      return { resolved: true };
    });
    return this.state(input.ownerId);
  }

  private async assertMunicipalAuthority(tx: Tx, ownerId: string): Promise<void> {
    const rows = await tx`
      SELECT
        COALESCE(reputation.score,50)::int score,
        EXISTS (
          SELECT 1 FROM civic_mandates mandate
          WHERE mandate.user_id=${ownerId}::uuid AND mandate.status='active'
            AND mandate.ends_at>now()
        ) active_mandate
      FROM users user_account
      LEFT JOIN civic_reputation reputation ON reputation.user_id=user_account.id
      WHERE user_account.id=${ownerId}::uuid
    `;
    if (!rows[0]) throw new Error("Cidadão não encontrado.");
    if (!Boolean(rows[0].active_mandate) && Number(rows[0].score) < 55) {
      throw new Error("Autoridade municipal insuficiente.");
    }
  }

  private async assertCouncilMember(tx: Tx, ownerId: string): Promise<void> {
    const rows = await tx`
      SELECT id FROM civic_mandates
      WHERE user_id=${ownerId}::uuid AND status='active' AND ends_at>now()
      LIMIT 1
    `;
    if (!rows[0]) throw new Error("Ação restrita a membro ativo do conselho.");
  }

  private async accountByCode(tx: Tx, code: string): Promise<Readonly<{
    id: string;
    availableMinor: number;
  }>> {
    const rows = await tx`
      SELECT account.id,COALESCE(balance.available_minor,0)::bigint available_minor
      FROM ledger_accounts account
      LEFT JOIN ledger_account_balances balance ON balance.account_id=account.id
      WHERE account.code=${code} FOR UPDATE OF account
    `;
    if (!rows[0]) throw new Error(`Conta municipal ausente: ${code}.`);
    return {
      id: String(rows[0].id),
      availableMinor: Number(rows[0].available_minor)
    };
  }

  private async assertBalance(tx: Tx, accountId: string, amountMinor: number): Promise<void> {
    const rows = await tx`
      SELECT COALESCE(available_minor,0)::bigint available_minor
      FROM ledger_account_balances WHERE account_id=${accountId}::uuid
    `;
    if (Number(rows[0]?.available_minor ?? 0) < amountMinor) {
      throw new Error("Fundo municipal insuficiente para a operação.");
    }
  }

  private async bumpCivic(tx: Tx, ownerId: string, delta: number): Promise<void> {
    await tx`
      INSERT INTO civic_reputation (user_id,score)
      VALUES (${ownerId}::uuid,${Math.max(0, Math.min(100, 50 + delta))})
      ON CONFLICT (user_id) DO UPDATE SET
        score=GREATEST(0,LEAST(100,civic_reputation.score+${delta})),updated_at=now()
    `;
  }

  private async refreshCandidateVotes(tx: Tx, electionId: string): Promise<void> {
    await tx`
      UPDATE civic_candidates candidate SET votes=COALESCE((
        SELECT COUNT(*) FROM civic_ballots ballot
        WHERE ballot.candidate_id=candidate.id
      ),0)
      WHERE candidate.election_id=${electionId}::uuid
    `;
  }

  private async captureApproval(tx: Tx, cycleId: string): Promise<Readonly<{
    approvalScore: number;
  }>> {
    const serviceRows = await tx`
      SELECT COALESCE(AVG((condition_score+capacity_score)/2.0),60)::numeric service_score
      FROM municipal_service_operations
    `;
    const treasury = await this.accountByCode(tx, "city.treasury");
    const serviceScore = Math.round(Number(serviceRows[0]?.service_score ?? 60));
    const fiscalScore = treasury.availableMinor >= 100000 ? 85 : treasury.availableMinor >= 30000 ? 70 : 45;
    const transparencyScore = 92;
    const approvalScore = Math.max(
      0,
      Math.min(100, Math.round(serviceScore * 0.5 + fiscalScore * 0.3 + transparencyScore * 0.2))
    );
    const approvalId = randomUUID();
    await tx`
      INSERT INTO city_approval_snapshots (
        id,budget_cycle_id,approval_score,transparency_score,service_score,fiscal_score,
        notes
      ) VALUES (
        ${approvalId}::uuid,${cycleId}::uuid,${approvalScore},${transparencyScore},
        ${serviceScore},${fiscalScore},
        ${JSON.stringify({ methodology: "service-50-fiscal-30-transparency-20" })}::jsonb
      )
    `;
    return { approvalScore };
  }

  private async updateUrbanMetric(
    tx: Tx,
    districtId: string,
    serviceCode: string,
    score: number
  ): Promise<void> {
    const normalized = Math.max(0, Math.min(100, score));
    if (serviceCode === "energy") {
      await tx`UPDATE urban_service_metrics SET energy_score=${normalized},updated_at=now() WHERE district_id=${districtId}::uuid`;
    } else if (serviceCode === "transport") {
      await tx`UPDATE urban_service_metrics SET transport_score=${normalized},updated_at=now() WHERE district_id=${districtId}::uuid`;
    } else if (serviceCode === "safety") {
      await tx`UPDATE urban_service_metrics SET safety_score=${normalized},updated_at=now() WHERE district_id=${districtId}::uuid`;
    } else if (serviceCode === "education") {
      await tx`UPDATE urban_service_metrics SET education_score=${normalized},updated_at=now() WHERE district_id=${districtId}::uuid`;
    } else if (serviceCode === "environment") {
      await tx`UPDATE urban_service_metrics SET environment_score=${normalized},updated_at=now() WHERE district_id=${districtId}::uuid`;
    }
  }

  private async adjustService(
    tx: Tx,
    districtId: string,
    serviceCode: string,
    delta: number
  ): Promise<void> {
    const rows = await tx`
      UPDATE municipal_service_operations SET
        condition_score=GREATEST(0,LEAST(100,condition_score+${delta})),
        capacity_score=GREATEST(0,LEAST(100,capacity_score+${Math.sign(delta)})),
        status=CASE
          WHEN GREATEST(0,LEAST(100,condition_score+${delta}))>=65 THEN 'operational'
          WHEN GREATEST(0,LEAST(100,condition_score+${delta}))>=45 THEN 'strained'
          WHEN GREATEST(0,LEAST(100,condition_score+${delta}))>=20 THEN 'critical'
          ELSE 'offline'
        END,
        updated_at=now()
      WHERE district_id=${districtId}::uuid AND service_code=${serviceCode}
      RETURNING condition_score,capacity_score
    `;
    if (rows[0]) {
      await this.updateUrbanMetric(
        tx,
        districtId,
        serviceCode,
        Math.round((Number(rows[0].condition_score) + Number(rows[0].capacity_score)) / 2)
      );
    }
  }

  private emergencyDefinition(type: EmergencyType, severity: number): Readonly<{
    title: string;
    description: string;
    costMinor: number;
    impacts: Readonly<Record<string, number>>;
  }> {
    const level = Math.max(1, Math.min(5, severity));
    const base = 900 * level;
    if (type === "energy-failure") {
      return {
        title: "Falha na rede de energia",
        description: "Uma interrupção reduziu a capacidade energética do distrito.",
        costMinor: base,
        impacts: { energy: 3 + level * 2 }
      };
    }
    if (type === "transport-collapse") {
      return {
        title: "Colapso de mobilidade",
        description: "Rotas críticas ficaram congestionadas ou indisponíveis.",
        costMinor: base,
        impacts: { transport: 3 + level * 2 }
      };
    }
    if (type === "security-incident") {
      return {
        title: "Incidente de segurança urbana",
        description: "A confiança e a capacidade de resposta do distrito foram afetadas.",
        costMinor: base,
        impacts: { safety: 3 + level * 2 }
      };
    }
    if (type === "flood") {
      return {
        title: "Alagamento urbano",
        description: "Chuvas intensas afetaram vias e infraestrutura ambiental.",
        costMinor: base + 1000,
        impacts: { environment: 2 + level, transport: 2 + level }
      };
    }
    return {
      title: "Onda de calor",
      description: "O consumo de energia e a pressão ambiental aumentaram.",
      costMinor: base,
      impacts: { energy: 2 + level, environment: 2 + level }
    };
  }

  private objectNumberMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const number = Number(raw);
      if (Number.isFinite(number)) result[key] = number;
    }
    return result;
  }
}
