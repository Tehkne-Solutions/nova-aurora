import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./market-production-console.tsx", import.meta.url), "utf8");

test("console exposes canonical available balance with posted and reserved context", () => {
  assert.match(source, /postedMinor\?: string \| number/);
  assert.match(source, /reservedMinor\?: string \| number/);
  assert.match(source, /availableMinor\?: string \| number/);
  assert.match(source, /const availableMinor = wallet\?\.availableMinor \?\? wallet\?\.value \?\? 0/);
  assert.match(source, /<span>Saldo disponível<\/span>/);
  assert.match(source, /Postado \{money\(postedMinor\)\} · reservado \{money\(reservedMinor\)\}/);
});

test("console performs bounded five-second live refresh only while visible", () => {
  assert.match(source, /const LIVE_REFRESH_INTERVAL_MS = 5_000/);
  assert.match(source, /document\.visibilityState === "hidden"/);
  assert.match(source, /window\.setInterval\(\(\) => void refreshLiveState\(\), LIVE_REFRESH_INTERVAL_MS\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(source, /document\.removeEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(source, /window\.clearInterval\(timer\)/);
});

test("live refresh converges both private economy and selected public market", () => {
  assert.match(source, /await Promise\.all\(\[\s*refreshPrivate\(\),\s*selectedItemCode \? refreshMarket\(selectedItemCode\)/s);
  assert.match(source, /data-live-refresh-ms=\{LIVE_REFRESH_INTERVAL_MS\}/);
});

test("background refresh preserves last known-good state on transient failure", () => {
  assert.match(source, /Preserve the last known-good economy state/);
  assert.match(source, /catch \{/);
});

// Tehkné Solutions
