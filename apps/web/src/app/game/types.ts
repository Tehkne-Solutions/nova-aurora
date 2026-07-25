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
