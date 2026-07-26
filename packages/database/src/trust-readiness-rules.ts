export const REQUIRED_DOCUMENT_KEYS = [
  "terms-of-use",
  "privacy-notice",
  "asset-classification",
  "child-safety",
  "consumer-rights"
] as const;

export const REQUIRED_REVIEW_TYPES = [
  "independent-security",
  "privacy-lgpd",
  "terms-consumer",
  "asset-classification",
  "minors-safety",
  "incident-response",
  "taxation"
] as const;

export type RequiredDocumentKey = typeof REQUIRED_DOCUMENT_KEYS[number];
export type RequiredReviewType = typeof REQUIRED_REVIEW_TYPES[number];

export type TrustReadiness = Readonly<{
  launchReady: boolean;
  publishedRequiredDocuments: number;
  requiredDocuments: number;
  approvedReviews: number;
  requiredReviews: number;
  openCriticalIncidents: number;
  pendingGuardianReviews: number;
  blockers: readonly string[];
}>;

export function evaluateTrustReadiness(input: {
  publishedDocumentKeys: readonly string[];
  approvedReviewTypes: readonly string[];
  openCriticalIncidents: number;
  pendingGuardianReviews: number;
}): TrustReadiness {
  const published = new Set(input.publishedDocumentKeys);
  const approved = new Set(input.approvedReviewTypes);
  const missingDocuments = REQUIRED_DOCUMENT_KEYS.filter((key) => !published.has(key));
  const missingReviews = REQUIRED_REVIEW_TYPES.filter((key) => !approved.has(key));
  const blockers = [
    ...missingDocuments.map((key) => `Documento pendente: ${key}`),
    ...missingReviews.map((key) => `Revisão externa pendente: ${key}`),
    ...(input.openCriticalIncidents > 0
      ? [`Incidentes críticos abertos: ${input.openCriticalIncidents}`]
      : []),
    ...(input.pendingGuardianReviews > 0
      ? [`Revisões de responsáveis pendentes: ${input.pendingGuardianReviews}`]
      : [])
  ];

  return {
    launchReady: blockers.length === 0,
    publishedRequiredDocuments: REQUIRED_DOCUMENT_KEYS.length - missingDocuments.length,
    requiredDocuments: REQUIRED_DOCUMENT_KEYS.length,
    approvedReviews: REQUIRED_REVIEW_TYPES.length - missingReviews.length,
    requiredReviews: REQUIRED_REVIEW_TYPES.length,
    openCriticalIncidents: input.openCriticalIncidents,
    pendingGuardianReviews: input.pendingGuardianReviews,
    blockers
  };
}
