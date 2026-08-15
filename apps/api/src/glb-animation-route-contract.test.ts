import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./ugc-binary-asset-routes.ts", import.meta.url), "utf8");

test("GLB upload imports and executes node animation security", () => {
  assert.match(source, /validateGlbNodeAnimations,/);
  assert.match(source, /type GlbAnimationSecurityReport/);
  assert.match(source, /glbAnimationSecurity = validateGlbNodeAnimations\(bytes\);/);
});

test("animation security executes before upload enters scanning state", () => {
  const validation = source.indexOf("glbAnimationSecurity = validateGlbNodeAnimations(bytes);");
  const scanning = source.indexOf("SET status='scanning',updated_at=now()");
  assert.ok(validation >= 0, "animation validation call missing");
  assert.ok(scanning >= 0, "scanning transition missing");
  assert.ok(validation < scanning, "animation security must execute before scanning/quarantine");
});

test("claimed upload carries animation report through quarantine", () => {
  assert.match(source, /glbAnimationSecurity\s*\n\s*};/);
});

test("clean promotion exposes animation report but idempotent clean path does not synthesize one", () => {
  assert.match(
    source,
    /\.\.\.\(claim\.glbAnimationSecurity \? \{ glbAnimationSecurity: claim\.glbAnimationSecurity \} : \{\}\)/
  );
  const cleanBranch = source.slice(source.indexOf('if (claim.kind === "clean")'), source.indexOf("const quarantineObjectKey"));
  assert.doesNotMatch(cleanBranch, /glbAnimationSecurity/);
});

// Tehkné Solutions
