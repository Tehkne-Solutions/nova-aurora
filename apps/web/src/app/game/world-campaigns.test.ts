import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./city-game.tsx", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("./types.ts", import.meta.url), "utf8");

test("world business type includes active campaign attribution and placement", () => {
  assert.match(typesSource, /export type WorldBusinessCampaign/);
  assert.match(typesSource, /channel: "local" \| "social" \| "outdoor" \| "influencer"/);
  assert.match(typesSource, /visitorBoostPct: number/);
  assert.match(typesSource, /attributedRevenueMinor: number/);
  assert.match(typesSource, /worldPlacement: boolean/);
  assert.match(typesSource, /activeCampaigns: readonly WorldBusinessCampaign\[\]/);
});

test("world exposes active campaign count for release evidence", () => {
  assert.match(source, /const activeCampaignCount = worldEconomy\.localBusinesses\.reduce/);
  assert.match(source, /data-active-campaigns-count=\{activeCampaignCount\}/);
});

test("physical and digital campaign surfaces are distinguished in the world", () => {
  assert.match(source, /campaign\.worldPlacement \? "PROMOVIDO NO MUNDO" : "CAMPANHA DIGITAL"/);
  assert.match(source, /campaignChannelLabel\(campaign\.channel\)/);
  assert.match(source, /\+\{campaign\.visitorBoostPct\}% visitantes/);
  assert.match(source, /\{campaign\.conversions\} conversões/);
});

test("world campaign UI keeps Tehkné Solutions signature", () => {
  assert.match(source, /\/\/ Tehkné Solutions/);
});

// Tehkné Solutions
