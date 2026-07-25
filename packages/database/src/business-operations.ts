import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";

export type MarketplaceCatalogView = Readonly<{
  id: string;
  buildingId: string;
  code: string;
  title: string;
  description: string;
  category: string;
  unitPriceMinor: number;
  capacityPerCycle: number;
  status: string;
}>;

export type MarketplaceJobView = Readonly<{
  id: string;
  companyId: string;
  companyName: string;
  buildingId: string | null;
  roleCode: string;
  title: string;
  description: string;
  wageMinor: number;
  slots: number;
  filledSlots: number;
  status: string;
}>;

export type MarketplaceEmploymentView = Readonly<{
  id: string;
  companyId: string;
  companyName: string;
  roleCode: string;
  wageMinor: number;
  status: string;
}>;

export type SecondaryShareListingView = Readonly<{
  id: string;
  companyId: string;
  companyName: string;
  sellerId: string;
  sellerName: string;
  unitsTotal: number;
  unitsRemaining: number;
  unitPriceMinor: number;
  status: string;
  createdAt: string;
}>;

export type PublicCompanyView = Readonly<{
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  buildingId: string | null;
  buildingName: string | null;
  buildingType: string | null;
  level: number;
  condition: number;
  capacity: number;
  locationCode: string | null;
  locationName: string | null;
  districtCode: string | null;
  districtName: string | null;
  reputationScore: number;
  reviewCount: number;
  activeEmployees: number;
  recentVisitors: number;
  recentCustomers: number;
  recentRevenueMinor: number;
  latestNetResultMinor: number;
  riskScore: number;
  riskLabel: "baixo" | "médio" | "alto";
  catalog: readonly MarketplaceCatalogView[];
}>;

export type PublicMarketplaceState = Readonly<{
  actor: Readonly<{
    id: string;
    displayName: string;
    balanceMinor: number;
    currentLocationCode: string;
  }>;
  companies: readonly PublicCompanyView[];
  jobs: readonly MarketplaceJobView[];
  employments: readonly MarketplaceEmploymentView[];
  shareListings: readonly SecondaryShareListingView[];
  positions: readonly Readonly<{
    companyId: string;
    companyName: string;
    units: number;
    ownershipPercent: number;
    averageCostMinor: number;
  }>[];
}>;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export class BusinessOperationsService extends EconomyRepositoryBase {
  async state(ownerId: string): Promise<PublicMarketplaceState> {
    const [actorRows, companyRows, catalogRows, jobRows, employmentRows, listingRows, positionRows] =
      await Promise.all([
        this.sql`
          SELECT user_account.id,user_account.display_name,
                 location.code current_location_code,
                 COALESCE(balance.available_minor,0)::bigint balance_minor
          FROM users user_account
          JOIN player_world_state world ON world.user_id=user_account.id
          JOIN city_locations location ON location.id=world.location_id
          LEFT JOIN ledger_accounts account
            ON account.owner_id=user_account.id AND account.account_type='wallet'
          LEFT JOIN ledger_account_balances balance ON balance.account_id=account.id
          WHERE user_account.id=${ownerId}::uuid
          ORDER BY account.created_at LIMIT 1
        `,
        this.sql`
          SELECT company.id,company.name,company.owner_id,owner.display_name owner_name,
                 building.id building_id,building.name building_name,
                 building.building_type,COALESCE(building.level,0)::integer level,
                 COALESCE(building.condition,0)::integer condition,
                 COALESCE(building.capacity,0)::integer capacity,
                 location.code location_code,location.name location_name,
                 district.code district_code,district.name district_name,
                 COALESCE(reputation.score,50)::integer reputation_score,
                 COALESCE(reputation.review_count,0)::integer review_count,
                 COALESCE((
                   SELECT COUNT(*) FROM company_employments employment
                   WHERE employment.company_id=company.id AND employment.status='active'
                 ),0)::integer active_employees,
                 COALESCE((
                   SELECT SUM(cycle.visitors) FROM business_demand_cycles cycle
                   WHERE cycle.company_id=company.id AND cycle.created_at>=now()-interval '7 days'
                 ),0)::integer recent_visitors,
                 COALESCE((
                   SELECT SUM(cycle.customers) FROM business_demand_cycles cycle
                   WHERE cycle.company_id=company.id AND cycle.created_at>=now()-interval '7 days'
                 ),0)::integer recent_customers,
                 COALESCE((
                   SELECT SUM(cycle.gross_revenue_minor) FROM business_demand_cycles cycle
                   WHERE cycle.company_id=company.id AND cycle.created_at>=now()-interval '7 days'
                 ),0)::bigint recent_revenue_minor,
                 COALESCE((
                   SELECT cycle.net_result_minor FROM company_operating_cycles cycle
                   WHERE cycle.company_id=company.id ORDER BY cycle.created_at DESC LIMIT 1
                 ),0)::bigint latest_net_result_minor
          FROM companies company
          JOIN users owner ON owner.id=company.owner_id
          LEFT JOIN property_ownerships ownership ON ownership.company_id=company.id
          LEFT JOIN property_plots plot ON plot.id=ownership.plot_id
          LEFT JOIN property_buildings building ON building.plot_id=plot.id
          LEFT JOIN city_locations location ON location.id=plot.location_id
          LEFT JOIN city_districts district ON district.id=location.district_id
          LEFT JOIN company_reputation reputation ON reputation.company_id=company.id
          ORDER BY company.name
        `,
        this.sql`
          SELECT id,building_id,company_id,code,title,description,category,
                 unit_price_minor,capacity_per_cycle,status
          FROM business_catalog_entries
          WHERE status='active'
          ORDER BY company_id,title
        `,
        this.sql`
          SELECT opening.id,opening.company_id,company.name company_name,
                 opening.building_id,opening.role_code,opening.title,opening.description,
                 opening.wage_minor,opening.slots,opening.filled_slots,opening.status
          FROM company_job_openings opening
          JOIN companies company ON company.id=opening.company_id
          WHERE opening.status IN ('open','filled')
          ORDER BY opening.created_at
        `,
        this.sql`
          SELECT employment.id,employment.company_id,company.name company_name,
                 employment.role_code,employment.wage_minor,employment.status
          FROM company_employments employment
          JOIN companies company ON company.id=employment.company_id
          WHERE employment.user_id=${ownerId}::uuid
          ORDER BY employment.started_at DESC
        `,
        this.sql`
          SELECT listing.id,listing.company_id,company.name company_name,
                 listing.seller_id,seller.display_name seller_name,
                 listing.units_total,listing.units_remaining,listing.unit_price_minor,
                 listing.status,listing.created_at
          FROM company_share_market_listings listing
          JOIN companies company ON company.id=listing.company_id
          JOIN users seller ON seller.id=listing.seller_id
          WHERE listing.status='open'
          ORDER BY listing.unit_price_minor,listing.created_at
        `,
        this.sql`
          SELECT position.company_id,company.name company_name,position.units,
                 position.average_cost_minor,equity.total_units
          FROM company_equity_positions position
          JOIN companies company ON company.id=position.company_id
          JOIN company_equity equity ON equity.company_id=position.company_id
          WHERE position.user_id=${ownerId}::uuid AND position.units>0
          ORDER BY company.name
        `
      ]);

    const actor = actorRows[0];
    if (!actor) throw new Error("Jogador não encontrado.");

    const catalogByCompany = new Map<string, MarketplaceCatalogView[]>();
    for (const row of catalogRows) {
      const companyId = String(row.company_id);
      const entries = catalogByCompany.get(companyId) ?? [];
      entries.push({
        id: String(row.id),
        buildingId: String(row.building_id),
        code: String(row.code),
        title: String(row.title),
        description: String(row.description),
        category: String(row.category),
        unitPriceMinor: Number(row.unit_price_minor),
        capacityPerCycle: Number(row.capacity_per_cycle),
        status: String(row.status)
      });
      catalogByCompany.set(companyId, entries);
    }

    return {
      actor: {
        id: String(actor.id),
        displayName: String(actor.display_name),
        balanceMinor: Number(actor.balance_minor),
        currentLocationCode: String(actor.current_location_code)
      },
      companies: companyRows.map((row) => {
        const reputation = Number(row.reputation_score);
        const condition = Number(row.condition);
        const latestNet = Number(row.latest_net_result_minor);
        const employees = Number(row.active_employees);
        const hasCatalog = (catalogByCompany.get(String(row.id))?.length ?? 0) > 0;
        const riskScore = clamp(
          (condition > 0 && condition < 60 ? 25 : 0)
          + (latestNet < 0 ? 25 : 0)
          + (employees === 0 ? 15 : 0)
          + (!hasCatalog ? 15 : 0)
          + (reputation < 45 ? 20 : reputation < 60 ? 10 : 0),
          0,
          100
        );
        const riskLabel = riskScore >= 55 ? "alto" : riskScore >= 25 ? "médio" : "baixo";
        return {
          id: String(row.id),
          name: String(row.name),
          ownerId: String(row.owner_id),
          ownerName: String(row.owner_name),
          buildingId: row.building_id ? String(row.building_id) : null,
          buildingName: row.building_name ? String(row.building_name) : null,
          buildingType: row.building_type ? String(row.building_type) : null,
          level: Number(row.level),
          condition,
          capacity: Number(row.capacity),
          locationCode: row.location_code ? String(row.location_code) : null,
          locationName: row.location_name ? String(row.location_name) : null,
          districtCode: row.district_code ? String(row.district_code) : null,
          districtName: row.district_name ? String(row.district_name) : null,
          reputationScore: reputation,
          reviewCount: Number(row.review_count),
          activeEmployees: employees,
          recentVisitors: Number(row.recent_visitors),
          recentCustomers: Number(row.recent_customers),
          recentRevenueMinor: Number(row.recent_revenue_minor),
          latestNetResultMinor: latestNet,
          riskScore,
          riskLabel,
          catalog: catalogByCompany.get(String(row.id)) ?? []
        };
      }),
      jobs: jobRows.map((row) => ({
        id: String(row.id),
        companyId: String(row.company_id),
        companyName: String(row.company_name),
        buildingId: row.building_id ? String(row.building_id) : null,
        roleCode: String(row.role_code),
        title: String(row.title),
        description: String(row.description),
        wageMinor: Number(row.wage_minor),
        slots: Number(row.slots),
        filledSlots: Number(row.filled_slots),
        status: String(row.status)
      })),
      employments: employmentRows.map((row) => ({
        id: String(row.id),
        companyId: String(row.company_id),
        companyName: String(row.company_name),
        roleCode: String(row.role_code),
        wageMinor: Number(row.wage_minor),
        status: String(row.status)
      })),
      shareListings: listingRows.map((row) => ({
        id: String(row.id),
        companyId: String(row.company_id),
        companyName: String(row.company_name),
        sellerId: String(row.seller_id),
        sellerName: String(row.seller_name),
        unitsTotal: Number(row.units_total),
        unitsRemaining: Number(row.units_remaining),
        unitPriceMinor: Number(row.unit_price_minor),
        status: String(row.status),
        createdAt: new Date(String(row.created_at)).toISOString()
      })),
      positions: positionRows.map((row) => ({
        companyId: String(row.company_id),
        companyName: String(row.company_name),
        units: Number(row.units),
        ownershipPercent: Number(((Number(row.units) / Number(row.total_units)) * 100).toFixed(2)),
        averageCostMinor: Number(row.average_cost_minor)
      }))
    };
  }

  async configureCatalog(input: {
    ownerId: string;
    buildingId: string;
    code: string;
    title: string;
    description: string;
    category: "food" | "retail" | "services" | "creative" | "industrial";
    unitPriceMinor: number;
    capacityPerCycle: number;
    idempotencyKey: string;
  }): Promise<PublicMarketplaceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const building = await this.ownedBuilding(tx, input.ownerId, input.buildingId);
      await tx`
        INSERT INTO business_catalog_entries (
          id,building_id,company_id,code,title,description,category,
          unit_price_minor,capacity_per_cycle,status,created_by
        ) VALUES (
          ${randomUUID()}::uuid,${input.buildingId}::uuid,${building.companyId}::uuid,
          ${input.code},${input.title},${input.description},${input.category},
          ${input.unitPriceMinor},${input.capacityPerCycle},'active',${input.ownerId}::uuid
        )
        ON CONFLICT (building_id,code) DO UPDATE SET
          title=EXCLUDED.title,description=EXCLUDED.description,category=EXCLUDED.category,
          unit_price_minor=EXCLUDED.unit_price_minor,
          capacity_per_cycle=EXCLUDED.capacity_per_cycle,status='active',updated_at=now()
      `;
      await this.outbox(tx, input.buildingId, "business.catalog.configured", {
        ownerId: input.ownerId,
        companyId: building.companyId,
        buildingId: input.buildingId,
        code: input.code,
        category: input.category,
        unitPriceMinor: input.unitPriceMinor
      });
      return { configured: true };
    });
    return this.state(input.ownerId);
  }

  async runDemandCycle(input: {
    ownerId: string;
    buildingId: string;
    idempotencyKey: string;
  }): Promise<PublicMarketplaceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const building = await this.ownedBuilding(tx, input.ownerId, input.buildingId);
      const rows = await tx`
        SELECT catalog.id catalog_id,catalog.category,catalog.unit_price_minor,
               catalog.capacity_per_cycle,building.level,building.condition,building.capacity,
               district.id district_id,profile.base_visitors,profile.reference_price_minor,
               profile.price_sensitivity,profile.quality_weight,profile.seasonality,
               COALESCE(reputation.score,50)::integer reputation_score,
               COALESCE((SELECT COUNT(*) FROM company_employments employment
                 WHERE employment.company_id=building.company_id AND employment.status='active'),0)::integer employees
        FROM property_buildings building
        JOIN property_plots plot ON plot.id=building.plot_id
        JOIN city_locations location ON location.id=plot.location_id
        JOIN city_districts district ON district.id=location.district_id
        JOIN business_catalog_entries catalog ON catalog.building_id=building.id AND catalog.status='active'
        JOIN district_demand_profiles profile
          ON profile.district_id=district.id AND profile.category=catalog.category
        LEFT JOIN company_reputation reputation ON reputation.company_id=building.company_id
        WHERE building.id=${input.buildingId}::uuid
        ORDER BY catalog.created_at LIMIT 1
        FOR UPDATE OF building,catalog
      `;
      const row = rows[0];
      if (!row) throw new Error("Configure um item compatível com a demanda do distrito.");

      const level = Number(row.level);
      const condition = Number(row.condition);
      const employees = Number(row.employees);
      const reputation = Number(row.reputation_score);
      const price = Number(row.unit_price_minor);
      const referencePrice = Number(row.reference_price_minor);
      const priceSensitivity = Number(row.price_sensitivity);
      const qualityWeight = Number(row.quality_weight);
      const seasonality = Number(row.seasonality);
      const priceRatio = referencePrice / Math.max(price, 1);
      const priceFactor = clamp(Math.pow(priceRatio, priceSensitivity), 0.45, 1.55);
      const qualityScore = clamp(
        Math.round((condition * 0.45 + level * 8 + employees * 5 + reputation * 0.35) * qualityWeight),
        0,
        100
      );
      const visitors = Math.max(1, Math.min(
        Number(row.capacity) + employees * 4,
        Math.round(Number(row.base_visitors) * seasonality * priceFactor * (0.72 + level * 0.11))
      ));
      const conversionRate = clamp(0.2 + qualityScore / 170, 0.2, 0.88);
      const customers = Math.max(1, Math.min(
        Number(row.capacity_per_cycle),
        Math.round(visitors * conversionRate)
      ));
      const grossMinor = customers * price;
      const taxMinor = Math.round(grossMinor * 0.03);
      const companyNetMinor = grossMinor - taxMinor;
      const companyAccount = await this.companyAccount(tx, building.companyId);
      const cityAccountId = await this.cityAccountId(tx);
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:ledger`,
        type: "npc-business-demand",
        entries: [
          { accountCode: "system.issuance", amount: -grossMinor, memo: "Consumo NPC" },
          { accountId: companyAccount.id, amount: companyNetMinor, memo: "Receita de clientes NPC" },
          { accountId: cityAccountId, amount: taxMinor, memo: "Tributo sobre consumo" }
        ]
      });

      const satisfaction = clamp(Math.round(qualityScore - Math.max(0, (price / referencePrice - 1) * 28)), 0, 100);
      const oldScore = reputation;
      const newScore = clamp(Math.round(oldScore * 0.8 + satisfaction * 0.2), 0, 100);
      const reputationDelta = newScore - oldScore;
      const cycleId = randomUUID();
      await tx`
        INSERT INTO business_demand_cycles (
          id,catalog_entry_id,company_id,building_id,visitors,customers,
          gross_revenue_minor,tax_minor,satisfaction,reputation_delta,
          ledger_transaction_id,idempotency_key
        ) VALUES (
          ${cycleId}::uuid,${String(row.catalog_id)}::uuid,${building.companyId}::uuid,
          ${input.buildingId}::uuid,${visitors},${customers},${grossMinor},${taxMinor},
          ${satisfaction},${reputationDelta},${ledgerTransactionId}::uuid,${input.idempotencyKey}
        )
      `;
      const rating = clamp(Math.round(satisfaction / 20), 1, 5);
      await tx`
        INSERT INTO company_reviews (
          id,company_id,building_id,source,rating,comment,demand_cycle_id
        ) VALUES (
          ${randomUUID()}::uuid,${building.companyId}::uuid,${input.buildingId}::uuid,
          'npc',${rating},${this.reviewComment(rating)},${cycleId}::uuid
        )
      `;
      await tx`
        INSERT INTO company_reputation (company_id,score,review_count)
        VALUES (${building.companyId}::uuid,${newScore},1)
        ON CONFLICT (company_id) DO UPDATE SET
          score=${newScore},review_count=company_reputation.review_count+1,updated_at=now()
      `;
      await tx`
        UPDATE property_buildings SET condition=GREATEST(condition-2,0),updated_at=now()
        WHERE id=${input.buildingId}::uuid
      `;
      await this.outbox(tx, cycleId, "business.demand.cycle-settled", {
        companyId: building.companyId,
        buildingId: input.buildingId,
        visitors,
        customers,
        grossMinor,
        satisfaction,
        reputationDelta
      });
      return { visitors, customers, grossMinor, satisfaction };
    });
    return this.state(input.ownerId);
  }

  async createJobOpening(input: {
    ownerId: string;
    companyId: string;
    buildingId?: string;
    roleCode: string;
    title: string;
    description: string;
    wageMinor: number;
    slots: number;
    idempotencyKey: string;
  }): Promise<PublicMarketplaceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.ownedCompany(tx, input.ownerId, input.companyId);
      if (input.buildingId) await this.ownedBuilding(tx, input.ownerId, input.buildingId);
      const openingId = randomUUID();
      await tx`
        INSERT INTO company_job_openings (
          id,company_id,building_id,role_code,title,description,wage_minor,
          slots,filled_slots,status,idempotency_key
        ) VALUES (
          ${openingId}::uuid,${input.companyId}::uuid,${input.buildingId ?? null}::uuid,
          ${input.roleCode},${input.title},${input.description},${input.wageMinor},
          ${input.slots},0,'open',${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, openingId, "business.job.opened", {
        companyId: input.companyId,
        roleCode: input.roleCode,
        wageMinor: input.wageMinor,
        slots: input.slots
      });
      return { opened: true };
    });
    return this.state(input.ownerId);
  }

  async acceptJob(input: {
    ownerId: string;
    openingId: string;
    idempotencyKey: string;
  }): Promise<PublicMarketplaceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const rows = await tx`
        SELECT opening.*,company.owner_id company_owner_id
        FROM company_job_openings opening
        JOIN companies company ON company.id=opening.company_id
        WHERE opening.id=${input.openingId}::uuid
        FOR UPDATE OF opening
      `;
      const opening = rows[0];
      if (!opening || String(opening.status) !== "open") throw new Error("Vaga não está aberta.");
      if (String(opening.company_owner_id) === input.ownerId) throw new Error("O proprietário não pode ocupar esta vaga.");
      if (Number(opening.filled_slots) >= Number(opening.slots)) throw new Error("Vaga já foi preenchida.");

      const employmentId = randomUUID();
      await tx`
        INSERT INTO company_employments (
          id,company_id,opening_id,user_id,role_code,wage_minor,status
        ) VALUES (
          ${employmentId}::uuid,${String(opening.company_id)}::uuid,
          ${input.openingId}::uuid,${input.ownerId}::uuid,
          ${String(opening.role_code)},${Number(opening.wage_minor)},'active'
        )
      `;
      await tx`
        UPDATE company_job_openings SET
          filled_slots=filled_slots+1,
          status=CASE WHEN filled_slots+1>=slots THEN 'filled' ELSE 'open' END,
          closed_at=CASE WHEN filled_slots+1>=slots THEN now() ELSE NULL END
        WHERE id=${input.openingId}::uuid
      `;
      await this.outbox(tx, employmentId, "business.employment.started", {
        companyId: String(opening.company_id),
        userId: input.ownerId,
        roleCode: String(opening.role_code),
        wageMinor: Number(opening.wage_minor)
      });
      return { accepted: true };
    });
    return this.state(input.ownerId);
  }

  async runPayroll(input: {
    ownerId: string;
    companyId: string;
    idempotencyKey: string;
  }): Promise<PublicMarketplaceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.ownedCompany(tx, input.ownerId, input.companyId);
      const employees = await tx`
        SELECT employment.id,employment.user_id,employment.wage_minor,
               account.id wallet_account_id
        FROM company_employments employment
        JOIN ledger_accounts account
          ON account.owner_id=employment.user_id AND account.account_type='wallet'
        WHERE employment.company_id=${input.companyId}::uuid AND employment.status='active'
        ORDER BY employment.started_at
        FOR UPDATE OF employment
      `;
      if (employees.length === 0) throw new Error("Empresa não possui empregados ativos.");
      const companyAccount = await this.companyAccount(tx, input.companyId);
      const totalWagesMinor = employees.reduce((sum, row) => sum + Number(row.wage_minor), 0);
      const payrollTaxMinor = Math.round(totalWagesMinor * 0.02);
      await this.assertAvailableBalance(tx, companyAccount.id, totalWagesMinor + payrollTaxMinor);
      const cityAccountId = await this.cityAccountId(tx);
      const entries = [
        { accountId: companyAccount.id, amount: -(totalWagesMinor + payrollTaxMinor), memo: "Folha salarial" },
        ...employees.map((row) => ({
          accountId: String(row.wallet_account_id),
          amount: Number(row.wage_minor),
          memo: "Salário empresarial"
        })),
        { accountId: cityAccountId, amount: payrollTaxMinor, memo: "Tributo sobre folha" }
      ];
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:ledger`,
        type: "company-payroll",
        entries
      });
      const payrollRunId = randomUUID();
      await tx`
        INSERT INTO company_payroll_runs (
          id,company_id,total_wages_minor,payroll_tax_minor,employee_count,
          ledger_transaction_id,idempotency_key
        ) VALUES (
          ${payrollRunId}::uuid,${input.companyId}::uuid,${totalWagesMinor},
          ${payrollTaxMinor},${employees.length},${ledgerTransactionId}::uuid,
          ${input.idempotencyKey}
        )
      `;
      for (const employee of employees) {
        await tx`
          INSERT INTO company_payroll_payments (
            payroll_run_id,employment_id,user_id,wage_minor
          ) VALUES (
            ${payrollRunId}::uuid,${String(employee.id)}::uuid,
            ${String(employee.user_id)}::uuid,${Number(employee.wage_minor)}
          )
        `;
      }
      await this.outbox(tx, payrollRunId, "business.payroll.settled", {
        companyId: input.companyId,
        employeeCount: employees.length,
        totalWagesMinor,
        payrollTaxMinor
      });
      return { settled: true };
    });
    return this.state(input.ownerId);
  }

  async createShareListing(input: {
    ownerId: string;
    companyId: string;
    units: number;
    unitPriceMinor: number;
    idempotencyKey: string;
  }): Promise<PublicMarketplaceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const positions = await tx`
        SELECT units FROM company_equity_positions
        WHERE company_id=${input.companyId}::uuid AND user_id=${input.ownerId}::uuid
        FOR UPDATE
      `;
      const ownedUnits = Number(positions[0]?.units ?? 0);
      const listedRows = await tx`
        SELECT COALESCE(SUM(units_remaining),0)::integer listed_units
        FROM company_share_market_listings
        WHERE company_id=${input.companyId}::uuid AND seller_id=${input.ownerId}::uuid AND status='open'
      `;
      const availableUnits = ownedUnits - Number(listedRows[0]?.listed_units ?? 0);
      if (input.units <= 0 || input.units > availableUnits) throw new Error("Unidades disponíveis insuficientes.");
      const listingId = randomUUID();
      await tx`
        INSERT INTO company_share_market_listings (
          id,company_id,seller_id,units_total,units_remaining,
          unit_price_minor,status,idempotency_key
        ) VALUES (
          ${listingId}::uuid,${input.companyId}::uuid,${input.ownerId}::uuid,
          ${input.units},${input.units},${input.unitPriceMinor},'open',${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, listingId, "business.share-market.listed", {
        companyId: input.companyId,
        sellerId: input.ownerId,
        units: input.units,
        unitPriceMinor: input.unitPriceMinor
      });
      return { listed: true };
    });
    return this.state(input.ownerId);
  }

  async buyShareListing(input: {
    ownerId: string;
    listingId: string;
    units: number;
    idempotencyKey: string;
  }): Promise<PublicMarketplaceState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const rows = await tx`
        SELECT listing.*,company.owner_id company_owner_id,equity.total_units,equity.outside_limit_units
        FROM company_share_market_listings listing
        JOIN companies company ON company.id=listing.company_id
        JOIN company_equity equity ON equity.company_id=listing.company_id
        WHERE listing.id=${input.listingId}::uuid
        FOR UPDATE OF listing
      `;
      const listing = rows[0];
      if (!listing || String(listing.status) !== "open") throw new Error("Oferta secundária não está aberta.");
      if (String(listing.seller_id) === input.ownerId) throw new Error("Não é possível comprar a própria oferta.");
      if (input.units <= 0 || input.units > Number(listing.units_remaining)) throw new Error("Quantidade indisponível.");

      const companyId = String(listing.company_id);
      const sellerId = String(listing.seller_id);
      const companyOwnerId = String(listing.company_owner_id);
      const positionRows = await tx`
        SELECT user_id,units,average_cost_minor
        FROM company_equity_positions
        WHERE company_id=${companyId}::uuid
        FOR UPDATE
      `;
      const outsideCurrent = positionRows
        .filter((row) => String(row.user_id) !== companyOwnerId)
        .reduce((sum, row) => sum + Number(row.units), 0);
      const outsideDelta = input.ownerId !== companyOwnerId ? input.units : 0;
      const outsideReduction = sellerId !== companyOwnerId ? input.units : 0;
      const outsideAfter = outsideCurrent + outsideDelta - outsideReduction;
      if (outsideAfter > Number(listing.outside_limit_units)) throw new Error("Limite de participação externa excedido.");

      const grossMinor = input.units * Number(listing.unit_price_minor);
      const buyerWallet = await this.walletAccount(tx, input.ownerId);
      const sellerWallet = await this.walletAccount(tx, sellerId);
      await this.assertAvailableBalance(tx, buyerWallet.id, grossMinor);
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:ledger`,
        type: "secondary-share-trade",
        entries: [
          { accountId: buyerWallet.id, amount: -grossMinor, memo: "Compra de participação interna" },
          { accountId: sellerWallet.id, amount: grossMinor, memo: "Venda de participação interna" }
        ]
      });

      const sellerPosition = positionRows.find((row) => String(row.user_id) === sellerId);
      if (!sellerPosition || Number(sellerPosition.units) < input.units) throw new Error("Vendedor não possui as unidades informadas.");
      const buyerPosition = positionRows.find((row) => String(row.user_id) === input.ownerId);
      const buyerOldUnits = Number(buyerPosition?.units ?? 0);
      const buyerOldAverage = Number(buyerPosition?.average_cost_minor ?? 0);
      const buyerNewUnits = buyerOldUnits + input.units;
      const buyerAverage = Math.round((buyerOldAverage * buyerOldUnits + grossMinor) / buyerNewUnits);

      await tx`
        UPDATE company_equity_positions SET units=units-${input.units},updated_at=now()
        WHERE company_id=${companyId}::uuid AND user_id=${sellerId}::uuid AND units>=${input.units}
      `;
      await tx`
        INSERT INTO company_equity_positions (company_id,user_id,units,average_cost_minor)
        VALUES (${companyId}::uuid,${input.ownerId}::uuid,${input.units},${buyerAverage})
        ON CONFLICT (company_id,user_id) DO UPDATE SET
          units=company_equity_positions.units+${input.units},
          average_cost_minor=${buyerAverage},updated_at=now()
      `;
      const remaining = Number(listing.units_remaining) - input.units;
      await tx`
        UPDATE company_share_market_listings SET
          units_remaining=${remaining},
          status=CASE WHEN ${remaining}=0 THEN 'filled' ELSE 'open' END,
          closed_at=CASE WHEN ${remaining}=0 THEN now() ELSE NULL END
        WHERE id=${input.listingId}::uuid
      `;
      const tradeId = randomUUID();
      await tx`
        INSERT INTO company_share_market_trades (
          id,listing_id,company_id,seller_id,buyer_id,units,unit_price_minor,
          gross_minor,ledger_transaction_id,idempotency_key
        ) VALUES (
          ${tradeId}::uuid,${input.listingId}::uuid,${companyId}::uuid,
          ${sellerId}::uuid,${input.ownerId}::uuid,${input.units},
          ${Number(listing.unit_price_minor)},${grossMinor},${ledgerTransactionId}::uuid,
          ${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, tradeId, "business.share-market.traded", {
        companyId,
        sellerId,
        buyerId: input.ownerId,
        units: input.units,
        grossMinor
      });
      return { traded: true };
    });
    return this.state(input.ownerId);
  }

  private async ownedCompany(tx: Tx, ownerId: string, companyId: string): Promise<void> {
    const rows = await tx`
      SELECT id FROM companies WHERE id=${companyId}::uuid AND owner_id=${ownerId}::uuid
      FOR UPDATE
    `;
    if (!rows[0]) throw new Error("Empresa não pertence ao jogador.");
  }

  private async ownedBuilding(
    tx: Tx,
    ownerId: string,
    buildingId: string
  ): Promise<Readonly<{ companyId: string }>> {
    const rows = await tx`
      SELECT building.company_id
      FROM property_buildings building
      JOIN companies company ON company.id=building.company_id
      WHERE building.id=${buildingId}::uuid AND company.owner_id=${ownerId}::uuid
      FOR UPDATE OF building
    `;
    if (!rows[0]) throw new Error("Estabelecimento não pertence ao jogador.");
    return { companyId: String(rows[0].company_id) };
  }

  private async companyAccount(
    tx: Tx,
    companyId: string
  ): Promise<Readonly<{ id: string }>> {
    const rows = await tx`
      SELECT account.id
      FROM companies company
      JOIN ledger_accounts account
        ON account.owner_id=company.owner_id AND account.account_type='company'
      WHERE company.id=${companyId}::uuid
      ORDER BY account.created_at LIMIT 1 FOR UPDATE OF account
    `;
    if (!rows[0]) throw new Error("Conta empresarial não encontrada.");
    return { id: String(rows[0].id) };
  }

  private async assertAvailableBalance(tx: Tx, accountId: string, amountMinor: number): Promise<void> {
    const rows = await tx`
      SELECT available_minor FROM ledger_account_balances WHERE account_id=${accountId}::uuid
    `;
    if (Number(rows[0]?.available_minor ?? 0) < amountMinor) throw new Error("Saldo disponível insuficiente.");
  }

  private reviewComment(rating: number): string {
    if (rating >= 5) return "Experiência excelente e atendimento memorável.";
    if (rating === 4) return "Boa experiência, com qualidade consistente.";
    if (rating === 3) return "Atendimento adequado, mas ainda pode melhorar.";
    if (rating === 2) return "Preço ou qualidade ficaram abaixo do esperado.";
    return "Experiência insatisfatória para este perfil de cliente.";
  }
}
