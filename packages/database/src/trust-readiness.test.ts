import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_DOCUMENT_KEYS,
  REQUIRED_REVIEW_TYPES,
  evaluateTrustReadiness
} from "./trust-readiness-rules.js";

test("mantém lançamento bloqueado quando revisões estão pendentes", () => {
  const result = evaluateTrustReadiness({
    publishedDocumentKeys: REQUIRED_DOCUMENT_KEYS,
    approvedReviewTypes: ["independent-security"],
    openCriticalIncidents: 0,
    pendingGuardianReviews: 0
  });

  assert.equal(result.launchReady, false);
  assert.equal(result.publishedRequiredDocuments, REQUIRED_DOCUMENT_KEYS.length);
  assert.equal(result.approvedReviews, 1);
  assert.ok(result.blockers.some((blocker) => blocker.includes("privacy-lgpd")));
});

test("bloqueia lançamento com incidente crítico aberto", () => {
  const result = evaluateTrustReadiness({
    publishedDocumentKeys: REQUIRED_DOCUMENT_KEYS,
    approvedReviewTypes: REQUIRED_REVIEW_TYPES,
    openCriticalIncidents: 1,
    pendingGuardianReviews: 0
  });

  assert.equal(result.launchReady, false);
  assert.match(result.blockers.join(" "), /Incidentes críticos/);
});

test("libera somente quando todos os critérios registrados passam", () => {
  const result = evaluateTrustReadiness({
    publishedDocumentKeys: REQUIRED_DOCUMENT_KEYS,
    approvedReviewTypes: REQUIRED_REVIEW_TYPES,
    openCriticalIncidents: 0,
    pendingGuardianReviews: 0
  });

  assert.equal(result.launchReady, true);
  assert.deepEqual(result.blockers, []);
});
