import assert from "node:assert/strict";
import test from "node:test";
import {
  getTimePhase,
  nextLocationByDirection,
  resolveFacing,
  supportsInterior
} from "./world-presentation";
import type { Location } from "./types";

const locations: readonly Location[] = [
  { code: "center", name: "Centro", locationType: "service", mapX: 2, mapY: 2, description: "" },
  { code: "east", name: "Leste", locationType: "market", mapX: 4, mapY: 2, description: "" },
  { code: "north", name: "Norte", locationType: "resource", mapX: 2, mapY: 0, description: "" }
];

test("resolve fases do dia em horários-limite", () => {
  assert.equal(getTimePhase(5), "dawn");
  assert.equal(getTimePhase(8), "day");
  assert.equal(getTimePhase(17), "dusk");
  assert.equal(getTimePhase(20), "night");
});

test("seleciona o destino direcional mais próximo", () => {
  assert.equal(nextLocationByDirection(locations, "center", "east")?.code, "east");
  assert.equal(nextLocationByDirection(locations, "center", "north")?.code, "north");
});

test("calcula orientação e interiores suportados", () => {
  assert.equal(resolveFacing(locations[0]!, locations[1]!), "east");
  assert.equal(supportsInterior("employment-center"), true);
  assert.equal(supportsInterior("harvest-fields"), false);
});
