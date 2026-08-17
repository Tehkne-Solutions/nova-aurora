export type HarvestAction = "left" | "right" | "up" | "down";

export type Location = Readonly<{
  code: string;
  name: string;
  locationType: string;
  mapX: number;
  mapY: number;
  description: string;
}>;

export type District = Readonly<{
  code: string;
  name: string;
  direction: string;
  theme: string;
  description: string;
  locations: readonly Location[];
}>;

export type QuestStep = Readonly<{
  code: string;
  title: string;
  completed: boolean;
}>;

export type CityState = Readonly<{
  player: Readonly<{
    displayName: string;
    balanceMinor: number;
    inventory: Readonly<Record<string, number>>;
    currentDistrictCode: string;
    currentLocationCode: string;
  }>;
  districts: readonly District[];
  jobs: readonly Readonly<{
    code: string;
    title: string;
    description: string;
    assignmentStatus: string | null;
    rewardMinor: number;
    rewardItemQuantityMinor: number;
  }>[];
  onboarding: Readonly<{
    title: string;
    completedSteps: number;
    totalSteps: number;
    steps: readonly QuestStep[];
  }>;
}>;

export type WorldBusinessCatalogEntry = Readonly<{
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  unitPriceMinor: number;
  capacityPerCycle: number;
}>;

export type WorldBusinessCampaign = Readonly<{
  id: string;
  name: string;
  channel: "local" | "social" | "outdoor" | "influencer";
  budgetMinor: number;
  visitorBoostPct: number;
  conversions: number;
  attributedRevenueMinor: number;
  endsAt: string;
  worldPlacement: boolean;
}>;

export type WorldLocalBusiness = Readonly<{
  buildingId: string;
  plotCode: string;
  companyId: string;
  companyName: string;
  ownerId: string;
  ownerName: string;
  buildingName: string;
  buildingType: string;
  level: number;
  condition: number;
  capacity: number;
  reputationScore: number;
  reviewCount: number;
  recentWorldVisits: number;
  recentDemandVisitors: number;
  recentCustomers: number;
  recentRevenueMinor: number;
  catalog: readonly WorldBusinessCatalogEntry[];
  activeCampaigns: readonly WorldBusinessCampaign[];
}>;

export type WorldEconomyContext = Readonly<{
  location: Readonly<{
    code: string;
    name: string;
    locationType: string;
    districtCode: string;
    districtName: string;
  }>;
  capabilities: Readonly<{
    canProduce: boolean;
    canTrade: boolean;
    allowedRecipeCodes: readonly string[];
  }>;
  recipes: readonly Readonly<{
    code: string;
    name: string;
    outputItemCode: string;
    outputItemName: string;
    outputQuantityMinor: number;
    durationSeconds: number;
    energyCostMinor: number;
  }>[];
  marketItems: readonly Readonly<{
    code: string;
    name: string;
    basePriceMinor: number;
  }>[];
  localBusinesses: readonly WorldLocalBusiness[];
  guidance: string;
  signature: "Tehkné Solutions";
}>;

export type Npc = Readonly<{
  code: string;
  name: string;
  roleTitle: string;
  avatar: string;
  locationCode: string;
  dialogue: readonly string[];
}>;

export type HarvestSession = Readonly<{
  id: string;
  challenge: readonly HarvestAction[];
  score: number;
  status: "active" | "completed" | "failed" | "expired";
  startedAt: string;
  expiresAt: string;
  completedAt: string | null;
}>;

export type ExperienceState = Readonly<{
  avatarCode: string;
  facing: string;
  npcs: readonly Npc[];
  activeHarvest: HarvestSession | null;
}>;

// Tehkné Solutions
