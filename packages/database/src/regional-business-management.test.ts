import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  closeDb,
  db,
  RegionalBusinessManagementService
} from "./index.js";

test("gestão regional conecta fornecedor, estoque, campanha, equipe e metas", async () => {
  const sql = db();
  const service = new RegionalBusinessManagementService();
  const run = crypto.randomUUID().replaceAll("-", "");
  const buyerId = crypto.randomUUID();
  const supplierId = crypto.randomUUID();
  const employeeId = crypto.randomUUID();
  const buyerCompanyId = crypto.randomUUID();
  const supplierCompanyId = crypto.randomUUID();
  const buyerWalletId = crypto.randomUUID();
  const supplierWalletId = crypto.randomUUID();
  const employeeWalletId = crypto.randomUUID();
  const buyerCompanyAccountId = crypto.randomUUID();
  const supplierCompanyAccountId = crypto.randomUUID();
  const buyerPlotId = crypto.randomUUID();
  const buyerBuildingId = crypto.randomUUID();
  const catalogEntryId = crypto.randomUUID();
  const openingId = crypto.randomUUID();
  const employmentId = crypto.randomUUID();
  const fundingTransactionId = crypto.randomUUID();
  const buyerEmail = `regional-buyer-${run}@nova-aurora.test`;
  const supplierEmail = `regional-supplier-${run}@nova-aurora.test`;
  const employeeEmail = `regional-employee-${run}@nova-aurora.test`;

  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO users (id,email,display_name) VALUES
        (${buyerId}::uuid,${buyerEmail},'Gestora Regional'),
        (${supplierId}::uuid,${supplierEmail},'Fornecedor Regional'),
        (${employeeId}::uuid,${employeeEmail},'Colaborador Regional')
    `;
    await tx`
      INSERT INTO companies (id,owner_id,name) VALUES
        (${buyerCompanyId}::uuid,${buyerId}::uuid,'Mercado Regional Teste'),
        (${supplierCompanyId}::uuid,${supplierId}::uuid,'Fornecedor Regional Teste')
    `;
    await tx`
      INSERT INTO ledger_accounts (id,code,owner_id,account_type) VALUES
        (${buyerWalletId}::uuid,${`wallet.${run}.buyer`},${buyerId}::uuid,'wallet'),
        (${supplierWalletId}::uuid,${`wallet.${run}.supplier`},${supplierId}::uuid,'wallet'),
        (${employeeWalletId}::uuid,${`wallet.${run}.employee`},${employeeId}::uuid,'wallet'),
        (${buyerCompanyAccountId}::uuid,${`company.${run}.buyer`},${buyerId}::uuid,'company'),
        (${supplierCompanyAccountId}::uuid,${`company.${run}.supplier`},${supplierId}::uuid,'company')
    `;
    await tx`
      INSERT INTO property_plots (
        id,code,location_id,name,property_type,size_class,
        base_value_minor,construction_cost_minor,maintenance_minor,status,max_level
      ) VALUES (
        ${buyerPlotId}::uuid,${`regional-plot-${run}`},
        'f2000000-0000-4000-8000-000000000002'::uuid,
        'Loja Regional Teste','commercial','shared',6000,4000,600,'owned',5
      )
    `;
    await tx`
      INSERT INTO property_ownerships (plot_id,company_id,acquired_by,acquired_price_minor)
      VALUES (${buyerPlotId}::uuid,${buyerCompanyId}::uuid,${buyerId}::uuid,6000)
    `;
    await tx`
      INSERT INTO property_buildings (
        id,plot_id,company_id,building_type,name,level,condition,capacity,status
      ) VALUES (
        ${buyerBuildingId}::uuid,${buyerPlotId}::uuid,${buyerCompanyId}::uuid,
        'retail','Mercado Regional Teste',2,92,30,'active'
      )
    `;
    await tx`
      INSERT INTO business_catalog_entries (
        id,building_id,company_id,code,title,description,category,
        unit_price_minor,capacity_per_cycle,status,created_by
      ) VALUES (
        ${catalogEntryId}::uuid,${buyerBuildingId}::uuid,${buyerCompanyId}::uuid,
        ${`regional-basket-${run}`},'Cesta Regional',
        'Cesta de alimentos para consumidores do distrito.','food',
        2200,30,'active',${buyerId}::uuid
      )
    `;
    await tx`
      INSERT INTO company_reputation (company_id,score,review_count) VALUES
        (${buyerCompanyId}::uuid,70,0),
        (${supplierCompanyId}::uuid,60,0)
    `;
    await tx`
      INSERT INTO company_job_openings (
        id,company_id,building_id,role_code,title,description,
        wage_minor,slots,filled_slots,status,idempotency_key
      ) VALUES (
        ${openingId}::uuid,${buyerCompanyId}::uuid,${buyerBuildingId}::uuid,
        'atendimento','Atendimento Regional','Atende consumidores do distrito.',
        1800,1,1,'filled',${`sprint8:${run}:opening`}
      )
    `;
    await tx`
      INSERT INTO company_employments (
        id,company_id,opening_id,user_id,role_code,wage_minor,status
      ) VALUES (
        ${employmentId}::uuid,${buyerCompanyId}::uuid,${openingId}::uuid,
        ${employeeId}::uuid,'atendimento',1800,'active'
      )
    `;
    await tx`
      INSERT INTO employee_management_profiles (
        employment_id,productivity_score,satisfaction_score,training_level
      ) VALUES (${employmentId}::uuid,100,72,0)
    `;
    await tx`
      INSERT INTO ledger_transactions (
        id,idempotency_key,transaction_type
      ) VALUES (
        ${fundingTransactionId}::uuid,${`sprint8:${run}:funding`},'test-funding'
      )
    `;
    await tx`
      INSERT INTO ledger_entries (transaction_id,account_id,amount_minor,memo) VALUES
        (${fundingTransactionId}::uuid,'a4444444-4444-4444-8444-444444444444'::uuid,-120000,'Emissão de teste'),
        (${fundingTransactionId}::uuid,${buyerCompanyAccountId}::uuid,100000,'Capital comprador'),
        (${fundingTransactionId}::uuid,${supplierCompanyAccountId}::uuid,20000,'Capital fornecedor')
    `;
    await tx`SELECT assert_balanced(${fundingTransactionId}::uuid)`;
  });

  const offered = await service.createSupplierOffer({
    ownerId: supplierId,
    itemCode: "regional-food-input",
    title: "Insumos para Cesta Regional",
    category: "food",
    unitCostMinor: 300,
    minimumQuantity: 5,
    availableQuantity: 100,
    idempotencyKey: `sprint8:${run}:supplier-offer`
  });
  const offer = offered.supplierOffers.find(
    (candidate) => candidate.supplierCompanyId === supplierCompanyId
  );
  assert.ok(offer);

  const stocked = await service.acceptSupplierOffer({
    ownerId: buyerId,
    offerId: offer.id,
    buildingId: buyerBuildingId,
    catalogEntryId,
    quantity: 10,
    idempotencyKey: `sprint8:${run}:contract`
  });
  assert.equal(
    stocked.stocks.find((stock) => stock.catalogEntryId === catalogEntryId)?.quantity,
    10
  );
  assert.equal(stocked.contracts[0]?.grossMinor, 3000);

  const repeatedStock = await service.acceptSupplierOffer({
    ownerId: buyerId,
    offerId: offer.id,
    buildingId: buyerBuildingId,
    catalogEntryId,
    quantity: 10,
    idempotencyKey: `sprint8:${run}:contract`
  });
  assert.equal(
    repeatedStock.stocks.find((stock) => stock.catalogEntryId === catalogEntryId)?.quantity,
    10
  );

  await service.createCampaign({
    ownerId: buyerId,
    buildingId: buyerBuildingId,
    name: "Lançamento Regional",
    channel: "local",
    budgetMinor: 5000,
    visitorBoostPct: 40,
    durationDays: 7,
    idempotencyKey: `sprint8:${run}:campaign`
  });

  await service.createGoal({
    ownerId: buyerId,
    metric: "revenue",
    title: "Faturar 100,00 CA",
    targetValue: 10000,
    deadlineAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    idempotencyKey: `sprint8:${run}:goal`
  });

  const trained = await service.trainEmployee({
    ownerId: buyerId,
    employmentId,
    focus: "productivity",
    idempotencyKey: `sprint8:${run}:training`
  });
  assert.ok((trained.team[0]?.productivityScore ?? 0) > 100);
  assert.equal(trained.team[0]?.trainingLevel, 1);

  const cycled = await service.runRegionalCycle({
    ownerId: buyerId,
    buildingId: buyerBuildingId,
    catalogEntryId,
    idempotencyKey: `sprint8:${run}:cycle`
  });
  const stockAfterCycle = cycled.stocks.find(
    (stock) => stock.catalogEntryId === catalogEntryId
  );
  assert.ok(stockAfterCycle);
  assert.ok(stockAfterCycle.quantity < 10);
  assert.ok(cycled.goals[0]?.currentValue);
  assert.ok(cycled.districtMetrics.length > 0);
  assert.ok(cycled.campaigns[0]?.conversions);
  assert.ok(cycled.alerts.some((alert) => alert.code.startsWith("stock-low:")));

  const repeatedCycle = await service.runRegionalCycle({
    ownerId: buyerId,
    buildingId: buyerBuildingId,
    catalogEntryId,
    idempotencyKey: `sprint8:${run}:cycle`
  });
  assert.equal(
    repeatedCycle.stocks.find((stock) => stock.catalogEntryId === catalogEntryId)?.quantity,
    stockAfterCycle.quantity
  );

  const supplierBalanceRows = await sql`
    SELECT available_minor FROM ledger_account_balances
    WHERE account_id=${supplierCompanyAccountId}::uuid
  `;
  assert.equal(Number(supplierBalanceRows[0]?.available_minor), 23000);
});

after(async () => closeDb());
