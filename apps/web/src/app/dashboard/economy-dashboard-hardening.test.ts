import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const dashboardSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("dashboard is explicitly an authenticated economy surface", () => {
  assert.match(dashboardSource, /aria-label="Painel econômico autenticado de Nova Aurora"/);
  assert.match(dashboardSource, /data-authenticated="true"/);
  assert.match(dashboardSource, /<h1>Sua economia em Nova Aurora\.<\/h1>/);
});

test("dashboard no longer fabricates Alice identity or x-actor-email", () => {
  assert.doesNotMatch(dashboardSource, /x-actor-email/);
  assert.doesNotMatch(dashboardSource, /alice@nova-aurora\.local/);
  assert.doesNotMatch(dashboardSource, /bob@nova-aurora\.local/);
});

test("dashboard consumes player-scoped snapshot and production through bearer session", () => {
  assert.match(dashboardSource, /fetchJson\("\/v1\/economy\/snapshot"\)/);
  assert.match(dashboardSource, /fetchJson\("\/v1\/production\/orders"\)/);
  assert.match(dashboardSource, /state\.inventory\.map/);
  assert.match(dashboardSource, /state\.orders\.slice\(0, 8\)\.map/);
});

test("public market discovery remains separate from private player state", () => {
  assert.match(dashboardSource, /fetchJson\("\/v1\/market\/order-book\/bread"\)/);
  assert.match(dashboardSource, /fetchJson\("\/v1\/market\/trades\/bread\?limit=8"\)/);
  assert.match(dashboardSource, /LIVRO PÚBLICO · PÃO/);
  assert.match(dashboardSource, /NEGOCIAÇÕES PÚBLICAS/);
});

test("dashboard keeps Tehkné Solutions product signature", () => {
  assert.match(dashboardSource, /<footer>Tehkné Solutions<\/footer>/);
  assert.match(dashboardSource, /\/\/ Tehkné Solutions/);
});

// Tehkné Solutions
