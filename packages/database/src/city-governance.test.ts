import assert from "node:assert/strict";
import test, { after } from "node:test";
import { CityGovernanceService, closeDb, db } from "./index.js";

test("governança conecta licença, orçamento participativo, expansão e licitação", async () => {
  const sql = db();
  const service = new CityGovernanceService();
  const run = crypto.randomUUID().replaceAll("-", "");
  const ownerId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const walletId = crypto.randomUUID();
  const companyAccountId = crypto.randomUUID();
  const fundingId = crypto.randomUUID();
  const contractId = crypto.randomUUID();
  const email = `governance-${run}@nova-aurora.test`;

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO users (id,email,display_name)
      VALUES (${ownerId}::uuid,${email},'Liderança Cívica Teste')
    `;
    await tx`
      INSERT INTO companies (id,owner_id,name)
      VALUES (${companyId}::uuid,${ownerId}::uuid,'Infraestrutura Cívica Teste')
    `;
    await tx`
      INSERT INTO ledger_accounts (id,code,owner_id,account_type) VALUES
        (${walletId}::uuid,${`wallet.governance.${run}`},${ownerId}::uuid,'wallet'),
        (${companyAccountId}::uuid,${`company.governance.${run}`},${ownerId}::uuid,'company')
    `;
    await tx`
      INSERT INTO ledger_transactions (id,idempotency_key,transaction_type)
      VALUES (${fundingId}::uuid,${`governance:${run}:funding`},'test-funding')
    `;
    await tx`
      INSERT INTO ledger_entries (transaction_id,account_id,amount_minor,memo) VALUES
        (${fundingId}::uuid,'a4444444-4444-4444-8444-444444444444'::uuid,-200000,'Emissão de teste'),
        (${fundingId}::uuid,${walletId}::uuid,50000,'Carteira cívica'),
        (${fundingId}::uuid,${companyAccountId}::uuid,100000,'Capital empresarial'),
        (${fundingId}::uuid,'a7777777-7777-4777-8777-777777777777'::uuid,50000,'Reforço do fundo público')
    `;
    await tx`SELECT assert_balanced(${fundingId}::uuid)`;
    await tx`
      INSERT INTO civic_reputation (user_id,score)
      VALUES (${ownerId}::uuid,65)
    `;
    await tx`
      INSERT INTO public_contracts (
        id,code,district_id,title,description,category,budget_minor,status,bidding_deadline
      ) VALUES (
        ${contractId}::uuid,${`civic-contract-${run}`},
        'f1000000-0000-4000-8000-000000000003'::uuid,
        'Infraestrutura Comunitária de Teste',
        'Contrato criado para validar licitação, adjudicação e pagamento.',
        'transport',20000,'open',now()+interval '7 days'
      )
    `;
  });

  const licensed = await service.requestLicense({
    ownerId,
    districtCode: "central",
    licenseTypeCode: "local-commerce",
    idempotencyKey: `governance:${run}:license`
  });
  assert.equal(licensed.licenses[0]?.status, "active");
  assert.equal(licensed.company.accountBalanceMinor, 98800);

  const proposed = await service.createProposal({
    ownerId,
    districtCode: "residential",
    title: "Ativação do Bairro Horizonte",
    description: "Financiar serviços urbanos e abrir o novo bairro à comunidade.",
    category: "expansion",
    requestedBudgetMinor: 12000,
    idempotencyKey: `governance:${run}:proposal`
  });
  const proposal = proposed.proposals.find(
    (candidate) => candidate.title === "Ativação do Bairro Horizonte"
  );
  assert.ok(proposal);

  const voted = await service.voteProposal({
    ownerId,
    proposalId: proposal.id,
    choice: "support",
    idempotencyKey: `governance:${run}:vote`
  });
  const votedProposal = voted.proposals.find((candidate) => candidate.id === proposal.id);
  assert.ok((votedProposal?.supportScore ?? 0) > 0);

  const funded = await service.fundProposal({
    ownerId,
    proposalId: proposal.id,
    idempotencyKey: `governance:${run}:fund-proposal`
  });
  const residential = funded.districts.find((district) => district.code === "residential");
  assert.equal(residential?.expansionStatus, "active");
  assert.ok((residential?.population ?? 0) >= 600);

  const bidState = await service.submitBid({
    ownerId,
    contractId,
    amountMinor: 15000,
    deliveryDays: 12,
    proposal: "Executar a melhoria de transporte com equipe especializada.",
    idempotencyKey: `governance:${run}:bid`
  });
  assert.equal(
    bidState.contracts.find((contract) => contract.id === contractId)?.bids,
    1
  );

  const awarded = await service.awardBestBid({
    ownerId,
    contractId,
    idempotencyKey: `governance:${run}:award`
  });
  assert.equal(
    awarded.contracts.find((contract) => contract.id === contractId)?.status,
    "awarded"
  );

  const completed = await service.completeContract({
    ownerId,
    contractId,
    idempotencyKey: `governance:${run}:complete`
  });
  const finalContract = completed.contracts.find((contract) => contract.id === contractId);
  assert.equal(finalContract?.status, "completed");
  assert.equal(completed.actor.contractsCompleted, 1);
  assert.equal(completed.company.accountBalanceMinor, 113800);
});

after(async () => {
  await closeDb();
});
