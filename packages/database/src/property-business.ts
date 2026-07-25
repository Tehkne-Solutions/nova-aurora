import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";

export type PropertyPlotView = Readonly<{
  id: string;
  code: string;
  locationCode: string;
  locationName: string;
  name: string;
  propertyType: string;
  sizeClass: string;
  baseValueMinor: number;
  constructionCostMinor: number;
  maintenanceMinor: number;
  status: string;
  maxLevel: number;
  ownerCompanyId: string | null;
  ownerCompanyName: string | null;
  building: BusinessBuildingView | null;
  recentVisits: number;
}>;

export type BusinessBuildingView = Readonly<{
  id: string;
  plotCode: string;
  companyId: string;
  name: string;
  buildingType: string;
  level: number;
  condition: number;
  capacity: number;
  status: string;
}>;

export type ShareOfferingView = Readonly<{
  id: string;
  companyId: string;
  companyName: string;
  ownerId: string;
  unitsTotal: number;
  unitsRemaining: number;
  unitPriceMinor: number;
  status: string;
  createdAt: string;
}>;

export type EquityPositionView = Readonly<{
  companyId: string;
  companyName: string;
  ownerId: string;
  units: number;
  totalUnits: number;
  ownershipPercent: number;
  averageCostMinor: number;
}>;

export type OperatingCycleView = Readonly<{
  id: string;
  buildingId: string;
  cycleNumber: number;
  revenueMinor: number;
  operatingCostMinor: number;
  maintenanceMinor: number;
  taxMinor: number;
  netResultMinor: number;
  status: string;
  createdAt: string;
}>;

export type PropertyBusinessState = Readonly<{
  actor: Readonly<{
    id: string;
    displayName: string;
    balanceMinor: number;
    currentLocationCode: string;
  }>;
  company: Readonly<{
    id: string;
    name: string;
    ownerId: string;
    isOwner: boolean;
    accountBalanceMinor: number;
    totalUnits: number;
    outsideLimitUnits: number;
    ownedUnits: number;
    ownershipPercent: number;
  }>;
  plots: readonly PropertyPlotView[];
  portfolio: readonly EquityPositionView[];
  offerings: readonly ShareOfferingView[];
  cycles: readonly OperatingCycleView[];
  distributionsReceivedMinor: number;
}>;

type CompanyRow = Readonly<{
  id: unknown;
  owner_id: unknown;
  name: unknown;
}>;

export class PropertyBusinessService extends EconomyRepositoryBase {
  async state(ownerId: string): Promise<PropertyBusinessState> {
    const [actorRows, companyRows, plotRows, portfolioRows, offeringRows, cycleRows, distributionRows] =
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
          SELECT company.id,company.owner_id,company.name,
                 equity.total_units,equity.outside_limit_units,
                 COALESCE(position.units,0)::integer owned_units,
                 COALESCE(account_balance.available_minor,0)::bigint company_balance_minor
          FROM companies company
          JOIN company_equity equity ON equity.company_id=company.id
          LEFT JOIN company_equity_positions position
            ON position.company_id=company.id AND position.user_id=${ownerId}::uuid
          LEFT JOIN ledger_accounts account
            ON account.owner_id=company.owner_id AND account.account_type='company'
          LEFT JOIN ledger_account_balances account_balance ON account_balance.account_id=account.id
          WHERE company.owner_id=${ownerId}::uuid
          ORDER BY company.created_at LIMIT 1
        `,
        this.sql`
          SELECT plot.id,plot.code,plot.name,plot.property_type,plot.size_class,
                 plot.base_value_minor,plot.construction_cost_minor,plot.maintenance_minor,
                 plot.status,plot.max_level,location.code location_code,location.name location_name,
                 ownership.company_id,company.name owner_company_name,
                 building.id building_id,building.name building_name,
                 building.building_type,building.level,building.condition,
                 building.capacity,building.status building_status,
                 COALESCE((
                   SELECT COUNT(*) FROM property_visits visit
                   WHERE visit.plot_id=plot.id AND visit.visited_at>=now()-interval '7 days'
                 ),0)::integer recent_visits
          FROM property_plots plot
          JOIN city_locations location ON location.id=plot.location_id
          LEFT JOIN property_ownerships ownership ON ownership.plot_id=plot.id
          LEFT JOIN companies company ON company.id=ownership.company_id
          LEFT JOIN property_buildings building ON building.plot_id=plot.id
          ORDER BY location.name,plot.name
        `,
        this.sql`
          SELECT position.company_id,company.name,company.owner_id,position.units,
                 position.average_cost_minor,equity.total_units
          FROM company_equity_positions position
          JOIN companies company ON company.id=position.company_id
          JOIN company_equity equity ON equity.company_id=position.company_id
          WHERE position.user_id=${ownerId}::uuid AND position.units>0
          ORDER BY company.name
        `,
        this.sql`
          SELECT offering.id,offering.company_id,company.name company_name,
                 company.owner_id,offering.units_total,offering.units_remaining,
                 offering.unit_price_minor,offering.status,offering.created_at
          FROM company_share_offerings offering
          JOIN companies company ON company.id=offering.company_id
          WHERE offering.status='open'
          ORDER BY offering.created_at
        `,
        this.sql`
          SELECT cycle.id,cycle.building_id,cycle.cycle_number,cycle.revenue_minor,
                 cycle.operating_cost_minor,cycle.maintenance_minor,cycle.tax_minor,
                 cycle.net_result_minor,cycle.status,cycle.created_at
          FROM company_operating_cycles cycle
          JOIN companies company ON company.id=cycle.company_id
          WHERE company.owner_id=${ownerId}::uuid
          ORDER BY cycle.created_at DESC LIMIT 20
        `,
        this.sql`
          SELECT COALESCE(SUM(payment.amount_minor),0)::bigint total_minor
          FROM company_distribution_payments payment
          WHERE payment.user_id=${ownerId}::uuid
        `
      ]);

    const actor = actorRows[0];
    const company = companyRows[0];
    if (!actor) throw new Error("Jogador não encontrado.");
    if (!company) throw new Error("Empresa principal não encontrada.");

    const totalUnits = Number(company.total_units);
    const ownedUnits = Number(company.owned_units);

    return {
      actor: {
        id: String(actor.id),
        displayName: String(actor.display_name),
        balanceMinor: Number(actor.balance_minor),
        currentLocationCode: String(actor.current_location_code)
      },
      company: {
        id: String(company.id),
        name: String(company.name),
        ownerId: String(company.owner_id),
        isOwner: String(company.owner_id) === ownerId,
        accountBalanceMinor: Number(company.company_balance_minor),
        totalUnits,
        outsideLimitUnits: Number(company.outside_limit_units),
        ownedUnits,
        ownershipPercent: this.percent(ownedUnits, totalUnits)
      },
      plots: plotRows.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        locationCode: String(row.location_code),
        locationName: String(row.location_name),
        name: String(row.name),
        propertyType: String(row.property_type),
        sizeClass: String(row.size_class),
        baseValueMinor: Number(row.base_value_minor),
        constructionCostMinor: Number(row.construction_cost_minor),
        maintenanceMinor: Number(row.maintenance_minor),
        status: String(row.status),
        maxLevel: Number(row.max_level),
        ownerCompanyId: row.company_id ? String(row.company_id) : null,
        ownerCompanyName: row.owner_company_name ? String(row.owner_company_name) : null,
        building: row.building_id ? {
          id: String(row.building_id),
          plotCode: String(row.code),
          companyId: String(row.company_id),
          name: String(row.building_name),
          buildingType: String(row.building_type),
          level: Number(row.level),
          condition: Number(row.condition),
          capacity: Number(row.capacity),
          status: String(row.building_status)
        } : null,
        recentVisits: Number(row.recent_visits)
      })),
      portfolio: portfolioRows.map((row) => ({
        companyId: String(row.company_id),
        companyName: String(row.name),
        ownerId: String(row.owner_id),
        units: Number(row.units),
        totalUnits: Number(row.total_units),
        ownershipPercent: this.percent(Number(row.units), Number(row.total_units)),
        averageCostMinor: Number(row.average_cost_minor)
      })),
      offerings: offeringRows.map((row) => ({
        id: String(row.id),
        companyId: String(row.company_id),
        companyName: String(row.company_name),
        ownerId: String(row.owner_id),
        unitsTotal: Number(row.units_total),
        unitsRemaining: Number(row.units_remaining),
        unitPriceMinor: Number(row.unit_price_minor),
        status: String(row.status),
        createdAt: new Date(String(row.created_at)).toISOString()
      })),
      cycles: cycleRows.map((row) => ({
        id: String(row.id),
        buildingId: String(row.building_id),
        cycleNumber: Number(row.cycle_number),
        revenueMinor: Number(row.revenue_minor),
        operatingCostMinor: Number(row.operating_cost_minor),
        maintenanceMinor: Number(row.maintenance_minor),
        taxMinor: Number(row.tax_minor),
        netResultMinor: Number(row.net_result_minor),
        status: String(row.status),
        createdAt: new Date(String(row.created_at)).toISOString()
      })),
      distributionsReceivedMinor: Number(distributionRows[0]?.total_minor ?? 0)
    };
  }

  async acquirePlot(input: {
    ownerId: string;
    plotCode: string;
    idempotencyKey: string;
  }): Promise<PropertyBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      const plots = await tx`
        SELECT plot.id,plot.code,plot.location_id,plot.base_value_minor,plot.status,
               location.code location_code
        FROM property_plots plot
        JOIN city_locations location ON location.id=plot.location_id
        WHERE plot.code=${input.plotCode}
        FOR UPDATE OF plot
      `;
      const plot = plots[0];
      if (!plot) throw new Error("Terreno não encontrado.");
      if (String(plot.status) !== "available") throw new Error("Terreno não está disponível.");
      await this.assertLocation(tx, input.ownerId, String(plot.location_code));

      const wallet = await this.walletAccount(tx, input.ownerId);
      const cityAccountId = await this.cityAccountId(tx);
      const price = Number(plot.base_value_minor);
      await this.assertAvailableBalance(tx, wallet.id, price);

      await this.postLedger(tx, {
        key: `${input.idempotencyKey}:purchase`,
        type: "property-purchase",
        entries: [
          { accountId: wallet.id, amount: -price, memo: `Aquisição ${input.plotCode}` },
          { accountId: cityAccountId, amount: price, memo: `Concessão ${input.plotCode}` }
        ]
      });
      await tx`
        INSERT INTO property_ownerships (
          plot_id,company_id,acquired_by,acquired_price_minor
        ) VALUES (
          ${String(plot.id)}::uuid,${company.id}::uuid,
          ${input.ownerId}::uuid,${price}
        )
      `;
      await tx`UPDATE property_plots SET status='owned' WHERE id=${String(plot.id)}::uuid`;
      await this.outbox(tx, String(plot.id), "property.plot.acquired", {
        ownerId: input.ownerId,
        companyId: company.id,
        plotCode: input.plotCode,
        priceMinor: price
      });
      return { acquired: true };
    });
    return this.state(input.ownerId);
  }

  async constructBuilding(input: {
    ownerId: string;
    plotCode: string;
    buildingType: string;
    name: string;
    idempotencyKey: string;
  }): Promise<PropertyBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      const rows = await tx`
        SELECT plot.id,plot.code,plot.construction_cost_minor,location.code location_code,
               ownership.company_id,building.id building_id
        FROM property_plots plot
        JOIN city_locations location ON location.id=plot.location_id
        JOIN property_ownerships ownership ON ownership.plot_id=plot.id
        LEFT JOIN property_buildings building ON building.plot_id=plot.id
        WHERE plot.code=${input.plotCode}
        FOR UPDATE OF plot,ownership
      `;
      const plot = rows[0];
      if (!plot) throw new Error("Adquira o terreno antes de construir.");
      if (String(plot.company_id) !== company.id) throw new Error("Terreno pertence a outra empresa.");
      if (plot.building_id) throw new Error("O terreno já possui uma construção.");
      await this.assertLocation(tx, input.ownerId, String(plot.location_code));

      const wallet = await this.walletAccount(tx, input.ownerId);
      const cityAccountId = await this.cityAccountId(tx);
      const cost = Number(plot.construction_cost_minor);
      await this.assertAvailableBalance(tx, wallet.id, cost);
      await this.postLedger(tx, {
        key: `${input.idempotencyKey}:construction`,
        type: "property-construction",
        entries: [
          { accountId: wallet.id, amount: -cost, memo: `Construção ${input.name}` },
          { accountId: cityAccountId, amount: cost, memo: `Licença e obra ${input.name}` }
        ]
      });

      const buildingId = randomUUID();
      await tx`
        INSERT INTO property_buildings (
          id,plot_id,company_id,building_type,name,level,condition,capacity,status
        ) VALUES (
          ${buildingId}::uuid,${String(plot.id)}::uuid,${company.id}::uuid,
          ${input.buildingType},${input.name},1,100,10,'active'
        )
      `;
      await this.outbox(tx, buildingId, "property.building.completed", {
        ownerId: input.ownerId,
        companyId: company.id,
        plotCode: input.plotCode,
        buildingType: input.buildingType,
        name: input.name,
        costMinor: cost
      });
      return { built: true, buildingId };
    });
    return this.state(input.ownerId);
  }

  async visitProperty(input: {
    ownerId: string;
    plotCode: string;
    idempotencyKey: string;
  }): Promise<PropertyBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const rows = await tx`
        SELECT plot.id,location.code location_code
        FROM property_plots plot
        JOIN city_locations location ON location.id=plot.location_id
        JOIN property_buildings building ON building.plot_id=plot.id AND building.status='active'
        WHERE plot.code=${input.plotCode}
      `;
      const plot = rows[0];
      if (!plot) throw new Error("Estabelecimento não está aberto.");
      await this.assertLocation(tx, input.ownerId, String(plot.location_code));
      await tx`
        INSERT INTO property_visits (id,plot_id,visitor_id,idempotency_key)
        VALUES (
          ${randomUUID()}::uuid,${String(plot.id)}::uuid,
          ${input.ownerId}::uuid,${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, String(plot.id), "property.visited", {
        visitorId: input.ownerId,
        plotCode: input.plotCode
      });
      return { visited: true };
    });
    return this.state(input.ownerId);
  }

  async runOperatingCycle(input: {
    ownerId: string;
    buildingId: string;
    idempotencyKey: string;
  }): Promise<PropertyBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      const rows = await tx`
        SELECT building.id,building.level,building.condition,building.capacity,
               building.status,plot.maintenance_minor,
               COALESCE((
                 SELECT COUNT(*) FROM property_visits visit
                 WHERE visit.plot_id=plot.id AND visit.visited_at>=now()-interval '7 days'
               ),0)::integer visits,
               COALESCE((
                 SELECT MAX(cycle_number) FROM company_operating_cycles cycle
                 WHERE cycle.company_id=building.company_id
               ),0)::integer previous_cycle
        FROM property_buildings building
        JOIN property_plots plot ON plot.id=building.plot_id
        WHERE building.id=${input.buildingId}::uuid
          AND building.company_id=${company.id}::uuid
        FOR UPDATE OF building
      `;
      const building = rows[0];
      if (!building) throw new Error("Construção empresarial não encontrada.");
      if (String(building.status) !== "active") throw new Error("Construção não está operando.");

      const level = Number(building.level);
      const visits = Math.min(Number(building.visits), 20);
      const revenue = 3500 + level * 1700 + visits * 240 + Number(building.capacity) * 35;
      const operatingCost = 1000 + level * 420;
      const maintenance = Number(building.maintenance_minor);
      const tax = Math.round(revenue * 0.05);
      const net = revenue - operatingCost - maintenance - tax;
      const companyAccount = await this.companyAccount(tx, company);
      const cityAccountId = await this.cityAccountId(tx);

      const ledgerTransactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:settlement`,
        type: "business-operating-cycle",
        entries: [
          { accountId: cityAccountId, amount: -revenue, memo: "Consumo NPC e contratos locais" },
          { accountId: companyAccount.id, amount: revenue, memo: "Receita operacional" },
          {
            accountId: companyAccount.id,
            amount: -(operatingCost + maintenance + tax),
            memo: "Custos, manutenção e tributos"
          },
          {
            accountId: cityAccountId,
            amount: operatingCost + maintenance + tax,
            memo: "Serviços urbanos, manutenção e tributos"
          }
        ]
      });

      const cycleId = randomUUID();
      const cycleNumber = Number(building.previous_cycle) + 1;
      await tx`
        INSERT INTO company_operating_cycles (
          id,company_id,building_id,cycle_number,revenue_minor,
          operating_cost_minor,maintenance_minor,tax_minor,net_result_minor,
          status,ledger_transaction_id
        ) VALUES (
          ${cycleId}::uuid,${company.id}::uuid,${input.buildingId}::uuid,
          ${cycleNumber},${revenue},${operatingCost},${maintenance},${tax},${net},
          'settled',${ledgerTransactionId}::uuid
        )
      `;
      await tx`
        UPDATE property_buildings
        SET condition=GREATEST(0,condition-${Math.max(2,7-level)}),updated_at=now()
        WHERE id=${input.buildingId}::uuid
      `;
      await this.outbox(tx, cycleId, "business.cycle.settled", {
        companyId: company.id,
        buildingId: input.buildingId,
        cycleNumber,
        revenueMinor: revenue,
        netResultMinor: net,
        visits
      });
      return { cycleId, netResultMinor: net };
    });
    return this.state(input.ownerId);
  }

  async upgradeBuilding(input: {
    ownerId: string;
    buildingId: string;
    idempotencyKey: string;
  }): Promise<PropertyBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      const rows = await tx`
        SELECT building.id,building.level,plot.max_level,plot.construction_cost_minor
        FROM property_buildings building
        JOIN property_plots plot ON plot.id=building.plot_id
        WHERE building.id=${input.buildingId}::uuid
          AND building.company_id=${company.id}::uuid
        FOR UPDATE OF building
      `;
      const building = rows[0];
      if (!building) throw new Error("Construção não encontrada.");
      const level = Number(building.level);
      if (level >= Number(building.max_level)) throw new Error("Nível máximo alcançado.");
      const cost = Math.round(Number(building.construction_cost_minor) * (0.45 + level * 0.15));
      const companyAccount = await this.companyAccount(tx, company);
      await this.assertAvailableBalance(tx, companyAccount.id, cost);
      const cityAccountId = await this.cityAccountId(tx);
      await this.postLedger(tx, {
        key: `${input.idempotencyKey}:upgrade`,
        type: "business-building-upgrade",
        entries: [
          { accountId: companyAccount.id, amount: -cost, memo: "Expansão do estabelecimento" },
          { accountId: cityAccountId, amount: cost, memo: "Obra e licenciamento empresarial" }
        ]
      });
      await tx`
        UPDATE property_buildings
        SET level=level+1,capacity=capacity+8,condition=LEAST(100,condition+25),updated_at=now()
        WHERE id=${input.buildingId}::uuid
      `;
      await this.outbox(tx, input.buildingId, "property.building.upgraded", {
        companyId: company.id,
        buildingId: input.buildingId,
        newLevel: level + 1,
        costMinor: cost
      });
      return { upgraded: true, costMinor: cost };
    });
    return this.state(input.ownerId);
  }

  async createShareOffering(input: {
    ownerId: string;
    units: number;
    unitPriceMinor: number;
    idempotencyKey: string;
  }): Promise<PropertyBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      const equityRows = await tx`
        SELECT equity.total_units,equity.outside_limit_units,position.units,
               COALESCE((
                 SELECT SUM(units_remaining) FROM company_share_offerings offering
                 WHERE offering.company_id=equity.company_id AND offering.status='open'
               ),0)::integer open_units,
               COALESCE((
                 SELECT SUM(other.units) FROM company_equity_positions other
                 WHERE other.company_id=equity.company_id AND other.user_id<>${input.ownerId}::uuid
               ),0)::integer outside_units
        FROM company_equity equity
        JOIN company_equity_positions position
          ON position.company_id=equity.company_id AND position.user_id=${input.ownerId}::uuid
        WHERE equity.company_id=${company.id}::uuid
        FOR UPDATE OF equity,position
      `;
      const equity = equityRows[0];
      if (!equity) throw new Error("Estrutura de participação não encontrada.");
      const availableOutside = Number(equity.outside_limit_units)
        - Number(equity.outside_units)
        - Number(equity.open_units);
      if (input.units > availableOutside || input.units > Number(equity.units)) {
        throw new Error("Oferta excede o limite de participação externa.");
      }

      const offeringId = randomUUID();
      await tx`
        INSERT INTO company_share_offerings (
          id,company_id,created_by,units_total,units_remaining,
          unit_price_minor,status,idempotency_key
        ) VALUES (
          ${offeringId}::uuid,${company.id}::uuid,${input.ownerId}::uuid,
          ${input.units},${input.units},${input.unitPriceMinor},
          'open',${input.idempotencyKey}
        )
      `;
      await this.outbox(tx, offeringId, "business.share-offering.created", {
        companyId: company.id,
        units: input.units,
        unitPriceMinor: input.unitPriceMinor,
        simulationOnly: true
      });
      return { offeringId };
    });
    return this.state(input.ownerId);
  }

  async invest(input: {
    ownerId: string;
    offeringId: string;
    units: number;
    idempotencyKey: string;
  }): Promise<PropertyBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const rows = await tx`
        SELECT offering.id,offering.company_id,offering.units_remaining,
               offering.unit_price_minor,offering.status,company.owner_id
        FROM company_share_offerings offering
        JOIN companies company ON company.id=offering.company_id
        WHERE offering.id=${input.offeringId}::uuid
        FOR UPDATE OF offering
      `;
      const offering = rows[0];
      if (!offering || String(offering.status) !== "open") {
        throw new Error("Oferta de participação não está disponível.");
      }
      if (String(offering.owner_id) === input.ownerId) {
        throw new Error("O proprietário não pode investir na própria oferta.");
      }
      if (input.units > Number(offering.units_remaining)) {
        throw new Error("Quantidade superior às unidades disponíveis.");
      }

      const investorWallet = await this.walletAccount(tx, input.ownerId);
      const companyRows = await tx`
        SELECT id,owner_id,name FROM companies WHERE id=${String(offering.company_id)}::uuid
      `;
      const company = companyRows[0] as CompanyRow | undefined;
      if (!company) throw new Error("Empresa não encontrada.");
      const companyAccount = await this.companyAccount(tx, {
        id: String(company.id),
        ownerId: String(company.owner_id),
        name: String(company.name)
      });
      const total = input.units * Number(offering.unit_price_minor);
      await this.assertAvailableBalance(tx, investorWallet.id, total);
      await this.postLedger(tx, {
        key: `${input.idempotencyKey}:investment`,
        type: "business-equity-investment",
        entries: [
          { accountId: investorWallet.id, amount: -total, memo: "Participação virtual simulada" },
          { accountId: companyAccount.id, amount: total, memo: "Capitalização virtual simulada" }
        ]
      });

      const ownerPosition = await tx`
        UPDATE company_equity_positions
        SET units=units-${input.units},updated_at=now()
        WHERE company_id=${String(offering.company_id)}::uuid
          AND user_id=${String(offering.owner_id)}::uuid
          AND units>=${input.units}
        RETURNING units
      `;
      if (!ownerPosition[0]) {
        throw new Error("Posição do proprietário insuficiente para liquidar a oferta.");
      }
      await tx`
        INSERT INTO company_equity_positions (
          company_id,user_id,units,average_cost_minor
        ) VALUES (
          ${String(offering.company_id)}::uuid,${input.ownerId}::uuid,
          ${input.units},${Number(offering.unit_price_minor)}
        )
        ON CONFLICT (company_id,user_id) DO UPDATE SET
          average_cost_minor=CASE
            WHEN company_equity_positions.units+EXCLUDED.units=0 THEN 0
            ELSE (
              company_equity_positions.average_cost_minor*company_equity_positions.units
              + EXCLUDED.average_cost_minor*EXCLUDED.units
            )/(company_equity_positions.units+EXCLUDED.units)
          END,
          units=company_equity_positions.units+EXCLUDED.units,
          updated_at=now()
      `;
      const remaining = Number(offering.units_remaining) - input.units;
      await tx`
        UPDATE company_share_offerings
        SET units_remaining=${remaining},
            status=${remaining === 0 ? "filled" : "open"},
            closed_at=${remaining === 0 ? new Date().toISOString() : null}::timestamptz
        WHERE id=${input.offeringId}::uuid
      `;
      await this.outbox(tx, input.offeringId, "business.investment.settled", {
        investorId: input.ownerId,
        companyId: String(offering.company_id),
        units: input.units,
        paidMinor: total,
        simulationOnly: true
      });
      return { invested: true, paidMinor: total };
    });
    return this.state(input.ownerId);
  }

  async distributeResults(input: {
    ownerId: string;
    cycleId: string;
    idempotencyKey: string;
  }): Promise<PropertyBusinessState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const company = await this.ownedCompany(tx, input.ownerId);
      const cycleRows = await tx`
        SELECT cycle.id,cycle.net_result_minor,cycle.status
        FROM company_operating_cycles cycle
        WHERE cycle.id=${input.cycleId}::uuid AND cycle.company_id=${company.id}::uuid
        FOR UPDATE OF cycle
      `;
      const cycle = cycleRows[0];
      if (!cycle) throw new Error("Ciclo empresarial não encontrado.");
      if (String(cycle.status) !== "settled") throw new Error("Resultado já distribuído.");
      const netResult = Number(cycle.net_result_minor);
      if (netResult <= 0) throw new Error("Não há resultado positivo para distribuir.");

      const positions = await tx`
        SELECT position.user_id,position.units,equity.total_units
        FROM company_equity_positions position
        JOIN company_equity equity ON equity.company_id=position.company_id
        WHERE position.company_id=${company.id}::uuid AND position.units>0
        ORDER BY position.user_id
        FOR UPDATE OF position
      `;
      if (!positions[0]) throw new Error("Participações da empresa não encontradas.");
      const totalUnits = Number(positions[0].total_units);
      const distributable = Math.max(1, Math.floor(netResult * 0.4));
      const companyAccount = await this.companyAccount(tx, company);
      await this.assertAvailableBalance(tx, companyAccount.id, distributable);

      const payments = positions.map((position) => ({
        userId: String(position.user_id),
        units: Number(position.units),
        amount: Math.floor(distributable * Number(position.units) / totalUnits)
      }));
      const allocated = payments.reduce((sum, payment) => sum + payment.amount, 0);
      const ownerPayment = payments.find((payment) => payment.userId === input.ownerId);
      if (ownerPayment) ownerPayment.amount += distributable - allocated;

      const entries: { accountId: string; amount: number; memo: string }[] = [
        {
          accountId: companyAccount.id,
          amount: -distributable,
          memo: "Distribuição de resultado virtual"
        }
      ];
      for (const payment of payments) {
        if (payment.amount <= 0) continue;
        const wallet = await this.walletAccount(tx, payment.userId);
        entries.push({
          accountId: wallet.id,
          amount: payment.amount,
          memo: "Resultado proporcional da participação virtual"
        });
      }
      const ledgerTransactionId = await this.postLedger(tx, {
        key: `${input.idempotencyKey}:distribution`,
        type: "business-result-distribution",
        entries
      });
      const distributionId = randomUUID();
      await tx`
        INSERT INTO company_distributions (
          id,company_id,operating_cycle_id,distributable_minor,ledger_transaction_id
        ) VALUES (
          ${distributionId}::uuid,${company.id}::uuid,${input.cycleId}::uuid,
          ${distributable},${ledgerTransactionId}::uuid
        )
      `;
      for (const payment of payments) {
        await tx`
          INSERT INTO company_distribution_payments (
            distribution_id,user_id,units,amount_minor
          ) VALUES (
            ${distributionId}::uuid,${payment.userId}::uuid,
            ${payment.units},${payment.amount}
          )
        `;
      }
      await tx`
        UPDATE company_operating_cycles SET status='distributed'
        WHERE id=${input.cycleId}::uuid
      `;
      await this.outbox(tx, distributionId, "business.results.distributed", {
        companyId: company.id,
        cycleId: input.cycleId,
        distributableMinor: distributable,
        shareholderCount: payments.length,
        simulationOnly: true
      });
      return { distributed: true, distributableMinor: distributable };
    });
    return this.state(input.ownerId);
  }

  private percent(units: number, total: number): number {
    return total > 0 ? Math.round(units / total * 10000) / 100 : 0;
  }

  private async ownedCompany(
    tx: Tx,
    ownerId: string
  ): Promise<Readonly<{ id: string; ownerId: string; name: string }>> {
    const rows = await tx`
      SELECT id,owner_id,name FROM companies
      WHERE owner_id=${ownerId}::uuid ORDER BY created_at LIMIT 1
      FOR UPDATE
    `;
    const company = rows[0];
    if (!company) throw new Error("Empresa do jogador não encontrada.");
    return {
      id: String(company.id),
      ownerId: String(company.owner_id),
      name: String(company.name)
    };
  }

  private async companyAccount(
    tx: Tx,
    company: Readonly<{ id: string; ownerId: string; name: string }>
  ): Promise<Readonly<{ id: string; code: string }>> {
    const rows = await tx`
      SELECT id,code FROM ledger_accounts
      WHERE owner_id=${company.ownerId}::uuid AND account_type='company'
      ORDER BY created_at LIMIT 1
      FOR UPDATE
    `;
    if (!rows[0]) throw new Error("Conta empresarial não encontrada.");
    return { id: String(rows[0].id), code: String(rows[0].code) };
  }

  private async assertAvailableBalance(
    tx: Tx,
    accountId: string,
    requiredMinor: number
  ): Promise<void> {
    const rows = await tx`
      SELECT available_minor FROM ledger_account_balances
      WHERE account_id=${accountId}::uuid
    `;
    if (Number(rows[0]?.available_minor ?? 0) < requiredMinor) {
      throw new Error("Saldo disponível insuficiente.");
    }
  }

  private async assertLocation(
    tx: Tx,
    ownerId: string,
    locationCode: string
  ): Promise<void> {
    const rows = await tx`
      SELECT location.code
      FROM player_world_state world
      JOIN city_locations location ON location.id=world.location_id
      WHERE world.user_id=${ownerId}::uuid
      FOR UPDATE OF world
    `;
    if (String(rows[0]?.code ?? "") !== locationCode) {
      throw new Error(`Viaje até ${locationCode} para continuar.`);
    }
  }
}
