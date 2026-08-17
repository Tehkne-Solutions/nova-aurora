import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./city-game.tsx", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("./types.ts", import.meta.url), "utf8");

test("world context exposes typed local businesses with demand and visit metrics", () => {
  assert.match(typesSource, /export type WorldLocalBusiness/);
  assert.match(typesSource, /recentWorldVisits: number/);
  assert.match(typesSource, /recentDemandVisitors: number/);
  assert.match(typesSource, /recentCustomers: number/);
  assert.match(typesSource, /recentRevenueMinor: number/);
  assert.match(typesSource, /localBusinesses: readonly WorldLocalBusiness\[\]/);
});

test("world surface materializes local business count and business panel", () => {
  assert.match(source, /data-local-businesses-count=\{worldEconomy\.localBusinesses\.length\}/);
  assert.match(source, /aria-label="Empresas locais de Nova Aurora"/);
  assert.match(source, /EMPRESAS NESTE LOCAL/);
  assert.match(source, /Nenhum estabelecimento ativo neste ponto da cidade/);
});

test("local businesses display reputation physical traffic demand customers revenue and catalog", () => {
  assert.match(source, /Reputação \{business\.reputationScore\}\/100/);
  assert.match(source, /Visitas reais 7d: \{business\.recentWorldVisits\}/);
  assert.match(source, /Demanda 7d: \{business\.recentCustomers\} clientes · \{aurora\(business\.recentRevenueMinor\)\}/);
  assert.match(source, /business\.catalog\.map\(\(entry\) => `\$\{entry\.title\} · \$\{aurora\(entry\.unitPriceMinor\)\}`\)/);
});

test("visitor and owner actions are separated by authenticated identity", () => {
  assert.match(source, /const \{ identity \} = useAuth\(\)/);
  assert.match(source, /const owned = business\.ownerId === identity\?\.id/);
  assert.match(source, /\/v1\/world\/businesses\/\$\{buildingId\}\/visit/);
  assert.match(source, /Visitar estabelecimento/);
  assert.match(source, /\/v1\/world\/businesses\/\$\{buildingId\}\/demand-cycle/);
  assert.match(source, /Atender demanda do distrito/);
  assert.match(source, /Configurar vitrine no Marketplace/);
});

test("local business world UI keeps Tehkné Solutions signature", () => {
  assert.match(typesSource, /signature: "Tehkné Solutions"/);
  assert.match(source, /\/\/ Tehkné Solutions/);
});

// Tehkné Solutions
