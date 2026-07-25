import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";

export type ManagedStockView = Readonly<{
  buildingId: string;
  buildingName: string;
  catalogEntryId: string;
  catalogTitle: string;
  category: string;
  quantity: number;
  reorderPoint: number;
  averageUnitCostMinor: number;
}>;

export type SupplierOfferView = Readonly<{
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

export type BusinessContractView = Readonly<{
  id: string;
  buyerCompanyId: string;
  buyerCompanyName: string;
  supplierCompanyId: string;
  supplierCompanyName: string;
  itemCode: string;
  quantity: number;
  grossMinor: number;
  status: string;
  createdAt: string;
}>;

export type MarketingCampaignView = Readonly<{
  id: string;
  buildingId: string;
  buildingName: string;
  name: string;
  channel: string;
  budgetMinor: number;
  visitorBoostPct: number;
  conversions: number;
  attributedRevenueMinor: number;
  status: string;
  startsAt: string;
  endsAt: string;
}>;

export type CompanyGoalView = Readonly<{
  id: string;
  metric: string;
  title: string;
  targetValue: number;
  currentValue: number;
  progressPercent: number;
  status: string;
  deadlineAt: string;
}>;

export type ManagedEmployeeView = Readonly<{
  employmentId: string;
  userId: string;
  displayName: string;
  roleCode: string;
  wageMinor: number;
  productivityScore: number;
  satisfactionScore: number;
  trainingLevel: number;
}>;

export type DistrictBusinessMetricView = Readonly<{
  districtId: string;
  districtName: string;
  metricDate: string;
  visitors: number;
  customers: number;
  grossRevenueMinor: number;
  activeEmployees: number;
  averageReputation: number;
}>;

export type BusinessAlertView = Readonly<{
  id: string;
  code: string;
  severity: string;
  message: string;
  status: string;
  createdAt: string;
}>;

export type RegionalBusinessState = Readonly<{
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
  stocks: readonly ManagedStockView[];
  supplierOffers: readonly SupplierOfferView[];
  contracts: readonly BusinessContractView[];
  campaigns: readonly MarketingCampaignView[];
  goals: readonly CompanyGoalView[];
  team: readonly ManagedEmployeeView[];
  districtMetrics: readonly DistrictBusinessMetricView[];
  alerts: readonly BusinessAlertView[];
}>;

type OwnedCompany = Readonly<{
  id: string;
  name: string;
  ownerId: string;
  accountId: string;
}>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export class RegionalBusinessManagementService extends EconomyRepositoryBase {
  async state(ownerId: string): Promise<RegionalBusinessState> {
    const [actorRows, companyRows] = await Promise.all([
      this.sql`
        SELECT user_account.id,user_account.display_name,
               COALESCE(balance.available_minor,0)::bigint balance_minor
        FROM users user_account
        LEFT JOIN ledger_accounts account
          ON account.owner_id=user_account.id AND account.account_type='wallet'
        LEFT JOIN ledger_account_balances balance ON balance.account_id=account.id
        WHERE user_account.id=${ownerId}::uuid
        ORDER BY account.created_at LIMIT 1
      `,
      this.sql`
        SELECT company.id,company.name,company.owner_id,
               COALESCE(balance.available_minor,0)::bigint balance_minor
        FROM companies company
        LEFT JOIN ledger_accounts account
          ON account.owner_id=company.owner_id AND account.account_type='company'
        LEFT JOIN ledger_account_balances balance ON balance.account_id=account.id
        WHERE company.owner_id=${ownerId}::uuid
        ORDER BY company.created_at LIMIT 1
      `
    ]);
    const actor = actorRows[0];
    const company = companyRows[0];
    if (!actor) throw new Error("Jogador não encontrado.");
    if (!company) throw new Error("Empresa principal não encontrada.");
    const companyId = String(company.id);

    const [
      stockRows,
      offerRows,
      contractRows,
      campaignRows,
      goalRows,
      teamRows,
      metricRows,
      alertRows
    ] = await Promise.all([
      this.sql`
        SELECT building.id building_id,building.name building_name,
               catalog.id catalog_entry_id,catalog.title catalog_title,catalog.category,
               COALESCE(stock.quantity_units,0)::integer quantity_units,
               COALESCE(stock.reorder_point,5)::integer reorder_point,
               COALESCE(stock.average_unit_cost_minor,0)::bigint average_unit_cost_minor
        FROM property_buildings building
        JOIN business_catalog_entries catalog ON catalog.building_id=building.id
        LEFT JOIN business_stock_levels stock
          ON stock.building_id=building.id AND stock.catalog_entry_id=catalog.id
        WHERE building.company_id=${companyId}::uuid
        ORDER BY building.name,catalog.title
      `,
      this.sql`
        SELECT offer.*,company.name supplier_company_name
        FROM supplier_offers offer
        JOIN companies company ON company.id=offer.supplier_company_id
        WHERE offer.status='open'
        ORDER BY offer.unit_cost_minor,offer.created_at
      `,
      this.sql`
        SELECT contract.*,buyer.name buyer_company_name,supplier.name supplier_company_name,
               offer.item_code
        FROM business_b2b_contracts contract
        JOIN companies buyer ON buyer.id=contract.buyer_company_id
        JOIN companies supplier ON supplier.id=contract.supplier_company_id
        JOIN supplier_offers offer ON offer.id=contract.supplier_offer_id
        WHERE contract.buyer_company_id=${companyId}::uuid
           OR contract.supplier_company_id=${companyId}::uuid
        ORDER BY contract.created_at DESC LIMIT 30
      `,
      this.sql`
        SELECT campaign.*,building.name building_name
        FROM marketing_campaigns campaign
        JOIN property_buildings building ON building.id=campaign.building_id
        WHERE campaign.company_id=${companyId}::uuid
        ORDER BY campaign.created_at DESC LIMIT 30
      `,
      this.sql`
        SELECT * FROM company_goals
        WHERE company_id=${companyId}::uuid
        ORDER BY created_at DESC LIMIT 30
      `,
      this.sql`
        SELECT employment.id employment_id,employment.user_id,user_account.display_name,
               employment.role_code,employment.wage_minor,
               COALESCE(profile.productivity_score,100)::integer productivity_score,
               COALESCE(profile.satisfaction_score,70)::integer satisfaction_score,
               COALESCE(profile.training_level,0)::integer training_level
        FROM company_employments employment
        JOIN users user_account ON user_account.id=employment.user_id
        LEFT JOIN employee_management_profiles profile ON profile.employment_id=employment.id
        WHERE employment.company_id=${companyId}::uuid AND employment.status='active'
        ORDER BY user_account.display_name
      `,
      this.sql`
        SELECT metric.*,district.name district_name
        FROM district_business_metrics metric
        JOIN city_districts district ON district.id=metric.district_id
        ORDER BY metric.metric_date DESC,district.name LIMIT 40
      `,
      this.sql`
        SELECT * FROM business_alerts
        WHERE company_id=${companyId}::uuid AND status='open'
        ORDER BY
          CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
          created_at DESC
      `
    ]);

    return {
      actor: {
        id: String(actor.id),
        displayName: String(actor.display_name),
        balanceMinor: Number(actor.balance_minor)
      },
      company: {
        id: companyId,
        name: String(company.name),
        accountBalanceMinor: Number(company.balance_minor)
      },
      stocks: stockRows.map((row) => ({
        buildingId: String(row.building_id),
        buildingName: String(row.building_name),
        catalogEntryId: String(row.catalog_entry_id),
        catalogTitle: String(row.catalog_title),
        category: String(row.category),
        quantity: Number(row.quantity_units),
        reorderPoint,
        averageUnitCostMinor: Number(row.average_unit_cost_minor)
      })),
      supplierOffers: offerRows.map((row) => ({
        id: String(row.id),
        supplierCompanyId: String(row.supplier_company_id),
        supplierCompanyName: String(row.supplier_company_name),
        itemCode: String(row.item_code),
        title: String(row.title),
        category: String(row.category),
        unitCostMinor: Number(row.unit_cost_minor),
        minimumQuantity: Number(row.minimum_quantity),
        availableQuantity: Number(row.available_quantity),
        status: String(row.status)
      })),
      contracts: contractRows.map((row) => ({
        id: String(row.id),
        buyerCompanyId: String(row.buyer_company_id),
        buyerCompanyName: String(row.buyer_company_name),
        supplierCompanyId: String(row.supplier_company_id),
        supplierCompanyName: String(row.supplier_company_name),
        itemCode: String(row.item_code),
        quantity: Number(row.quantity),
        grossMinor: Number(row.gross_minor),
        status: String(row.status),
        createdAt: new Date(String(row.created_at)).toISOString()
      })),
      campaigns: campaignRows.map((row) => ({
        id: String(row.id),
        buildingId: String(row.building_id),
        buildingName: String(row.building_name),
        name: String(row.name),
        channel: String(row.channel),
        budgetMinor: Number(row.budget_minor),
        visitorBoostPct: Number(row.visitor_boost_pct),
        conversions: Number(row.conversions),
        attributedRevenueMinor: Number(row.attributed_revenue_minor),
        status: String(row.status),
        startsAt: new Date(String(row.starts_at)).toISOString(),
        endsAt: new Date(String(row.ends_at)).toISOString()
      })),
      goals: goalRows.map((row) => {
        const target = Number(row.target_value);
        const current = Number(row.current_value);
        return {
          id: String(row.id),
          metric: String(row.metric),
          title: String(row.title),
          targetValue: target,
          currentValue: current,
          progressPercent: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
          status: String(row.status),
          deadlineAt: new Date(String(row.deadline_at)).toISOString()
        };
      }),
      team: teamRows.map((row) => ({
        employmentId: String(row.employment_id),
        userId: String(row.user_id),
        displayName: String(row.display_name),
        roleCode: String(row.role_code),
        wageMinor: Number(row.wage_minor),
        productivityScore: Number(row.productivity_score),
        satisfactionScore: Number(row.satisfaction_score),
        trainingLevel: Number(row.training_level)
      })),
      districtMetrics: metricRows.map((row) => ({
        districtId: String(row.district_id),
        districtName: String(row.district_name),
        metricDate: String(row.metric_date),
        visitors: Number(row.visitors),
        customers: Number(row.customers),
        grossRevenueMinor: Number(row.gross_revenue_minor),
        activeEmployees: Number(row.active_employees),
        averageReputation: Number(row.average_reputation)
      })),
      alerts: alertRows.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        severity: String(row.severity),
        message: String(row.message),
        status: String(row.status),
        createdAt: new Date(String(row.created_at)).toISOString()
      }))
    };
  }

  async createSupplierOffer(input: {
    ownerId: string;
    itemCode: string;
    title: string;
    category: "food" | "retail" | "services" | "creative" | "industrial";
    unitCostMinor: number;
    minimumQuantity: number;
    availableQuantity: number;
    idempotencyKey: string;
  }): Promise<RegionalBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      const offerId = randomUUID();
      await tx`
        INSERT INTO supplier_offers (
          id,supplier_company_id,item_code,title,category,unit_cost_minor,
          minimum_quantity,available_quantity,idempotency_key
        ) VALUES (
          ${offerId}::uuid,${company.id}::uuid,${input.itemCode},${input.title},
          ${input.category},${input.unitCostMinor},${input.minimumQuantity},
          ${input.availableQuantity},${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, offerId, "business.supplier-offer.created", {
        companyId: company.id,
        itemCode: input.itemCode,
        availableQuantity: input.availableQuantity,
        unitCostMinor: input.unitCostMinor
      });
      return { offerId };
    });
    return this.state(input.ownerId);
  }

  async acceptSupplierOffer(input: {
    ownerId: string;
    offerId: string;
    buildingId: string;
    catalogEntryId: string;
    quantity: number;
    idempotencyKey: string;
  }): Promise<RegionalBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const buyer = await this.ownedCompany(tx, input.ownerId);
      const offers = await tx`
        SELECT offer.*,supplier.owner_id supplier_owner_id
        FROM supplier_offers offer
        JOIN companies supplier ON supplier.id=offer.supplier_company_id
        WHERE offer.id=${input.offerId}::uuid FOR UPDATE OF offer
      `;
      const offer = offers[0];
      if (!offer || String(offer.status) !== "open") throw new Error("Oferta de fornecedor indisponível.");
      if (String(offer.supplier_company_id) === buyer.id) {
        throw new Error("A empresa não pode contratar a própria oferta.");
      }
      if (input.quantity < Number(offer.minimum_quantity)) {
        throw new Error("Quantidade abaixo do mínimo do fornecedor.");
      }
      if (input.quantity > Number(offer.available_quantity)) {
        throw new Error("Quantidade superior à disponibilidade.");
      }

      const catalogs = await tx`
        SELECT catalog.id,catalog.building_id
        FROM business_catalog_entries catalog
        JOIN property_buildings building ON building.id=catalog.building_id
        WHERE catalog.id=${input.catalogEntryId}::uuid
          AND building.id=${input.buildingId}::uuid
          AND building.company_id=${buyer.id}::uuid
        FOR UPDATE OF catalog,building
      `;
      if (!catalogs[0]) throw new Error("Catálogo comprador não pertence à empresa.");

      const supplierAccount = await this.companyAccountByOwner(tx, String(offer.supplier_owner_id));
      const grossMinor = input.quantity * Number(offer.unit_cost_minor);
      await this.assertAvailableBalance(tx, buyer.accountId, grossMinor);
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:settlement`,
        type: "b2b-supply-contract",
        entries: [
          { accountId: buyer.accountId, amount: -grossMinor, memo: `Compra B2B ${String(offer.item_code)}` },
          { accountId: supplierAccount.id, amount: grossMinor, memo: `Venda B2B ${String(offer.item_code)}` }
        ]
      });

      const stockRows = await tx`
        SELECT quantity_units,average_unit_cost_minor
        FROM business_stock_levels
        WHERE building_id=${input.buildingId}::uuid
          AND catalog_entry_id=${input.catalogEntryId}::uuid
        FOR UPDATE
      `;
      const oldQuantity = Number(stockRows[0]?.quantity_units ?? 0);
      const oldAverage = Number(stockRows[0]?.average_unit_cost_minor ?? 0);
      const newQuantity = oldQuantity + input.quantity;
      const newAverage = Math.round(
        ((oldQuantity * oldAverage) + grossMinor) / Math.max(newQuantity, 1)
      );
      await tx`
        INSERT INTO business_stock_levels (
          building_id,catalog_entry_id,quantity_units,reorder_point,average_unit_cost_minor
        ) VALUES (
          ${input.buildingId}::uuid,${input.catalogEntryId}::uuid,
          ${newQuantity},5,${newAverage}
        )
        ON CONFLICT (building_id,catalog_entry_id) DO UPDATE SET
          quantity_units=EXCLUDED.quantity_units,
          average_unit_cost_minor=EXCLUDED.average_unit_cost_minor,
          updated_at=now()
      `;

      const contractId = randomUUID();
      await tx`
        INSERT INTO business_b2b_contracts (
          id,buyer_company_id,supplier_company_id,buyer_building_id,
          buyer_catalog_entry_id,supplier_offer_id,quantity,unit_cost_minor,
          gross_minor,ledger_transaction_id,idempotency_key
        ) VALUES (
          ${contractId}::uuid,${buyer.id}::uuid,
          ${String(offer.supplier_company_id)}::uuid,${input.buildingId}::uuid,
          ${input.catalogEntryId}::uuid,${input.offerId}::uuid,${input.quantity},
          ${Number(offer.unit_cost_minor)},${grossMinor},${ledgerTransactionId}::uuid,
          ${input.idempotencyKey}
        )
      `;
      const remaining = Number(offer.available_quantity) - input.quantity;
      await tx`
        UPDATE supplier_offers SET
          available_quantity=${remaining},
          status=${remaining === 0 ? "filled" : "open"},
          closed_at=${remaining === 0 ? new Date().toISOString() : null}::timestamptz
        WHERE id=${input.offerId}::uuid
      `;
      await this.outbox(tx, contractId, "business.b2b-contract.settled", {
        buyerCompanyId: buyer.id,
        supplierCompanyId: String(offer.supplier_company_id),
        quantity: input.quantity,
        grossMinor
      });
      return { contractId };
    });
    return this.state(input.ownerId);
  }

  async createCampaign(input: {
    ownerId: string;
    buildingId: string;
    name: string;
    channel: "local" | "social" | "outdoor" | "influencer";
    budgetMinor: number;
    visitorBoostPct: number;
    durationDays: number;
    idempotencyKey: string;
  }): Promise<RegionalBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      await this.assertOwnedBuilding(tx, company.id, input.buildingId);
      await this.assertAvailableBalance(tx, company.accountId, input.budgetMinor);
      const cityAccountId = await this.cityAccountId(tx);
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:budget`,
        type: "marketing-campaign-budget",
        entries: [
          { accountId: company.accountId, amount: -input.budgetMinor, memo: `Campanha ${input.name}` },
          { accountId: cityAccountId, amount: input.budgetMinor, memo: `Serviços de mídia ${input.channel}` }
        ]
      });
      const campaignId = randomUUID();
      await tx`
        INSERT INTO marketing_campaigns (
          id,company_id,building_id,name,channel,budget_minor,visitor_boost_pct,
          ends_at,ledger_transaction_id,idempotency_key
        ) VALUES (
          ${campaignId}::uuid,${company.id}::uuid,${input.buildingId}::uuid,
          ${input.name},${input.channel},${input.budgetMinor},${input.visitorBoostPct},
          now()+(${input.durationDays}::text || ' days')::interval,
          ${ledgerTransactionId}::uuid,${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, campaignId, "business.marketing-campaign.started", {
        companyId: company.id,
        buildingId: input.buildingId,
        visitorBoostPct: input.visitorBoostPct
      });
      return { campaignId };
    });
    return this.state(input.ownerId);
  }

  async createGoal(input: {
    ownerId: string;
    metric: "revenue" | "customers" | "reputation" | "stock" | "employee_satisfaction";
    title: string;
    targetValue: number;
    deadlineAt: string;
    idempotencyKey: string;
  }): Promise<RegionalBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      const deadline = new Date(input.deadlineAt);
      if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) {
        throw new Error("Prazo da meta deve estar no futuro.");
      }
      const goalId = randomUUID();
      await tx`
        INSERT INTO company_goals (
          id,company_id,metric,title,target_value,deadline_at,idempotency_key
        ) VALUES (
          ${goalId}::uuid,${company.id}::uuid,${input.metric},${input.title},
          ${input.targetValue},${deadline.toISOString()}::timestamptz,${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, goalId, "business.goal.created", {
        companyId: company.id,
        metric: input.metric,
        targetValue: input.targetValue
      });
      return { goalId };
    });
    return this.state(input.ownerId);
  }

  async trainEmployee(input: {
    ownerId: string;
    employmentId: string;
    focus: "service" | "quality" | "productivity";
    idempotencyKey: string;
  }): Promise<RegionalBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      const employments = await tx`
        SELECT employment.id,
               COALESCE(profile.training_level,0)::integer training_level
        FROM company_employments employment
        LEFT JOIN employee_management_profiles profile ON profile.employment_id=employment.id
        WHERE employment.id=${input.employmentId}::uuid
          AND employment.company_id=${company.id}::uuid
          AND employment.status='active'
        FOR UPDATE OF employment
      `;
      const employment = employments[0];
      if (!employment) throw new Error("Vínculo profissional não encontrado.");
      const trainingLevel = Number(employment.training_level);
      const costMinor = 1200 + (trainingLevel * 500);
      await this.assertAvailableBalance(tx, company.accountId, costMinor);
      const cityAccountId = await this.cityAccountId(tx);
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:training`,
        type: "employee-training",
        entries: [
          { accountId: company.accountId, amount: -costMinor, memo: `Treinamento ${input.focus}` },
          { accountId: cityAccountId, amount: costMinor, memo: "Centro de capacitação" }
        ]
      });
      const productivityDelta = input.focus === "productivity" ? 12 : 7;
      const satisfactionDelta = input.focus === "service" ? 8 : 5;
      await tx`
        INSERT INTO employee_management_profiles (
          employment_id,productivity_score,satisfaction_score,training_level,last_trained_at
        ) VALUES (
          ${input.employmentId}::uuid,${100 + productivityDelta},
          ${70 + satisfactionDelta},1,now()
        )
        ON CONFLICT (employment_id) DO UPDATE SET
          productivity_score=LEAST(200,employee_management_profiles.productivity_score+${productivityDelta}),
          satisfaction_score=LEAST(100,employee_management_profiles.satisfaction_score+${satisfactionDelta}),
          training_level=LEAST(20,employee_management_profiles.training_level+1),
          last_trained_at=now(),updated_at=now()
      `;
      const runId = randomUUID();
      await tx`
        INSERT INTO employee_training_runs (
          id,employment_id,company_id,focus,cost_minor,productivity_delta,
          satisfaction_delta,ledger_transaction_id,idempotency_key
        ) VALUES (
          ${runId}::uuid,${input.employmentId}::uuid,${company.id}::uuid,
          ${input.focus},${costMinor},${productivityDelta},${satisfactionDelta},
          ${ledgerTransactionId}::uuid,${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, runId, "business.employee.trained", {
        companyId: company.id,
        employmentId: input.employmentId,
        focus: input.focus
      });
      return { runId };
    });
    return this.state(input.ownerId);
  }

  async runRegionalCycle(input: {
    ownerId: string;
    buildingId: string;
    catalogEntryId: string;
    idempotencyKey: string;
  }): Promise<RegionalBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      await tx`
        UPDATE marketing_campaigns SET status='completed'
        WHERE company_id=${company.id}::uuid AND status='active' AND ends_at<=now()
      `;
      const rows = await tx`
        SELECT catalog.id,catalog.title,catalog.category,catalog.unit_price_minor,
               catalog.capacity_per_cycle,building.level,building.condition,
               location.district_id,profile.base_visitors,profile.reference_price_minor,
               profile.price_sensitivity,profile.quality_weight,profile.seasonality,
               COALESCE(reputation.score,50)::integer reputation_score,
               COALESCE((
                 SELECT SUM(campaign.visitor_boost_pct)
                 FROM marketing_campaigns campaign
                 WHERE campaign.building_id=building.id
                   AND campaign.status='active'
                   AND campaign.starts_at<=now() AND campaign.ends_at>now()
               ),0)::integer campaign_boost
        FROM business_catalog_entries catalog
        JOIN property_buildings building ON building.id=catalog.building_id
        JOIN property_plots plot ON plot.id=building.plot_id
        JOIN city_locations location ON location.id=plot.location_id
        JOIN district_demand_profiles profile
          ON profile.district_id=location.district_id AND profile.category=catalog.category
        LEFT JOIN company_reputation reputation ON reputation.company_id=building.company_id
        WHERE catalog.id=${input.catalogEntryId}::uuid
          AND building.id=${input.buildingId}::uuid
          AND building.company_id=${company.id}::uuid
          AND catalog.status='active' AND building.status='active'
        FOR UPDATE OF catalog,building
      `;
      const row = rows[0];
      if (!row) throw new Error("Operação regional indisponível para este catálogo.");
      const stockRows = await tx`
        SELECT quantity_units,reorder_point
        FROM business_stock_levels
        WHERE building_id=${input.buildingId}::uuid
          AND catalog_entry_id=${input.catalogEntryId}::uuid
        FOR UPDATE
      `;
      const stock = stockRows[0];
      const stockQuantity = Number(stock?.quantity_units ?? 0);
      const reorderPoint = Number(stock?.reorder_point ?? 5);
      if (stockQuantity <= 0) throw new Error("Estoque comercial esgotado.");

      const teamRows = await tx`
        SELECT COUNT(*)::integer employee_count,
               COALESCE(AVG(COALESCE(profile.productivity_score,100)),100)::numeric avg_productivity,
               COALESCE(AVG(COALESCE(profile.satisfaction_score,70)),70)::numeric avg_satisfaction
        FROM company_employments employment
        LEFT JOIN employee_management_profiles profile ON profile.employment_id=employment.id
        WHERE employment.company_id=${company.id}::uuid AND employment.status='active'
      `;
      const employeeCount = Number(teamRows[0]?.employee_count ?? 0);
      const averageProductivity = Number(teamRows[0]?.avg_productivity ?? 100);
      const averageSatisfaction = Number(teamRows[0]?.avg_satisfaction ?? 70);
      const referencePrice = Math.max(Number(row.reference_price_minor), 1);
      const priceRatio = Number(row.unit_price_minor) / referencePrice;
      const priceFactor = Math.pow(
        clamp(1 / priceRatio, 0.4, 1.6),
        Number(row.price_sensitivity)
      );
      const campaignMultiplier = 1 + (clamp(Number(row.campaign_boost), 0, 100) / 100);
      const qualityMultiplier =
        (Number(row.condition) / 100) *
        (0.75 + (Number(row.level) * 0.08)) *
        (0.75 + (Number(row.reputation_score) / 200)) *
        Number(row.quality_weight);
      const teamMultiplier = 1 + (employeeCount * 0.04 * (averageProductivity / 100));
      const visitors = Math.max(
        1,
        Math.round(
          Number(row.base_visitors) *
          Number(row.seasonality) *
          campaignMultiplier *
          qualityMultiplier *
          teamMultiplier
        )
      );
      const satisfaction = clamp(
        Math.round(
          (Number(row.condition) * 0.35) +
          (Number(row.reputation_score) * 0.30) +
          (averageSatisfaction * 0.20) +
          (Math.min(averageProductivity, 150) * 0.10) +
          (Math.min(Number(row.level) * 5, 25))
        ),
        1,
        100
      );
      const conversionRate = clamp(
        0.18 + (priceFactor * 0.20) + (satisfaction / 400),
        0.12,
        0.88
      );
      const customers = Math.min(
        stockQuantity,
        Number(row.capacity_per_cycle),
        Math.max(1, Math.floor(visitors * conversionRate))
      );
      const grossMinor = customers * Number(row.unit_price_minor);
      const taxMinor = Math.round(grossMinor * 0.03);
      const netMinor = grossMinor - taxMinor;
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:revenue`,
        type: "regional-business-cycle",
        entries: [
          { accountCode: "system.issuance", amount: -grossMinor, memo: "Consumo regional NPC" },
          { accountId: company.accountId, amount: netMinor, memo: `Receita ${String(row.title)}` },
          { accountCode: "city.treasury", amount: taxMinor, memo: "Tributo sobre consumo regional" }
        ]
      });
      const remainingStock = stockQuantity - customers;
      await tx`
        UPDATE business_stock_levels SET
          quantity_units=${remainingStock},updated_at=now()
        WHERE building_id=${input.buildingId}::uuid
          AND catalog_entry_id=${input.catalogEntryId}::uuid
      `;
      const reputationDelta = satisfaction >= 78 ? 2 : satisfaction >= 58 ? 1 : -2;
      const newReputation = clamp(Number(row.reputation_score) + reputationDelta, 0, 100);
      await tx`
        INSERT INTO company_reputation (company_id,score,review_count)
        VALUES (${company.id}::uuid,${newReputation},1)
        ON CONFLICT (company_id) DO UPDATE SET
          score=${newReputation},
          review_count=company_reputation.review_count+1,
          updated_at=now()
      `;
      const cycleId = randomUUID();
      await tx`
        INSERT INTO business_demand_cycles (
          id,catalog_entry_id,company_id,building_id,visitors,customers,
          gross_revenue_minor,tax_minor,satisfaction,reputation_delta,
          ledger_transaction_id,idempotency_key
        ) VALUES (
          ${cycleId}::uuid,${input.catalogEntryId}::uuid,${company.id}::uuid,
          ${input.buildingId}::uuid,${visitors},${customers},${grossMinor},
          ${taxMinor},${satisfaction},${reputationDelta},${ledgerTransactionId}::uuid,
          ${input.idempotencyKey}
        )
      `;
      await tx`
        INSERT INTO company_reviews (
          id,company_id,building_id,source,rating,comment,demand_cycle_id
        ) VALUES (
          ${randomUUID()}::uuid,${company.id}::uuid,${input.buildingId}::uuid,
          'npc',${clamp(Math.round(satisfaction / 20),1,5)},
          ${satisfaction >= 78
            ? "Atendimento regional acima das expectativas."
            : satisfaction >= 58
              ? "Experiência adequada para a demanda local."
              : "A operação precisa melhorar estoque, equipe ou qualidade."},
          ${cycleId}::uuid
        )
      `;
      await tx`
        UPDATE property_buildings SET
          condition=GREATEST(0,condition-1),updated_at=now()
        WHERE id=${input.buildingId}::uuid
      `;
      await tx`
        UPDATE marketing_campaigns SET
          conversions=conversions+${customers},
          attributed_revenue_minor=attributed_revenue_minor+${grossMinor}
        WHERE building_id=${input.buildingId}::uuid
          AND status='active' AND starts_at<=now() AND ends_at>now()
      `;
      await tx`
        INSERT INTO district_business_metrics (
          district_id,metric_date,visitors,customers,gross_revenue_minor,
          active_employees,average_reputation
        ) VALUES (
          ${String(row.district_id)}::uuid,current_date,${visitors},${customers},
          ${grossMinor},${employeeCount},${newReputation}
        )
        ON CONFLICT (district_id,metric_date) DO UPDATE SET
          visitors=district_business_metrics.visitors+EXCLUDED.visitors,
          customers=district_business_metrics.customers+EXCLUDED.customers,
          gross_revenue_minor=district_business_metrics.gross_revenue_minor+EXCLUDED.gross_revenue_minor,
          active_employees=GREATEST(district_business_metrics.active_employees,EXCLUDED.active_employees),
          average_reputation=ROUND(
            (district_business_metrics.average_reputation+EXCLUDED.average_reputation)/2,
            2
          ),
          updated_at=now()
      `;
      await this.updateGoals(tx, company.id, {
        revenue: grossMinor,
        customers,
        reputation: newReputation,
        stock: remainingStock,
        employeeSatisfaction: Math.round(averageSatisfaction)
      });
      await this.refreshAlerts(tx, {
        companyId: company.id,
        buildingId: input.buildingId,
        remainingStock,
        reorderPoint,
        buildingCondition: Math.max(0, Number(row.condition) - 1),
        averageSatisfaction: Math.round(averageSatisfaction)
      });
      await this.outbox(tx, cycleId, "business.regional-cycle.completed", {
        companyId: company.id,
        buildingId: input.buildingId,
        visitors,
        customers,
        grossMinor,
        remainingStock
      });
      return { cycleId };
    });
    return this.state(input.ownerId);
  }

  async acknowledgeAlert(input: {
    ownerId: string;
    alertId: string;
    idempotencyKey: string;
  }): Promise<RegionalBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      const rows = await tx`
        UPDATE business_alerts SET status='acknowledged',acknowledged_at=now()
        WHERE id=${input.alertId}::uuid AND company_id=${company.id}::uuid AND status='open'
        RETURNING id
      `;
      if (!rows[0]) throw new Error("Alerta aberto não encontrado.");
      return { acknowledged: true };
    });
    return this.state(input.ownerId);
  }

  private async ownedCompany(tx: Tx, ownerId: string): Promise<OwnedCompany> {
    const rows = await tx`
      SELECT company.id,company.name,company.owner_id,account.id account_id
      FROM companies company
      JOIN ledger_accounts account
        ON account.owner_id=company.owner_id AND account.account_type='company'
      WHERE company.owner_id=${ownerId}::uuid
      ORDER BY company.created_at,account.created_at LIMIT 1
      FOR UPDATE OF company,account
    `;
    const row = rows[0];
    if (!row) throw new Error("Empresa principal não encontrada.");
    return {
      id: String(row.id),
      name: String(row.name),
      ownerId: String(row.owner_id),
      accountId: String(row.account_id)
    };
  }

  private async companyAccountByOwner(
    tx: Tx,
    ownerId: string
  ): Promise<Readonly<{ id: string }>> {
    const rows = await tx`
      SELECT id FROM ledger_accounts
      WHERE owner_id=${ownerId}::uuid AND account_type='company'
      ORDER BY created_at LIMIT 1 FOR UPDATE
    `;
    if (!rows[0]) throw new Error("Conta empresarial do fornecedor não encontrada.");
    return { id: String(rows[0].id) };
  }

  private async assertOwnedBuilding(
    tx: Tx,
    companyId: string,
    buildingId: string
  ): Promise<void> {
    const rows = await tx`
      SELECT id FROM property_buildings
      WHERE id=${buildingId}::uuid AND company_id=${companyId}::uuid
      FOR UPDATE
    `;
    if (!rows[0]) throw new Error("Estabelecimento não pertence à empresa.");
  }

  private async assertAvailableBalance(
    tx: Tx,
    accountId: string,
    amountMinor: number
  ): Promise<void> {
    const rows = await tx`
      SELECT available_minor FROM ledger_account_balances
      WHERE account_id=${accountId}::uuid
    `;
    if (Number(rows[0]?.available_minor ?? 0) < amountMinor) {
      throw new Error("Caixa empresarial insuficiente.");
    }
  }

  private async updateGoals(
    tx: Tx,
    companyId: string,
    values: Readonly<{
      revenue: number;
      customers: number;
      reputation: number;
      stock: number;
      employeeSatisfaction: number;
    }>
  ): Promise<void> {
    const goals = await tx`
      SELECT * FROM company_goals
      WHERE company_id=${companyId}::uuid AND status='active'
      FOR UPDATE
    `;
    for (const goal of goals) {
      let next = Number(goal.current_value);
      const metric = String(goal.metric);
      if (metric === "revenue") next += values.revenue;
      if (metric === "customers") next += values.customers;
      if (metric === "reputation") next = values.reputation;
      if (metric === "stock") next = values.stock;
      if (metric === "employee_satisfaction") next = values.employeeSatisfaction;
      const completed = next >= Number(goal.target_value);
      await tx`
        UPDATE company_goals SET
          current_value=${Math.max(0, next)},
          status=${completed ? "completed" : "active"},
          completed_at=${completed ? new Date().toISOString() : null}::timestamptz
        WHERE id=${String(goal.id)}::uuid
      `;
    }
    await tx`
      UPDATE company_goals SET status='expired'
      WHERE company_id=${companyId}::uuid AND status='active' AND deadline_at<=now()
    `;
  }

  private async refreshAlerts(
    tx: Tx,
    input: Readonly<{
      companyId: string;
      buildingId: string;
      remainingStock: number;
      reorderPoint: number;
      buildingCondition: number;
      averageSatisfaction: number;
    }>
  ): Promise<void> {
    if (input.remainingStock <= input.reorderPoint) {
      await this.openAlert(tx, {
        companyId: input.companyId,
        buildingId: input.buildingId,
        code: `stock-low:${input.buildingId}`,
        severity: input.remainingStock === 0 ? "critical" : "warning",
        message: input.remainingStock === 0
          ? "Estoque comercial esgotado. Reposição B2B necessária."
          : "Estoque abaixo do ponto de reposição."
      });
    } else {
      await this.resolveAlert(tx, input.companyId, `stock-low:${input.buildingId}`);
    }
    if (input.buildingCondition < 45) {
      await this.openAlert(tx, {
        companyId: input.companyId,
        buildingId: input.buildingId,
        code: `condition-low:${input.buildingId}`,
        severity: input.buildingCondition < 25 ? "critical" : "warning",
        message: "Condição do estabelecimento exige manutenção."
      });
    }
    if (input.averageSatisfaction < 50) {
      await this.openAlert(tx, {
        companyId: input.companyId,
        buildingId: input.buildingId,
        code: "team-satisfaction-low",
        severity: "warning",
        message: "Satisfação média da equipe está abaixo do nível recomendado."
      });
    }
  }

  private async openAlert(
    tx: Tx,
    input: Readonly<{
      companyId: string;
      buildingId: string;
      code: string;
      severity: "info" | "warning" | "critical";
      message: string;
    }>
  ): Promise<void> {
    await tx`
      INSERT INTO business_alerts (
        id,company_id,building_id,code,severity,message
      ) VALUES (
        ${randomUUID()}::uuid,${input.companyId}::uuid,${input.buildingId}::uuid,
        ${input.code},${input.severity},${input.message}
      )
      ON CONFLICT (company_id,code) WHERE status='open' DO UPDATE SET
        severity=EXCLUDED.severity,message=EXCLUDED.message
    `;
  }

  private async resolveAlert(tx: Tx, companyId: string, code: string): Promise<void> {
    await tx`
      UPDATE business_alerts SET status='resolved'
      WHERE company_id=${companyId}::uuid AND code=${code} AND status='open'
    `;
  }
}
