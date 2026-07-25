import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";

export type GovernanceDistrictView = Readonly<{
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

export type BusinessLicenseView = Readonly<{
  id: string;
  companyName: string;
  districtName: string;
  licenseTypeCode: string;
  licenseTypeName: string;
  feeMinor: number;
  status: string;
  expiresAt: string;
}>;

export type PublicContractView = Readonly<{
  id: string;
  code: string;
  districtName: string | null;
  title: string;
  description: string;
  category: string;
  budgetMinor: number;
  status: string;
  biddingDeadline: string;
  awardedCompanyName: string | null;
  awardedAmountMinor: number | null;
  bids: number;
  ownBidId: string | null;
}>;

export type BudgetProposalView = Readonly<{
  id: string;
  districtName: string;
  title: string;
  description: string;
  category: string;
  requestedBudgetMinor: number;
  status: string;
  supportScore: number;
  oppositionScore: number;
  createdByName: string;
  ownVote: "support" | "oppose" | null;
  closesAt: string;
}>;

export type CityGovernanceState = Readonly<{
  actor: Readonly<{
    id: string;
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
  districts: readonly GovernanceDistrictView[];
  licenseTypes: readonly Readonly<{
    code: string;
    name: string;
    feeMinor: number;
    durationDays: number;
  }>[];
  licenses: readonly BusinessLicenseView[];
  contracts: readonly PublicContractView[];
  proposals: readonly BudgetProposalView[];
  civicRanking: readonly Readonly<{
    displayName: string;
    score: number;
    contractsCompleted: number;
  }>[];
}>;

type GovernanceCategory =
  | "energy"
  | "transport"
  | "safety"
  | "housing"
  | "education"
  | "environment"
  | "events"
  | "expansion";

export class CityGovernanceService extends EconomyRepositoryBase {
  async state(ownerId: string): Promise<CityGovernanceState> {
    const [actorRows, companyRows, treasuryRows, districtRows, licenseTypeRows,
      licenseRows, contractRows, proposalRows, rankingRows] = await Promise.all([
      this.sql`
        SELECT user_account.id,user_account.display_name,
          COALESCE(balance.available_minor,0)::bigint wallet_balance_minor,
          COALESCE(reputation.score,50) civic_score,
          COALESCE(reputation.proposals_submitted,0) proposals_submitted,
          COALESCE(reputation.votes_cast,0) votes_cast,
          COALESCE(reputation.contracts_completed,0) contracts_completed
        FROM users user_account
        LEFT JOIN ledger_accounts wallet
          ON wallet.owner_id=user_account.id AND wallet.account_type='wallet'
        LEFT JOIN ledger_account_balances balance ON balance.account_id=wallet.id
        LEFT JOIN civic_reputation reputation ON reputation.user_id=user_account.id
        WHERE user_account.id=${ownerId}::uuid
        ORDER BY wallet.created_at LIMIT 1
      `,
      this.sql`
        SELECT company.id,company.name,
          COALESCE(balance.available_minor,0)::bigint account_balance_minor
        FROM companies company
        LEFT JOIN ledger_accounts account
          ON account.owner_id=company.owner_id AND account.account_type='company'
        LEFT JOIN ledger_account_balances balance ON balance.account_id=account.id
        WHERE company.owner_id=${ownerId}::uuid
        ORDER BY company.created_at LIMIT 1
      `,
      this.sql`
        SELECT account.code,COALESCE(balance.available_minor,0)::bigint available_minor
        FROM ledger_accounts account
        LEFT JOIN ledger_account_balances balance ON balance.account_id=account.id
        WHERE account.code IN ('city.treasury','city.public-investment')
      `,
      this.sql`
        SELECT district.id,district.code,district.name,district.expansion_status,
          district.population,district.quality_of_life_score,
          metric.energy_score,metric.transport_score,metric.safety_score,
          metric.education_score,metric.environment_score
        FROM city_districts district
        JOIN urban_service_metrics metric ON metric.district_id=district.id
        ORDER BY district.sort_order
      `,
      this.sql`
        SELECT code,name,fee_minor,duration_days
        FROM business_license_types ORDER BY fee_minor,code
      `,
      this.sql`
        SELECT license.id,company.name company_name,district.name district_name,
          license.license_type_code,type.name license_type_name,license.fee_minor,
          license.status,license.expires_at
        FROM business_licenses license
        JOIN companies company ON company.id=license.company_id
        JOIN city_districts district ON district.id=license.district_id
        JOIN business_license_types type ON type.code=license.license_type_code
        WHERE company.owner_id=${ownerId}::uuid
        ORDER BY license.issued_at DESC
      `,
      this.sql`
        SELECT contract.id,contract.code,district.name district_name,
          contract.title,contract.description,contract.category,contract.budget_minor,
          contract.status,contract.bidding_deadline,awarded.name awarded_company_name,
          contract.awarded_amount_minor,
          COUNT(bid.id)::int bid_count,
          MAX(CASE WHEN bidder.owner_id=${ownerId}::uuid THEN bid.id::text END) own_bid_id
        FROM public_contracts contract
        LEFT JOIN city_districts district ON district.id=contract.district_id
        LEFT JOIN companies awarded ON awarded.id=contract.awarded_company_id
        LEFT JOIN public_contract_bids bid ON bid.contract_id=contract.id
        LEFT JOIN companies bidder ON bidder.id=bid.company_id
        GROUP BY contract.id,district.name,awarded.name
        ORDER BY contract.created_at DESC
      `,
      this.sql`
        SELECT proposal.id,district.name district_name,proposal.title,
          proposal.description,proposal.category,proposal.requested_budget_minor,
          proposal.status,proposal.support_score,proposal.opposition_score,
          creator.display_name created_by_name,proposal.closes_at,
          own_vote.choice own_vote
        FROM participatory_budget_proposals proposal
        JOIN city_districts district ON district.id=proposal.district_id
        JOIN users creator ON creator.id=proposal.created_by
        LEFT JOIN participatory_budget_votes own_vote
          ON own_vote.proposal_id=proposal.id AND own_vote.user_id=${ownerId}::uuid
        ORDER BY proposal.created_at DESC
      `,
      this.sql`
        SELECT user_account.display_name,reputation.score,reputation.contracts_completed
        FROM civic_reputation reputation
        JOIN users user_account ON user_account.id=reputation.user_id
        ORDER BY reputation.score DESC,reputation.contracts_completed DESC,
          user_account.display_name LIMIT 8
      `
    ]);

    const actor = actorRows[0];
    const company = companyRows[0];
    if (!actor) throw new Error("Cidadão não encontrado.");
    if (!company) throw new Error("Empresa do cidadão não encontrada.");

    const treasury = new Map(
      treasuryRows.map((row) => [String(row.code), Number(row.available_minor)])
    );

    return {
      actor: {
        id: String(actor.id),
        displayName: String(actor.display_name),
        walletBalanceMinor: Number(actor.wallet_balance_minor),
        civicReputation: Number(actor.civic_score),
        proposalsSubmitted: Number(actor.proposals_submitted),
        votesCast: Number(actor.votes_cast),
        contractsCompleted: Number(actor.contracts_completed)
      },
      company: {
        id: String(company.id),
        name: String(company.name),
        accountBalanceMinor: Number(company.account_balance_minor)
      },
      treasury: {
        operatingBalanceMinor: treasury.get("city.treasury") ?? 0,
        publicInvestmentBalanceMinor: treasury.get("city.public-investment") ?? 0
      },
      districts: districtRows.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        name: String(row.name),
        expansionStatus: String(row.expansion_status),
        population: Number(row.population),
        qualityOfLifeScore: Number(row.quality_of_life_score),
        energyScore: Number(row.energy_score),
        transportScore: Number(row.transport_score),
        safetyScore: Number(row.safety_score),
        educationScore: Number(row.education_score),
        environmentScore: Number(row.environment_score)
      })),
      licenseTypes: licenseTypeRows.map((row) => ({
        code: String(row.code),
        name: String(row.name),
        feeMinor: Number(row.fee_minor),
        durationDays: Number(row.duration_days)
      })),
      licenses: licenseRows.map((row) => ({
        id: String(row.id),
        companyName: String(row.company_name),
        districtName: String(row.district_name),
        licenseTypeCode: String(row.license_type_code),
        licenseTypeName: String(row.license_type_name),
        feeMinor: Number(row.fee_minor),
        status: String(row.status),
        expiresAt: new Date(String(row.expires_at)).toISOString()
      })),
      contracts: contractRows.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        districtName: row.district_name ? String(row.district_name) : null,
        title: String(row.title),
        description: String(row.description),
        category: String(row.category),
        budgetMinor: Number(row.budget_minor),
        status: String(row.status),
        biddingDeadline: new Date(String(row.bidding_deadline)).toISOString(),
        awardedCompanyName: row.awarded_company_name
          ? String(row.awarded_company_name)
          : null,
        awardedAmountMinor: row.awarded_amount_minor === null
          ? null
          : Number(row.awarded_amount_minor),
        bids: Number(row.bid_count),
        ownBidId: row.own_bid_id ? String(row.own_bid_id) : null
      })),
      proposals: proposalRows.map((row) => ({
        id: String(row.id),
        districtName: String(row.district_name),
        title: String(row.title),
        description: String(row.description),
        category: String(row.category),
        requestedBudgetMinor: Number(row.requested_budget_minor),
        status: String(row.status),
        supportScore: Number(row.support_score),
        oppositionScore: Number(row.opposition_score),
        createdByName: String(row.created_by_name),
        ownVote: row.own_vote === "support" || row.own_vote === "oppose"
          ? row.own_vote
          : null,
        closesAt: new Date(String(row.closes_at)).toISOString()
      })),
      civicRanking: rankingRows.map((row) => ({
        displayName: String(row.display_name),
        score: Number(row.score),
        contractsCompleted: Number(row.contracts_completed)
      }))
    };
  }

  async requestLicense(input: {
    ownerId: string;
    districtCode: string;
    licenseTypeCode: string;
    idempotencyKey: string;
  }): Promise<CityGovernanceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.company(tx, input.ownerId);
      const districts = await tx`
        SELECT id,expansion_status FROM city_districts
        WHERE code=${input.districtCode} FOR UPDATE
      `;
      const district = districts[0];
      if (!district) throw new Error("Distrito não encontrado.");
      if (String(district.expansion_status) !== "active") {
        throw new Error("O distrito ainda não está ativo para licenciamento.");
      }
      const types = await tx`
        SELECT code,fee_minor,duration_days FROM business_license_types
        WHERE code=${input.licenseTypeCode}
      `;
      const type = types[0];
      if (!type) throw new Error("Tipo de licença não encontrado.");
      const existing = await tx`
        SELECT id FROM business_licenses
        WHERE company_id=${company.id}::uuid
          AND district_id=${String(district.id)}::uuid
          AND license_type_code=${input.licenseTypeCode}
          AND status='active' AND expires_at>now()
      `;
      if (existing[0]) throw new Error("A empresa já possui esta licença ativa.");

      const feeMinor = Number(type.fee_minor);
      await this.assertBalance(tx, company.accountId, feeMinor);
      const cityAccountId = await this.cityAccountId(tx);
      const transactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:ledger`,
        type: "business-license-fee",
        entries: [
          { accountId: company.accountId, amount: -feeMinor, memo: "Taxa de licença empresarial" },
          { accountId: cityAccountId, amount: feeMinor, memo: "Receita de licença empresarial" }
        ]
      });
      const licenseId = randomUUID();
      await tx`
        INSERT INTO business_licenses (
          id,company_id,district_id,license_type_code,requested_by,fee_minor,
          status,ledger_transaction_id,idempotency_key,expires_at
        ) VALUES (
          ${licenseId}::uuid,${company.id}::uuid,${String(district.id)}::uuid,
          ${input.licenseTypeCode},${input.ownerId}::uuid,${feeMinor},'active',
          ${transactionId}::uuid,${input.idempotencyKey},
          now()+(${Number(type.duration_days)}::text||' days')::interval
        )
      `;
      await this.bumpCivicReputation(tx, input.ownerId, 1);
      await this.outbox(tx, licenseId, "governance.business-license.issued", {
        companyId: company.id,
        districtCode: input.districtCode,
        licenseTypeCode: input.licenseTypeCode,
        feeMinor
      });
      return { licenseId };
    });
    return this.state(input.ownerId);
  }

  async createProposal(input: {
    ownerId: string;
    districtCode: string;
    title: string;
    description: string;
    category: GovernanceCategory;
    requestedBudgetMinor: number;
    idempotencyKey: string;
  }): Promise<CityGovernanceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const districts = await tx`SELECT id FROM city_districts WHERE code=${input.districtCode}`;
      const district = districts[0];
      if (!district) throw new Error("Distrito não encontrado.");
      const proposalId = randomUUID();
      await tx`
        INSERT INTO participatory_budget_proposals (
          id,district_id,created_by,title,description,category,
          requested_budget_minor,status,idempotency_key,closes_at
        ) VALUES (
          ${proposalId}::uuid,${String(district.id)}::uuid,${input.ownerId}::uuid,
          ${input.title},${input.description},${input.category},
          ${input.requestedBudgetMinor},'open',${input.idempotencyKey},now()+interval '7 days'
        )
      `;
      await tx`
        INSERT INTO civic_reputation (user_id,score,proposals_submitted)
        VALUES (${input.ownerId}::uuid,52,1)
        ON CONFLICT (user_id) DO UPDATE SET
          score=LEAST(100,civic_reputation.score+2),
          proposals_submitted=civic_reputation.proposals_submitted+1,
          updated_at=now()
      `;
      await this.outbox(tx, proposalId, "governance.budget-proposal.created", {
        ownerId: input.ownerId,
        districtCode: input.districtCode,
        category: input.category,
        requestedBudgetMinor: input.requestedBudgetMinor
      });
      return { proposalId };
    });
    return this.state(input.ownerId);
  }

  async voteProposal(input: {
    ownerId: string;
    proposalId: string;
    choice: "support" | "oppose";
    idempotencyKey: string;
  }): Promise<CityGovernanceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const proposals = await tx`
        SELECT id,status,closes_at FROM participatory_budget_proposals
        WHERE id=${input.proposalId}::uuid FOR UPDATE
      `;
      const proposal = proposals[0];
      if (!proposal || String(proposal.status) !== "open") {
        throw new Error("Proposta não está aberta para votação.");
      }
      if (new Date(String(proposal.closes_at)).getTime() <= Date.now()) {
        throw new Error("A votação desta proposta foi encerrada.");
      }
      const reputationRows = await tx`
        INSERT INTO civic_reputation (user_id,score)
        VALUES (${input.ownerId}::uuid,50)
        ON CONFLICT (user_id) DO UPDATE SET updated_at=now()
        RETURNING score
      `;
      const score = Number(reputationRows[0]?.score ?? 50);
      const weight = Math.min(5, Math.max(1, Math.floor(score / 25) + 1));
      const previous = await tx`
        SELECT choice FROM participatory_budget_votes
        WHERE proposal_id=${input.proposalId}::uuid AND user_id=${input.ownerId}::uuid
      `;
      await tx`
        INSERT INTO participatory_budget_votes (
          proposal_id,user_id,choice,weight,civic_reputation_at_vote
        ) VALUES (
          ${input.proposalId}::uuid,${input.ownerId}::uuid,${input.choice},${weight},${score}
        )
        ON CONFLICT (proposal_id,user_id) DO UPDATE SET
          choice=EXCLUDED.choice,weight=EXCLUDED.weight,
          civic_reputation_at_vote=EXCLUDED.civic_reputation_at_vote,created_at=now()
      `;
      await tx`
        UPDATE participatory_budget_proposals SET
          support_score=COALESCE((
            SELECT SUM(weight) FROM participatory_budget_votes
            WHERE proposal_id=${input.proposalId}::uuid AND choice='support'
          ),0),
          opposition_score=COALESCE((
            SELECT SUM(weight) FROM participatory_budget_votes
            WHERE proposal_id=${input.proposalId}::uuid AND choice='oppose'
          ),0)
        WHERE id=${input.proposalId}::uuid
      `;
      if (!previous[0]) {
        await tx`
          UPDATE civic_reputation SET
            score=LEAST(100,score+1),votes_cast=votes_cast+1,updated_at=now()
          WHERE user_id=${input.ownerId}::uuid
        `;
      }
      await this.outbox(tx, input.proposalId, "governance.budget-proposal.voted", {
        ownerId: input.ownerId,
        choice: input.choice,
        weight
      });
      return { voted: true };
    });
    return this.state(input.ownerId);
  }

  async fundProposal(input: {
    ownerId: string;
    proposalId: string;
    idempotencyKey: string;
  }): Promise<CityGovernanceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertCivicAuthority(tx, input.ownerId);
      const proposals = await tx`
        SELECT * FROM participatory_budget_proposals
        WHERE id=${input.proposalId}::uuid FOR UPDATE
      `;
      const proposal = proposals[0];
      if (!proposal || String(proposal.status) !== "open") {
        throw new Error("Proposta não está disponível para financiamento.");
      }
      if (Number(proposal.support_score) <= Number(proposal.opposition_score)) {
        throw new Error("A proposta ainda não possui apoio suficiente.");
      }
      const publicAccount = await this.accountByCode(tx, "city.public-investment");
      const operatingAccount = await this.accountByCode(tx, "city.treasury");
      const amountMinor = Number(proposal.requested_budget_minor);
      await this.assertBalance(tx, publicAccount.id, amountMinor);
      const transactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:ledger`,
        type: "participatory-budget-investment",
        entries: [
          { accountId: publicAccount.id, amount: -amountMinor, memo: "Execução de orçamento participativo" },
          { accountId: operatingAccount.id, amount: amountMinor, memo: "Projeto público autorizado" }
        ]
      });
      const investmentId = randomUUID();
      await tx`
        INSERT INTO public_investments (
          id,proposal_id,district_id,category,amount_minor,
          ledger_transaction_id,executed_by
        ) VALUES (
          ${investmentId}::uuid,${input.proposalId}::uuid,
          ${String(proposal.district_id)}::uuid,${String(proposal.category)},${amountMinor},
          ${transactionId}::uuid,${input.ownerId}::uuid
        )
      `;
      await tx`
        UPDATE participatory_budget_proposals SET status='funded'
        WHERE id=${input.proposalId}::uuid
      `;
      await this.applyServiceImpact(
        tx,
        String(proposal.district_id),
        String(proposal.category) as GovernanceCategory,
        7
      );
      if (String(proposal.category) === "expansion") {
        await tx`
          UPDATE city_districts SET expansion_status='active',
            population=GREATEST(population,600),
            quality_of_life_score=LEAST(100,quality_of_life_score+8)
          WHERE id=${String(proposal.district_id)}::uuid
        `;
      }
      await this.bumpCivicReputation(tx, String(proposal.created_by), 4);
      await this.outbox(tx, investmentId, "governance.public-investment.funded", {
        proposalId: input.proposalId,
        amountMinor,
        category: String(proposal.category)
      });
      return { investmentId };
    });
    return this.state(input.ownerId);
  }

  async submitBid(input: {
    ownerId: string;
    contractId: string;
    amountMinor: number;
    deliveryDays: number;
    proposal: string;
    idempotencyKey: string;
  }): Promise<CityGovernanceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.company(tx, input.ownerId);
      const contracts = await tx`
        SELECT id,budget_minor,status,bidding_deadline FROM public_contracts
        WHERE id=${input.contractId}::uuid FOR UPDATE
      `;
      const contract = contracts[0];
      if (!contract || String(contract.status) !== "open") {
        throw new Error("Contrato público não está aberto.");
      }
      if (new Date(String(contract.bidding_deadline)).getTime() <= Date.now()) {
        throw new Error("Prazo da licitação encerrado.");
      }
      if (input.amountMinor > Number(contract.budget_minor)) {
        throw new Error("Proposta supera o orçamento público disponível.");
      }
      const bidId = randomUUID();
      await tx`
        INSERT INTO public_contract_bids (
          id,contract_id,company_id,bidder_id,amount_minor,
          delivery_days,proposal,status,idempotency_key
        ) VALUES (
          ${bidId}::uuid,${input.contractId}::uuid,${company.id}::uuid,
          ${input.ownerId}::uuid,${input.amountMinor},${input.deliveryDays},
          ${input.proposal},'submitted',${input.idempotencyKey}
        )
      `;
      await this.bumpCivicReputation(tx, input.ownerId, 1);
      await this.outbox(tx, bidId, "governance.public-contract.bid-submitted", {
        contractId: input.contractId,
        companyId: company.id,
        amountMinor: input.amountMinor,
        deliveryDays: input.deliveryDays
      });
      return { bidId };
    });
    return this.state(input.ownerId);
  }

  async awardBestBid(input: {
    ownerId: string;
    contractId: string;
    idempotencyKey: string;
  }): Promise<CityGovernanceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertCivicAuthority(tx, input.ownerId);
      const contracts = await tx`
        SELECT id,status FROM public_contracts
        WHERE id=${input.contractId}::uuid FOR UPDATE
      `;
      const contract = contracts[0];
      if (!contract || String(contract.status) !== "open") {
        throw new Error("Contrato público não está aberto para adjudicação.");
      }
      const bids = await tx`
        SELECT id,company_id,amount_minor FROM public_contract_bids
        WHERE contract_id=${input.contractId}::uuid AND status='submitted'
        ORDER BY amount_minor,delivery_days,created_at LIMIT 1 FOR UPDATE
      `;
      const bid = bids[0];
      if (!bid) throw new Error("Nenhuma proposta válida foi apresentada.");
      await tx`
        UPDATE public_contract_bids SET status=CASE
          WHEN id=${String(bid.id)}::uuid THEN 'awarded' ELSE 'rejected' END
        WHERE contract_id=${input.contractId}::uuid AND status='submitted'
      `;
      await tx`
        UPDATE public_contracts SET status='awarded',
          awarded_bid_id=${String(bid.id)}::uuid,
          awarded_company_id=${String(bid.company_id)}::uuid,
          awarded_amount_minor=${Number(bid.amount_minor)}
        WHERE id=${input.contractId}::uuid
      `;
      await this.outbox(tx, input.contractId, "governance.public-contract.awarded", {
        bidId: String(bid.id),
        companyId: String(bid.company_id),
        amountMinor: Number(bid.amount_minor)
      });
      return { bidId: String(bid.id) };
    });
    return this.state(input.ownerId);
  }

  async completeContract(input: {
    ownerId: string;
    contractId: string;
    idempotencyKey: string;
  }): Promise<CityGovernanceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.company(tx, input.ownerId);
      const contracts = await tx`
        SELECT * FROM public_contracts
        WHERE id=${input.contractId}::uuid FOR UPDATE
      `;
      const contract = contracts[0];
      if (!contract || String(contract.status) !== "awarded") {
        throw new Error("Contrato não está adjudicado para conclusão.");
      }
      if (String(contract.awarded_company_id) !== company.id) {
        throw new Error("Somente a empresa vencedora pode concluir o contrato.");
      }
      const amountMinor = Number(contract.awarded_amount_minor);
      const publicAccount = await this.accountByCode(tx, "city.public-investment");
      await this.assertBalance(tx, publicAccount.id, amountMinor);
      const transactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:ledger`,
        type: "public-contract-payment",
        entries: [
          { accountId: publicAccount.id, amount: -amountMinor, memo: "Pagamento de contrato público" },
          { accountId: company.accountId, amount: amountMinor, memo: "Receita de contrato público concluído" }
        ]
      });
      const investmentId = randomUUID();
      await tx`
        INSERT INTO public_investments (
          id,contract_id,district_id,category,amount_minor,
          ledger_transaction_id,executed_by
        ) VALUES (
          ${investmentId}::uuid,${input.contractId}::uuid,
          ${String(contract.district_id)}::uuid,${String(contract.category)},${amountMinor},
          ${transactionId}::uuid,${input.ownerId}::uuid
        )
      `;
      await tx`
        UPDATE public_contracts SET status='completed',completed_at=now()
        WHERE id=${input.contractId}::uuid
      `;
      await this.applyServiceImpact(
        tx,
        String(contract.district_id),
        String(contract.category) as GovernanceCategory,
        6
      );
      await tx`
        INSERT INTO civic_reputation (user_id,score,contracts_completed)
        VALUES (${input.ownerId}::uuid,58,1)
        ON CONFLICT (user_id) DO UPDATE SET
          score=LEAST(100,civic_reputation.score+8),
          contracts_completed=civic_reputation.contracts_completed+1,
          updated_at=now()
      `;
      await this.outbox(tx, investmentId, "governance.public-contract.completed", {
        contractId: input.contractId,
        companyId: company.id,
        amountMinor
      });
      return { investmentId };
    });
    return this.state(input.ownerId);
  }

  private async company(tx: Tx, ownerId: string): Promise<Readonly<{
    id: string;
    name: string;
    accountId: string;
  }>> {
    const rows = await tx`
      SELECT company.id,company.name,account.id account_id
      FROM companies company
      JOIN ledger_accounts account
        ON account.owner_id=company.owner_id AND account.account_type='company'
      WHERE company.owner_id=${ownerId}::uuid
      ORDER BY company.created_at,account.created_at LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new Error("Empresa ou conta empresarial não encontrada.");
    return {
      id: String(row.id),
      name: String(row.name),
      accountId: String(row.account_id)
    };
  }

  private async accountByCode(tx: Tx, code: string): Promise<Readonly<{ id: string }>> {
    const rows = await tx`SELECT id FROM ledger_accounts WHERE code=${code} FOR UPDATE`;
    if (!rows[0]) throw new Error(`Conta pública ausente: ${code}.`);
    return { id: String(rows[0].id) };
  }

  private async assertBalance(tx: Tx, accountId: string, amountMinor: number): Promise<void> {
    const rows = await tx`
      SELECT available_minor FROM ledger_account_balances
      WHERE account_id=${accountId}::uuid
    `;
    if (Number(rows[0]?.available_minor ?? 0) < amountMinor) {
      throw new Error("Saldo disponível insuficiente para a operação.");
    }
  }

  private async assertCivicAuthority(tx: Tx, ownerId: string): Promise<void> {
    const rows = await tx`
      SELECT score FROM civic_reputation WHERE user_id=${ownerId}::uuid FOR UPDATE
    `;
    if (Number(rows[0]?.score ?? 0) < 50) {
      throw new Error("Reputação cívica insuficiente para esta decisão.");
    }
  }

  private async bumpCivicReputation(tx: Tx, ownerId: string, amount: number): Promise<void> {
    await tx`
      INSERT INTO civic_reputation (user_id,score)
      VALUES (${ownerId}::uuid,${Math.min(100, 50 + amount)})
      ON CONFLICT (user_id) DO UPDATE SET
        score=LEAST(100,civic_reputation.score+${amount}),updated_at=now()
    `;
  }

  private async applyServiceImpact(
    tx: Tx,
    districtId: string,
    category: GovernanceCategory,
    points: number
  ): Promise<void> {
    if (category === "energy") {
      await tx`UPDATE urban_service_metrics SET energy_score=LEAST(100,energy_score+${points}),updated_at=now() WHERE district_id=${districtId}::uuid`;
    } else if (category === "transport") {
      await tx`UPDATE urban_service_metrics SET transport_score=LEAST(100,transport_score+${points}),updated_at=now() WHERE district_id=${districtId}::uuid`;
    } else if (category === "safety") {
      await tx`UPDATE urban_service_metrics SET safety_score=LEAST(100,safety_score+${points}),updated_at=now() WHERE district_id=${districtId}::uuid`;
    } else if (category === "education") {
      await tx`UPDATE urban_service_metrics SET education_score=LEAST(100,education_score+${points}),updated_at=now() WHERE district_id=${districtId}::uuid`;
    } else if (category === "environment") {
      await tx`UPDATE urban_service_metrics SET environment_score=LEAST(100,environment_score+${points}),updated_at=now() WHERE district_id=${districtId}::uuid`;
    } else {
      await tx`
        UPDATE urban_service_metrics SET
          transport_score=LEAST(100,transport_score+${Math.max(1, Math.floor(points / 2))}),
          safety_score=LEAST(100,safety_score+${Math.max(1, Math.floor(points / 2))}),
          updated_at=now()
        WHERE district_id=${districtId}::uuid
      `;
    }
    await tx`
      UPDATE city_districts SET
        quality_of_life_score=LEAST(100,quality_of_life_score+${Math.max(1, Math.floor(points / 2))})
      WHERE id=${districtId}::uuid
    `;
  }
}
