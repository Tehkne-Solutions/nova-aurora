import postgres from "postgres";
let client: ReturnType<typeof postgres> | undefined;

export function db(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não configurada.");
  return client ??= postgres(url, { max: 10, idle_timeout: 20 });
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end();
    client = undefined;
  }
}

export {
  CityGameplayService,
  type CityDistrictView,
  type CityGameplayState,
  type CityLocationView,
  type WelcomeBasketStep
} from "./city-gameplay.js";
export {
  GameplayExperienceService,
  type HarvestAction,
  type HarvestSessionView,
  type NpcView
} from "./gameplay-experience.js";
export { MarketProductionService } from "./market-production.js";
export {
  tradeGrossMinor,
  tradeTaxMinor,
  type MarketOrderView,
  type MarketTradeView,
  type OrderSide,
  type OrderStatus,
  type ProductionOrderView
} from "./economy-types.js";
