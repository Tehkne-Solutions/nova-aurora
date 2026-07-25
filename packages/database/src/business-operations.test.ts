import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  BusinessOperationsService,
  closeDb,
  db
} from "./index.js";

async function walletBalance(userId: string): Promise<number> {
  const rows = await db()`
    SELECT balance.available_minor
    FROM ledger_accounts account
    JOIN ledger_account_balances balance ON balance.account_id=account.id
    WHERE account.owner_id=${userId}::uuid AND account.account_type='wallet'
    ORDER BY account.created_at LIMIT 1
  `;
  return Number(rows[0]?.available_minor ?? 0);
}

test("catálogo, demanda NPC, emprego, folha e mercado secundário usam o ledger", async () => {
  const sql = db();
  const service = new BusinessOperationsService();
  const run = crypto.randomUUID().replaceAll("-", "");
  const ownerId = crypto.randomUUID();
  const workerId = crypto.randomUUID();
  const investorId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const workerCompanyId = crypto.randomUUID();
  const investorCompanyId = crypto.randomUUID();
  const ownerWalletId = crypto.randomUUID();
  const ownerCompanyAccountId = crypto.randomUUID();
  const workerWalletId = crypto.randomUUID();
  const workerCompanyAccountId = crypto.randomUUID();
  const investorWalletId = crypto.randomUUID();
  const investorCompanyAccountId = crypto.randomUUID();
  const plotId = crypto.randomUUID();
  const buildingId = crypto.randomUUID();
  const seedTransactionId = crypto.randomUUID();

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO users (id,email,display_name) VALUES
        (${ownerId}::uuid,${`market-owner-${run}@nova-aurora.test`},'Fundadora Mercado'),
        (${workerId}::uuid,${`market-worker-${run}@nova-aurora.test`},'Trabalhador Mercado'),
        (${investorId}::uuid,${`market-investor-${run}@nova-aurora.test`},'Investidora Mercado')
    `;
    await tx`
      INSERT INTO companies (id,owner_id,name) VALUES
        (${companyId}::uuid,${ownerId}::uuid,'Negócio Público Teste'),
        (${workerCompanyId}::uuid,${workerId}::uuid,'Empresa Trabalhador'),
        (${investorCompanyId}::uuid,${investorId}::uuid,'Empresa Investidora Mercado')
    `;
    await tx`
      INSERT INTO ledger_accounts (id,code,owner_id,account_type) VALUES
        (${ownerWalletId}::uuid,${`wallet.s7.${run}.owner`},${ownerId}::uuid,'wallet'),
        (${ownerCompanyAccountId}::uuid,${`company.s7.${run}.owner`},${ownerId}::uuid,'company'),
        (${workerWalletId}::uuid,${`wallet.s7.${run}.worker`},${workerId}::uuid,'wallet'),
        (${workerCompanyAccountId}::uuid,${`company.s7.${run}.worker`},${workerId}::uuid,'company'),
        (${investorWalletId}::uuid,${`wallet.s7.${run}.investor`},${investorId}::uuid,'wallet'),
        (${investorCompanyAccountId}::uuid,${`company.s7.${run}.investor`},${investorId}::uuid,'company')
    `;
    await tx`
      INSERT INTO company_equity (company_id,total_units,outside_limit_units) VALUES
        (${companyId}::uuid,10000,4000),
        (${workerCompanyId}::uuid,10000,4000),
        (${investorCompanyId}::uuid,10000,4000)
    `;
    await tx`
      INSERT INTO company_equity_positions (company_id,user_id,units,average_cost_minor) VALUES
        (${companyId}::uuid,${ownerId}::uuid,10000,0),
        (${workerCompanyId}::uuid,${workerId}::uuid,10000,0),
        (${investorCompanyId}::uuid,${investorId}::uuid,10000,0)
    `;
    await tx`
      INSERT INTO company_reputation (company_id,score,review_count) VALUES
        (${companyId}::uuid,55,0),
        (${workerCompanyId}::uuid,50,0),
        (${investorCompanyId}::uuid,50,0)
    `;
    await tx`
      INSERT INTO player_world_state (user_id,district_id,location_id) VALUES
        (${ownerId}::uuid,'f1000000-0000-4000-8000-000000000001'::uuid,'f2000000-0000-4000-8000-000000000002'::uuid),
        (${workerId}::uuid,'f1000000-0000-4000-8000-000000000001'::uuid,'f2000000-0000-4000-8000-000000000002'::uuid),
        (${investorId}::uuid,'f1000000-0000-4000-8000-000000000001'::uuid,'f2000000-0000-4000-8000-000000000002'::uuid)
    `;
    await tx`
      INSERT INTO property_plots (
        id,code,location_id,name,property_type,size_class,
        base_value_minor,construction_cost_minor,maintenance_minor,status,max_level
      ) VALUES (
        ${plotId}::uuid,${`market-plot-${run}`},
        'f2000000-0000-4000-8000-000000000002'::uuid,
        'Loja Pública Teste','commercial','shared',6000,4000,600,'owned',5
      )
    `;
    await tx`
      INSERT INTO property_ownerships (plot_id,company_id,acquired_by,acquired_price_minor)
      VALUES (${plotId}::uuid,${companyId}::uuid,${ownerId}::uuid,6000)
    `;
    await tx`
      INSERT INTO property_buildings (
        id,plot_id,company_id,building_type,name,level,condition,capacity,status
      ) VALUES (
        ${buildingId}::uuid,${plotId}::uuid,${companyId}::uuid,
        'bakery','Padaria Pública Teste',2,92,30,'active'
      )
    `;
    await tx`
      INSERT INTO ledger_transactions (id,idempotency_key,transaction_type)
      VALUES (${seedTransactionId}::uuid,${`sprint7:${run}:funding`},'test-funding')
    `;
    await tx`
      INSERT INTO ledger_entries (transaction_id,account_id,amount_minor,memo) VALUES
        (${seedTransactionId}::uuid,'a4444444-4444-4444-8444-444444444444'::uuid,-140000,'Emissão de teste'),
        (${seedTransactionId}::uuid,${ownerWalletId}::uuid,40000,'Capital proprietário'),
        (${seedTransactionId}::uuid,${ownerCompanyAccountId}::uuid,40000,'Caixa empresarial'),
        (${seedTransactionId}::uuid,${workerWalletId}::uuid,20000,'Capital trabalhador'),
        (${seedTransactionId}::uuid,${investorWalletId}::uuid,40000,'Capital investidor')
    `;
    await tx`SELECT assert_balanced(${seedTransactionId}::uuid)`;
  });

  const configured = await service.configureCatalog({
    ownerId,
    buildingId,
    code: `bread-${run}`,
    title: "Pão da Praça",
    description: "Pão artesanal vendido aos visitantes do Mercado Municipal.",
    category: "food",
    unitPriceMinor: 500,
    capacityPerCycle: 24,
    idempotencyKey: `sprint7:${run}:catalog`
  });
  const publicCompany = configured.companies.find((company) => company.id === companyId);
  assert.equal(publicCompany?.catalog.length, 1);

  const opened = await service.createJobOpening({
    ownerId,
    companyId,
    buildingId,
    roleCode: "attendant",
    title: "Atendente de Mercado",
    description: "Atendimento aos consumidores da loja pública.",
    wageMinor: 1200,
    slots: 1,
    idempotencyKey: `sprint7:${run}:job`
  });
  const opening = opened.jobs.find((job) => job.companyId === companyId);
  assert.ok(opening);

  const hired = await service.acceptJob({
    ownerId: workerId,
    openingId: opening.id,
    idempotencyKey: `sprint7:${run}:accept`
  });
  assert.equal(hired.employments[0]?.companyId, companyId);

  const demand = await service.runDemandCycle({
    ownerId,
    buildingId,
    idempotencyKey: `sprint7:${run}:demand`
  });
  const companyAfterDemand = demand.companies.find((company) => company.id === companyId);
  assert.ok((companyAfterDemand?.recentVisitors ?? 0) > 0);
  assert.ok((companyAfterDemand?.recentRevenueMinor ?? 0) > 0);
  assert.ok((companyAfterDemand?.reviewCount ?? 0) > 0);

  const workerBeforePayroll = await walletBalance(workerId);
  await service.runPayroll({
    ownerId,
    companyId,
    idempotencyKey: `sprint7:${run}:payroll`
  });
  const workerAfterPayroll = await walletBalance(workerId);
  assert.equal(workerAfterPayroll - workerBeforePayroll, 1200);

  const listed = await service.createShareListing({
    ownerId,
    companyId,
    units: 200,
    unitPriceMinor: 25,
    idempotencyKey: `sprint7:${run}:share-listing`
  });
  const listing = listed.shareListings.find((candidate) => candidate.companyId === companyId);
  assert.ok(listing);

  const bought = await service.buyShareListing({
    ownerId: investorId,
    listingId: listing.id,
    units: 50,
    idempotencyKey: `sprint7:${run}:share-buy`
  });
  const investorPosition = bought.positions.find((position) => position.companyId === companyId);
  assert.equal(investorPosition?.units, 50);
  assert.equal(investorPosition?.ownershipPercent, 0.5);

  const repeated = await service.buyShareListing({
    ownerId: investorId,
    listingId: listing.id,
    units: 50,
    idempotencyKey: `sprint7:${run}:share-buy`
  });
  assert.equal(
    repeated.positions.find((position) => position.companyId === companyId)?.units,
    50
  );
});

after(async () => closeDb());
