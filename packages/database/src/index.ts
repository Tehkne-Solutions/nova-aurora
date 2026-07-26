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
  type AuthenticatedIdentity,
  type AuthSessionResult,
  type NotificationView,
  type PresenceView,
  type UserRole
} from "./auth-security.js";
export { LiveSecurityService } from "./live-security.js";
export {
  StrongIdentityService,
  type MfaChallengeResult,
  type MfaSetupResult,
  type SecureLoginResult
} from "./strong-identity.js";
export {
  PrivacyComplianceService,
  type ConsentPurpose,
  type PrivacyState
} from "./privacy-compliance.js";
export {
  EconomyIntegrityService,
  evaluateMarketOrderIntegrity,
  recordTradeSurveillance,
  type IntegrityDecision,
  type IntegrityState
} from "./economy-integrity.js";
export {
  BusinessOperationsService,
  type MarketplaceCatalogView,
  type MarketplaceEmploymentView,
  type MarketplaceJobView,
  type PublicCompanyView,
  type PublicMarketplaceState,
  type SecondaryShareListingView
} from "./business-operations.js";
export {
  RegionalBusinessManagementService,
  type BusinessAlertView,
  type BusinessContractView,
  type CompanyGoalView,
  type DistrictBusinessMetricView,
  type ManagedEmployeeView,
  type ManagedStockView,
  type MarketingCampaignView,
  type RegionalBusinessState,
  type SupplierOfferView
} from "./regional-business-management.js";
export {
  CityGovernanceService,
  type BudgetProposalView,
  type BusinessLicenseView,
  type CityGovernanceState,
  type GovernanceDistrictView,
  type PublicContractView
} from "./city-governance.js";
export {
  MunicipalOperationsService,
  type CityApprovalView,
  type CityEmergencyView,
  type CivicCandidateView,
  type CivicElectionView,
  type CivicMandateView,
  type MunicipalBudgetCycleView,
  type MunicipalOperationsState,
  type MunicipalServiceView,
  type PublicPolicyView
} from "./municipal-operations.js";
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
  PropertyBusinessService,
  type BusinessBuildingView,
  type EquityPositionView,
  type OperatingCycleView,
  type PropertyBusinessState,
  type PropertyPlotView,
  type ShareOfferingView
} from "./property-business.js";
export {
  tradeGrossMinor,
  tradeTaxMinor,
  type MarketOrderView,
  type MarketTradeView,
  type OrderSide,
  type OrderStatus,
  type ProductionOrderView
} from "./economy-types.js";
