import assert from "node:assert/strict";
import test from "node:test";
import { closeDb } from "./index.js";
import { MunicipalOperationsService } from "./municipal-operations.js";

const databaseAvailable = Boolean(process.env.DATABASE_URL);

test(
  "executa eleição, política, emergência e ciclo orçamentário municipal",
  { skip: !databaseAvailable },
  async () => {
    const service = new MunicipalOperationsService();
    const run = crypto.randomUUID();
    const aliceId = await service.resolveUserId("alice@nova-aurora.local");
    const bobId = await service.resolveUserId("bob@nova-aurora.local");

    const initial = await service.state(aliceId);
    assert.ok(initial.election);
    assert.equal(initial.election.status, "registration");
    assert.ok(initial.treasury.serviceOperationsMinor > 0);
    assert.ok(initial.treasury.emergencyReserveMinor > 0);

    await service.registerCandidate({
      ownerId: aliceId,
      electionId: initial.election.id,
      slogan: "Cidade transparente e produtiva",
      platform: "Serviços confiáveis, orçamento aberto e desenvolvimento responsável.",
      idempotencyKey: `municipal:${run}:candidate:alice`
    });
    await service.registerCandidate({
      ownerId: bobId,
      electionId: initial.election.id,
      slogan: "Bairros fortes, cidade forte",
      platform: "Mobilidade, segurança e oportunidades para todos os distritos.",
      idempotencyKey: `municipal:${run}:candidate:bob`
    });

    await service.openElection({
      ownerId: aliceId,
      electionId: initial.election.id,
      idempotencyKey: `municipal:${run}:election:open`
    });

    let voting = await service.state(aliceId);
    const aliceCandidate = voting.candidates.find(
      (candidate) => candidate.displayName === "Alice Aurora"
    );
    const bobCandidate = voting.candidates.find(
      (candidate) => candidate.displayName === "Bob Horizonte"
    );
    assert.ok(aliceCandidate);
    assert.ok(bobCandidate);

    await service.castElectionVote({
      ownerId: aliceId,
      electionId: initial.election.id,
      candidateId: aliceCandidate.id,
      idempotencyKey: `municipal:${run}:vote:alice`
    });
    await service.castElectionVote({
      ownerId: bobId,
      electionId: initial.election.id,
      candidateId: bobCandidate.id,
      idempotencyKey: `municipal:${run}:vote:bob`
    });

    await service.certifyElection({
      ownerId: aliceId,
      electionId: initial.election.id,
      idempotencyKey: `municipal:${run}:election:certify`
    });

    const elected = await service.state(aliceId);
    assert.equal(elected.election?.status, "certified");
    assert.equal(elected.mandates.filter((mandate) => mandate.status === "active").length, 2);
    assert.equal(elected.actor.activeMandate, true);

    const policyState = await service.createPolicy({
      ownerId: aliceId,
      districtCode: "central",
      title: "Plano de mobilidade cívica",
      description: "Reforça a manutenção das rotas do Centro Cívico e a transparência operacional.",
      policyArea: "transport",
      budgetImpactMinor: 2000,
      idempotencyKey: `municipal:${run}:policy:create`
    });
    const policy = policyState.policies.find(
      (item) => item.title === "Plano de mobilidade cívica"
    );
    assert.ok(policy);

    await service.votePolicy({
      ownerId: aliceId,
      policyId: policy.id,
      choice: "support",
      idempotencyKey: `municipal:${run}:policy:vote:alice`
    });
    await service.votePolicy({
      ownerId: bobId,
      policyId: policy.id,
      choice: "support",
      idempotencyKey: `municipal:${run}:policy:vote:bob`
    });
    const enacted = await service.enactPolicy({
      ownerId: aliceId,
      policyId: policy.id,
      idempotencyKey: `municipal:${run}:policy:enact`
    });
    assert.equal(
      enacted.policies.find((item) => item.id === policy.id)?.status,
      "active"
    );

    const emergencyState = await service.triggerEmergency({
      ownerId: aliceId,
      districtCode: "central",
      eventType: "energy-failure",
      severity: 2,
      idempotencyKey: `municipal:${run}:emergency:trigger`
    });
    const emergency = emergencyState.emergencies.find(
      (item) => item.status === "active" && item.eventType === "energy-failure"
    );
    assert.ok(emergency);

    const resolved = await service.respondEmergency({
      ownerId: bobId,
      emergencyId: emergency.id,
      idempotencyKey: `municipal:${run}:emergency:respond`
    });
    assert.equal(
      resolved.emergencies.find((item) => item.id === emergency.id)?.status,
      "resolved"
    );

    const settled = await service.settleMunicipalCycle({
      ownerId: aliceId,
      idempotencyKey: `municipal:${run}:cycle:settle`
    });
    assert.equal(settled.budgetCycle?.status, "open");
    assert.ok(settled.approval);
    assert.ok(settled.approval.approvalScore >= 0);
    assert.ok(settled.services.every((item) => item.conditionScore >= 0));

    const repeated = await service.settleMunicipalCycle({
      ownerId: aliceId,
      idempotencyKey: `municipal:${run}:cycle:settle`
    });
    assert.equal(repeated.budgetCycle?.id, settled.budgetCycle?.id);
  }
);

test.after(async () => {
  await closeDb();
});
