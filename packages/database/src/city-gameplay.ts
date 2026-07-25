import { randomUUID } from "node:crypto";
import { EconomyRepositoryBase, type Tx } from "./economy-base.js";

export type CityLocationView = Readonly<{
  id: string;
  code: string;
  name: string;
  locationType: string;
  mapX: number;
  mapY: number;
  description: string;
}>;

export type CityDistrictView = Readonly<{
  id: string;
  code: string;
  name: string;
  direction: string;
  theme: string;
  description: string;
  locations: readonly CityLocationView[];
}>;

export type WelcomeBasketStep = Readonly<{
  code: string;
  title: string;
  completed: boolean;
}>;

export type CityGameplayState = Readonly<{
  player: Readonly<{
    id: string;
    email: string;
    displayName: string;
    balanceMinor: number;
    inventory: Readonly<Record<string, number>>;
    currentDistrictCode: string;
    currentLocationCode: string;
  }>;
  districts: readonly CityDistrictView[];
  jobs: readonly Readonly<{
    code: string;
    title: string;
    description: string;
    status: string;
    assignmentStatus: string | null;
    rewardMinor: number;
    rewardItemCode: string | null;
    rewardItemQuantityMinor: number;
  }>[];
  onboarding: Readonly<{
    code: "welcome-basket";
    title: string;
    completedSteps: number;
    totalSteps: number;
    steps: readonly WelcomeBasketStep[];
  }>;
}>;

export class CityGameplayService extends EconomyRepositoryBase {
  async state(ownerId: string): Promise<CityGameplayState> {
    const userRows = await this.sql`
      SELECT u.id,u.email,u.display_name,
             district.code district_code,location.code location_code
      FROM users u
      JOIN player_world_state state ON state.user_id=u.id
      JOIN city_districts district ON district.id=state.district_id
      JOIN city_locations location ON location.id=state.location_id
      WHERE u.id=${ownerId}::uuid
    `;
    const user = userRows[0];
    if (!user) throw new Error("Estado do jogador não encontrado.");

    const [districtRows, locationRows, balanceRows, inventoryRows, jobRows] = await Promise.all([
      this.sql`SELECT * FROM city_districts ORDER BY sort_order`,
      this.sql`SELECT * FROM city_locations ORDER BY map_y,map_x,name`,
      this.sql`
        SELECT balance.available_minor
        FROM ledger_account_balances balance
        JOIN ledger_accounts account ON account.id=balance.account_id
        WHERE account.owner_id=${ownerId}::uuid AND account.account_type='wallet'
        ORDER BY account.created_at LIMIT 1
      `,
      this.sql`
        SELECT item.code,COALESCE(SUM(lot.quantity_minor-lot.reserved_minor),0)::bigint quantity_minor
        FROM inventory_lots lot JOIN items item ON item.id=lot.item_id
        WHERE lot.owner_id=${ownerId}::uuid
        GROUP BY item.code ORDER BY item.code
      `,
      this.sql`
        SELECT job.code,job.title,job.description,job.status,job.reward_minor,
               reward.code reward_item_code,job.reward_item_quantity_minor,
               assignment.status assignment_status
        FROM public_jobs job
        LEFT JOIN items reward ON reward.id=job.reward_item_id
        LEFT JOIN player_job_assignments assignment
          ON assignment.job_id=job.id AND assignment.user_id=${ownerId}::uuid
        WHERE job.status='active' ORDER BY job.title
      `
    ]);

    const locationsByDistrict = new Map<string, CityLocationView[]>();
    for (const row of locationRows) {
      const districtId = String(row.district_id);
      const list = locationsByDistrict.get(districtId) ?? [];
      list.push({
        id: String(row.id),
        code: String(row.code),
        name: String(row.name),
        locationType: String(row.location_type),
        mapX: Number(row.map_x),
        mapY: Number(row.map_y),
        description: String(row.description)
      });
      locationsByDistrict.set(districtId, list);
    }

    const inventory: Record<string, number> = {};
    for (const row of inventoryRows) {
      inventory[String(row.code)] = Number(row.quantity_minor);
    }

    const onboarding = await this.welcomeBasket(ownerId);
    return {
      player: {
        id: String(user.id),
        email: String(user.email),
        displayName: String(user.display_name),
        balanceMinor: Number(balanceRows[0]?.available_minor ?? 0),
        inventory,
        currentDistrictCode: String(user.district_code),
        currentLocationCode: String(user.location_code)
      },
      districts: districtRows.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        name: String(row.name),
        direction: String(row.direction),
        theme: String(row.theme),
        description: String(row.description),
        locations: locationsByDistrict.get(String(row.id)) ?? []
      })),
      jobs: jobRows.map((row) => ({
        code: String(row.code),
        title: String(row.title),
        description: String(row.description),
        status: String(row.status),
        assignmentStatus: row.assignment_status ? String(row.assignment_status) : null,
        rewardMinor: Number(row.reward_minor),
        rewardItemCode: row.reward_item_code ? String(row.reward_item_code) : null,
        rewardItemQuantityMinor: Number(row.reward_item_quantity_minor)
      })),
      onboarding
    };
  }

  async movePlayer(input: {
    ownerId: string;
    locationCode: string;
    idempotencyKey: string;
  }): Promise<CityGameplayState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const locations = await tx`
        SELECT location.id,location.code,location.district_id,district.code district_code
        FROM city_locations location
        JOIN city_districts district ON district.id=location.district_id
        WHERE location.code=${input.locationCode}
      `;
      const location = locations[0];
      if (!location) throw new Error("Local não encontrado.");

      await tx`
        INSERT INTO player_world_state (user_id,district_id,location_id,updated_at)
        VALUES (
          ${input.ownerId}::uuid,${String(location.district_id)}::uuid,
          ${String(location.id)}::uuid,now()
        )
        ON CONFLICT (user_id) DO UPDATE SET
          district_id=EXCLUDED.district_id,location_id=EXCLUDED.location_id,updated_at=now()
      `;
      await tx`
        INSERT INTO city_action_log (
          id,user_id,action_code,district_id,location_id,metadata
        ) VALUES (
          ${randomUUID()}::uuid,${input.ownerId}::uuid,'city.move',
          ${String(location.district_id)}::uuid,${String(location.id)}::uuid,
          ${JSON.stringify({ locationCode: String(location.code) })}::jsonb
        )
      `;
      if (String(location.code) === "employment-center") {
        await tx`
          INSERT INTO city_action_log (
            id,user_id,action_code,district_id,location_id,metadata
          ) VALUES (
            ${randomUUID()}::uuid,${input.ownerId}::uuid,'visit-employment-center',
            ${String(location.district_id)}::uuid,${String(location.id)}::uuid,'{}'::jsonb
          )
        `;
      }
      await this.outbox(tx, input.ownerId, "city.player.moved", {
        ownerId: input.ownerId,
        districtCode: String(location.district_code),
        locationCode: String(location.code)
      });
      return { moved: true };
    });
    return this.state(input.ownerId);
  }

  async acceptJob(input: {
    ownerId: string;
    jobCode: string;
    idempotencyKey: string;
  }): Promise<CityGameplayState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      await this.assertCurrentLocation(tx, input.ownerId, "employment-center");
      const jobs = await tx`SELECT id FROM public_jobs WHERE code=${input.jobCode} AND status='active'`;
      const job = jobs[0];
      if (!job) throw new Error("Trabalho público não encontrado.");

      await tx`
        INSERT INTO player_job_assignments (id,user_id,job_id,status)
        VALUES (${randomUUID()}::uuid,${input.ownerId}::uuid,${String(job.id)}::uuid,'accepted')
        ON CONFLICT (user_id,job_id) DO UPDATE SET
          status=CASE
            WHEN player_job_assignments.status='completed' THEN 'completed'
            ELSE 'accepted'
          END
      `;
      await this.outbox(tx, String(job.id), "job.public.accepted", {
        ownerId: input.ownerId,
        jobCode: input.jobCode
      });
      return { accepted: true };
    });
    return this.state(input.ownerId);
  }

  async completeJob(input: {
    ownerId: string;
    jobCode: string;
    idempotencyKey: string;
  }): Promise<CityGameplayState> {
    await this.idempotent(input.idempotencyKey, input.ownerId, input, async (tx) => {
      const rows = await tx`
        SELECT assignment.id assignment_id,assignment.status assignment_status,
               job.id job_id,job.required_location_id,job.reward_minor,
               job.reward_item_id,job.reward_item_quantity_minor,
               location.code required_location_code
        FROM public_jobs job
        JOIN city_locations location ON location.id=job.required_location_id
        JOIN player_job_assignments assignment
          ON assignment.job_id=job.id AND assignment.user_id=${input.ownerId}::uuid
        WHERE job.code=${input.jobCode}
        FOR UPDATE OF assignment
      `;
      const job = rows[0];
      if (!job) throw new Error("Aceite o trabalho antes de concluí-lo.");
      await this.assertCurrentLocation(tx, input.ownerId, String(job.required_location_code));

      if (String(job.assignment_status) === "completed") {
        return { completed: true, alreadyCompleted: true };
      }
      if (String(job.assignment_status) !== "accepted") {
        throw new Error("Trabalho não está ativo.");
      }

      const playerAccount = await this.walletAccount(tx, input.ownerId);
      const cityAccountId = await this.cityAccountId(tx);
      const rewardMinor = Number(job.reward_minor);
      if (rewardMinor > 0) {
        await this.postLedger(tx, {
          key: `${input.idempotencyKey}:reward`,
          type: "public-job-reward",
          entries: [
            { accountId: cityAccountId, amount: -rewardMinor, memo: "Apoio à Colheita" },
            { accountId: playerAccount.id, amount: rewardMinor, memo: "Apoio à Colheita" }
          ]
        });
      }
      const itemQuantityMinor = Number(job.reward_item_quantity_minor);
      if (job.reward_item_id && itemQuantityMinor > 0) {
        await this.addInventory(
          tx,input.ownerId,String(job.reward_item_id),itemQuantityMinor,65
        );
      }
      await tx`
        UPDATE player_job_assignments
        SET status='completed',completed_at=now()
        WHERE id=${String(job.assignment_id)}::uuid
      `;
      await this.outbox(tx, String(job.job_id), "job.public.completed", {
        ownerId: input.ownerId,
        jobCode: input.jobCode,
        rewardMinor,
        rewardItemQuantityMinor: itemQuantityMinor
      });
      return { completed: true, rewardMinor, rewardItemQuantityMinor: itemQuantityMinor };
    });
    return this.state(input.ownerId);
  }

  private async assertCurrentLocation(
    tx: Tx,
    ownerId: string,
    expectedLocationCode: string
  ): Promise<void> {
    const rows = await tx`
      SELECT location.code
      FROM player_world_state state
      JOIN city_locations location ON location.id=state.location_id
      WHERE state.user_id=${ownerId}::uuid
      FOR UPDATE OF state
    `;
    if (String(rows[0]?.code ?? "") !== expectedLocationCode) {
      throw new Error(`Viaje até ${expectedLocationCode} para continuar.`);
    }
  }

  private async welcomeBasket(ownerId: string): Promise<CityGameplayState["onboarding"]> {
    const rows = await this.sql`
      SELECT
        EXISTS (
          SELECT 1 FROM city_action_log
          WHERE user_id=${ownerId}::uuid AND action_code='visit-employment-center'
        ) visited_employment,
        assignment.status assignment_status,
        assignment.accepted_at,
        EXISTS (
          SELECT 1 FROM production_orders production
          JOIN production_recipes recipe ON recipe.id=production.recipe_id
          WHERE production.owner_id=${ownerId}::uuid AND recipe.code='flour'
            AND production.status='completed'
            AND assignment.accepted_at IS NOT NULL
            AND production.created_at>=assignment.accepted_at
        ) produced_flour,
        EXISTS (
          SELECT 1 FROM production_orders production
          JOIN production_recipes recipe ON recipe.id=production.recipe_id
          WHERE production.owner_id=${ownerId}::uuid AND recipe.code='bread'
            AND production.status='completed'
            AND assignment.accepted_at IS NOT NULL
            AND production.created_at>=assignment.accepted_at
        ) produced_bread,
        EXISTS (
          SELECT 1 FROM market_orders market
          JOIN items item ON item.id=market.item_id
          WHERE market.owner_id=${ownerId}::uuid AND market.side='sell' AND item.code='bread'
            AND assignment.accepted_at IS NOT NULL
            AND market.created_at>=assignment.accepted_at
        ) listed_bread,
        EXISTS (
          SELECT 1 FROM market_trades trade
          WHERE trade.seller_id=${ownerId}::uuid
            AND assignment.accepted_at IS NOT NULL
            AND trade.created_at>=assignment.accepted_at
        ) sold_bread
      FROM (SELECT 1) base
      LEFT JOIN player_job_assignments assignment
        ON assignment.user_id=${ownerId}::uuid
       AND assignment.job_id=(SELECT id FROM public_jobs WHERE code='harvest-support')
    `;
    const row = rows[0] ?? {};
    const steps: WelcomeBasketStep[] = [
      { code: "visit-employment-center", title: "Visite o Centro de Empregos", completed: Boolean(row.visited_employment) },
      { code: "accept-harvest-job", title: "Aceite Apoio à Colheita", completed: Boolean(row.assignment_status) },
      { code: "complete-harvest-job", title: "Colete trigo no Vale Verde", completed: String(row.assignment_status ?? "") === "completed" },
      { code: "produce-flour", title: "Produza farinha", completed: Boolean(row.produced_flour) },
      { code: "produce-bread", title: "Asse o pão", completed: Boolean(row.produced_bread) },
      { code: "list-bread", title: "Publique uma oferta", completed: Boolean(row.listed_bread) },
      { code: "sell-bread", title: "Realize a primeira venda", completed: Boolean(row.sold_bread) }
    ];
    return {
      code: "welcome-basket",
      title: "Cesta de Boas-Vindas",
      completedSteps: steps.filter((step) => step.completed).length,
      totalSteps: steps.length,
      steps
    };
  }
}
