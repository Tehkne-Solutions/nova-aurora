import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./city-game.tsx", import.meta.url), "utf8");
const typesSource = readFileSync(new URL("./types.ts", import.meta.url), "utf8");

test("city game no longer fabricates Alice Bob or x-actor-email", () => {
  assert.doesNotMatch(source, /alice@nova-aurora\.local|bob@nova-aurora\.local|x-actor-email/);
  assert.doesNotMatch(source, /simulateBuyer|Simular compra de Bob|actor:/);
});

test("city game materializes authenticated world economy context", () => {
  assert.match(source, /request<WorldEconomyContext>\("\/v1\/world\/economy\/context"\)/);
  assert.match(source, /aria-label="Mundo econômico autenticado de Nova Aurora"/);
  assert.match(source, /data-authenticated="true"/);
  assert.match(source, /data-world-location=\{worldEconomy\.location\.code\}/);
  assert.match(source, /<strong>Economia local:<\/strong> \{worldEconomy\.guidance\}/);
});

test("production in the world uses location-aware production endpoint", () => {
  assert.match(source, /request\("\/v1\/world\/production\/orders"/);
  assert.match(source, /move\("green-cooperative"\)/);
  assert.match(source, /Levar trigo à Cooperativa Agrícola/);
  assert.match(source, /Ir à Cooperativa Agrícola/);
  assert.match(source, /Produzir farinha/);
  assert.match(source, /Assar pão/);
});

test("world listing requires travel to municipal market and real demand", () => {
  assert.match(source, /request\("\/v1\/world\/market\/orders"/);
  assert.match(source, /move\("municipal-market"\)/);
  assert.match(source, /Levar pão ao Mercado Municipal/);
  assert.match(source, /Aguardando comprador real no livro público da cidade/);
  assert.match(source, /<Link href="\/marketplace">Abrir Marketplace<\/Link>/);
  assert.match(source, /primeira venda real/);
});

test("world economy type exposes location capabilities and Tehkné Solutions signature", () => {
  assert.match(typesSource, /export type WorldEconomyContext/);
  assert.match(typesSource, /canProduce: boolean/);
  assert.match(typesSource, /canTrade: boolean/);
  assert.match(typesSource, /signature: "Tehkné Solutions"/);
  assert.match(source, /\/\/ Tehkné Solutions/);
});

// Tehkné Solutions
