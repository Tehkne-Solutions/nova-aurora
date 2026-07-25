import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  closeDb,
  db,
  PropertyBusinessService
} from "./index.js";

test("terreno, empresa e participação simulada usam o mesmo ledger", async () => {
  const sql = db();
  const service = new PropertyBusinessService();
  const run = crypto.randomUUID().replaceAll("-", "");
  const ownerId = crypto.randomUUID();
  const investorId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const investorCompanyId = crypto.randomUUID();
  const ownerWalletId = crypto.randomUUID();
  const ownerCompanyAccountId = crypto.randomUUID();
  const investorWalletId = crypto.randomUUID();
  const investorCompanyAccountId = crypto.randomUUID();
  const plotId = crypto.randomUUID();
  const seedTransactionId = crypto.randomUUID();
  const ownerEmail = `owner-${run}@nova-aurora.test`;
  const investorEmail = `investor-${run}@nova-aurora.test`;
  const plotCode = `plot-${run}`;

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO users (id,email,display_name) VALUES
        (${ownerId}::uuid,${ownerEmail},'Fundadora Teste'),
        (${investorId}::uuid,${investorEmail},'Investidor Teste')
    `;
    await tx`
      INSERT INTO companies (id,owner_id,name) VALUES
        (${companyId}::uuid,${ownerId}::uuid,'Empresa Teste'),
        (${investorCompanyId}::uuid,${investorId}::uuid,'Empresa Investidora')
    `;
    await tx`
      INSERT INTO ledger_accounts (id,code,owner_id,account_type) VALUES
        (${ownerWalletId}::uuid,${`wallet.${run}.owner`},${ownerId}::uuid,'wallet'),
        (${ownerCompanyAccountId}::uuid,${`company.${run}.owner`},${ownerId}::uuid,'company'),
        (${investorWalletId}::uuid,${`wallet.${run}.investor`},${investorId}::uuid,'wallet'),
        (${investorCompanyAccountId}::uuid,${`company.${run}.investor`},${investorId}::uuid,'company')
    `;
    await tx`
      INSERT INTO company_equity (company_id,total_units,outside_limit_units) VALUES
        (${companyId}::uuid,10000,4000),
        (${investorCompanyId}::uuid,10000,4000)
    `;
    await tx`
      INSERT INTO company_equity_positions (
        company_id,user_id,units,average_cost_minor
      ) VALUES
        (${companyId}::uuid,${ownerId}::uuid,10000,0),
        (${investorCompanyId}::uuid,${investorId}::uuid,10000,0)
    `;
    await tx`
      INSERT INTO player_world_state (user_id,district_id,location_id) VALUES
        (${ownerId}::uuid,'f1000000-0000-4000-8000-000000000001'::uuid,'f2000000-0000-4000-8000-000000000002'::uuid),
        (${investorId}::uuid,'f1000000-0000-4000-8000-000000000001'::uuid,'f2000000-0000-4000-8000-000000000002'::uuid)
    `;
    await tx`
      INSERT INTO property_plots (
        id,code,location_id,name,property_type,size_class,
        base_value_minor,construction_cost_minor,maintenance_minor,status,max_level
      ) VALUES (
        ${plotId}::uuid,${plotCode},
        'f2000000-0000-4000-8000-000000000002'::uuid,
        'Unidade de Teste','commercial','shared',6000,4000,600,'available',5
      )
    `;
    await tx`
      INSERT INTO ledger_transactions (
        id,idempotency_key,transaction_type
      ) VALUES (
        ${seedTransactionId}::uuid,${`sprint6:${run}:funding`},'test-funding'
      )
    `;
    await tx`
      INSERT INTO ledger_entries (transaction_id,account_id,amount_minor,memo) VALUES
        (${seedTransactionId}::uuid,'a4444444-4444-4444-8444-444444444444'::uuid,-60000,'Emissão de teste'),
        (${seedTransactionId}::uuid,${ownerWalletId}::uuid,30000,'Capital do proprietário'),
        (${seedTransactionId}::uuid,${investorWalletId}::uuid,30000,'Capital do investidor')
    `;
    await tx`SELECT assert_balanced(${seedTransactionId}::uuid)`;
  });

  const acquired = await service.acquirePlot({
    ownerId,
    plotCode,
    idempotencyKey: `sprint6:${run}:acquire`
  });
  assert.equal(
    acquired.plots.find((plot) => plot.code === plotCode)?.ownerCompanyId,
    companyId
  );

  const built = await service.constructBuilding({
    ownerId,
    plotCode,
    buildingType: "bakery",
    name: "Padaria de Teste",
    idempotencyKey: `sprint6:${run}:build`
  });
  const building = built.plots.find((plot) => plot.code === plotCode)?.building;
  assert.ok(building);

  await service.visitProperty({
    ownerId: investorId,
    plotCode,
    idempotencyKey: `sprint6:${run}:visit`
  });

  const operated = await service.runOperatingCycle({
    ownerId,
    buildingId: building.id,
    idempotencyKey: `sprint6:${run}:operate`
  });
  assert.equal(operated.cycles.length, 1);
  assert.ok((operated.cycles[0]?.netResultMinor ?? 0) > 0);
  assert.ok(operated.company.accountBalanceMinor > 0);

  const offered = await service.createShareOffering({
    ownerId,
    units: 300,
    unitPriceMinor: 20,
    idempotencyKey: `sprint6:${run}:offer`
  });
  const offering = offered.offerings.find(
    (candidate) => candidate.companyId === companyId
  );
  assert.ok(offering);

  const invested = await service.invest({
    ownerId: investorId,
    offeringId: offering.id,
    units: 100,
    idempotencyKey: `sprint6:${run}:invest`
  });
  const position = invested.portfolio.find(
    (candidate) => candidate.companyId === companyId
  );
  assert.equal(position?.units, 100);
  assert.equal(position?.ownershipPercent, 1);

  const upgraded = await service.upgradeBuilding({
    ownerId,
    buildingId: building.id,
    idempotencyKey: `sprint6:${run}:upgrade`
  });
  assert.equal(
    upgraded.plots.find((plot) => plot.code === plotCode)?.building?.level,
    2
  );

  const cycle = operated.cycles[0];
  assert.ok(cycle);
  const distributed = await service.distributeResults({
    ownerId,
    cycleId: cycle.id,
    idempotencyKey: `sprint6:${run}:distribution`
  });
  assert.equal(distributed.cycles[0]?.status, "distributed");

  const investorState = await service.state(investorId);
  assert.ok(investorState.distributionsReceivedMinor > 0);
  assert.equal(
    investorState.portfolio.find((candidate) => candidate.companyId === companyId)?.units,
    100
  );
});

after(async () => closeDb());
