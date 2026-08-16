import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const hookSource = readFileSync(new URL("./use-ugc-world-realtime.ts", import.meta.url), "utf8");

test("location changes trigger immediate presence heartbeat without reconnecting", () => {
  assert.match(hookSource, /const heartbeatRef = useRef<\(\) => void>/);
  assert.match(hookSource, /heartbeatRef\.current = heartbeat/);
  assert.match(hookSource, /useEffect\(\(\) => \{\s*if \(!documentIsHidden\(\)\) heartbeatRef\.current\(\);\s*\}, \[locationCode\]\)/s);
  assert.match(hookSource, /locationCode: locationRef\.current/);
  assert.doesNotMatch(hookSource, /\}, \[locationCode\]\);\s*\/\/ reconnect/s);
});

test("client rejects delayed placement events from another location", () => {
  assert.match(hookSource, /locationCode\?: unknown/);
  assert.match(hookSource, /const eventLocationCode = event\.payload\?\.locationCode/);
  assert.match(hookSource, /typeof eventLocationCode === "string" && eventLocationCode !== locationRef\.current/);
  assert.match(hookSource, /return;/);
});

test("heartbeat indirection is cleared on unmount", () => {
  assert.match(hookSource, /heartbeatRef\.current = \(\) => undefined/);
  assert.match(hookSource, /socket\?\.close\(1000, "Componente desmontado"\)/);
});

// Tehkné Solutions
