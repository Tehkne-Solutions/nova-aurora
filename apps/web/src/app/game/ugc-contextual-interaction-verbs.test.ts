import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const cityWorld = readFileSync(new URL("./city-world.tsx", import.meta.url), "utf8");

test("UGC interaction verbs reflect the canonical next state", () => {
  assert.match(cityWorld, /if \(next === "open"\) return "Abrir"/);
  assert.match(cityWorld, /if \(next === "close"\) return "Fechar"/);
  assert.match(cityWorld, /if \(next === "activate"\) return "Ativar"/);
  assert.match(cityWorld, /if \(next === "deactivate"\) return "Desativar"/);
  assert.match(cityWorld, /if \(next === "spin"\) return "Girar"/);
  assert.match(cityWorld, /return "Parar"/);
});

test("UGC action button and accessible label use the same contextual verb", () => {
  assert.match(cityWorld, /const verb = interactionVerb\(placement\.animationState \?\? "idle"\)/);
  assert.match(cityWorld, /aria-label=\{`\$\{verb\} \$\{placement\.label\}`\}/);
  assert.match(cityWorld, /interactionBusyId === placement\.id \? `\$\{verb\}…` : verb/);
});

test("UGC interaction request preserves the existing canonical state transition contract", () => {
  assert.match(cityWorld, /const next = nextInteractiveState\(current\)/);
  assert.match(cityWorld, /body: JSON\.stringify\(\{ animationState: next \}\)/);
  assert.match(cityWorld, /setPlacements\(\(currentPlacements\) => currentPlacements\.map/);
});

// Tehkné Solutions
