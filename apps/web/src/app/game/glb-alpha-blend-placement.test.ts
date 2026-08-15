import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./glb-alpha-blend-placement.tsx", import.meta.url), "utf8");

test("alpha blend v9 uses straight alpha canvas composition", () => {
  assert.match(source, /premultipliedAlpha: false/);
  assert.match(source, /float outputAlpha = mix\(1\.0, materialAlpha, u_alpha_blend\);/);
  assert.match(source, /gl_FragColor = vec4\(linearToSrgb\(linearColor\), outputAlpha\);/);
});

test("solid pass writes depth and disables blending", () => {
  assert.match(source, /gl\.depthMask\(true\);\s*gl\.disable\(gl\.BLEND\);\s*for \(const resource of solidResources\)/s);
  assert.match(source, /resource\.drawable\.alphaMode !== "BLEND"/);
});

test("transparent pass sorts back to front and preserves solid depth", () => {
  assert.match(source, /\[\.\.\.transparentResources\]\.sort\(/);
  assert.match(source, /alphaBlendDepth\(right\.drawable, rotationDegrees, camera\) - alphaBlendDepth\(left\.drawable, rotationDegrees, camera\)/);
  assert.match(source, /gl\.depthMask\(false\);/);
  assert.match(source, /gl\.enable\(gl\.BLEND\);/);
  assert.match(source, /gl\.blendFunc\(gl\.SRC_ALPHA, gl\.ONE_MINUS_SRC_ALPHA\);/);
});

test("renderer restores depth writes and disables blend after transparent queue", () => {
  assert.match(source, /gl\.depthMask\(true\);\s*gl\.disable\(gl\.BLEND\);\s*\n\s*};/s);
});

test("MASK discard remains binary inside v9", () => {
  assert.match(source, /if \(u_alpha_mask > 0\.5 && materialAlpha < u_alpha_cutoff\) discard;/);
  assert.match(source, /resource\.drawable\.alphaMode === "MASK" \? 1 : 0/);
});

test("runtime publishes alpha blend v9 renderer contract", () => {
  assert.match(source, /data-glb-renderer="first-party-webgl-pbr-alpha-blend-v9"/);
  assert.match(source, /model\.alphaBlendedMaterials > 0/);
});

// Tehkné Solutions
