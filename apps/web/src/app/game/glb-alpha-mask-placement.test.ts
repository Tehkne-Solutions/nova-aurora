import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./glb-alpha-mask-placement.tsx", import.meta.url), "utf8");

test("alpha-mask v8 computes material alpha from factor times base texture alpha", () => {
  assert.match(
    source,
    /float materialAlpha = u_base_color\.a \* mix\(1\.0, baseSample\.a, u_has_base_color_texture\);/
  );
});

test("MASK uses binary discard below authored cutoff", () => {
  assert.match(
    source,
    /if \(u_alpha_mask > 0\.5 && materialAlpha < u_alpha_cutoff\) discard;/
  );
  assert.match(source, /gl\.uniform1f\(alphaMaskLocation, resource\.drawable\.alphaMode === "MASK" \? 1 : 0\);/);
  assert.match(source, /gl\.uniform1f\(alphaCutoffLocation, resource\.drawable\.alphaCutoff\);/);
});

test("OPAQUE and surviving MASK fragments never enter alpha blending", () => {
  assert.match(source, /gl\.disable\(gl\.BLEND\);/);
  assert.doesNotMatch(source, /gl\.enable\(gl\.BLEND\);/);
  assert.doesNotMatch(source, /gl\.blendFunc\(/);
  assert.match(source, /gl_FragColor = vec4\(linearToSrgb\(linearColor\), 1\.0\);/);
});

test("runtime publishes the v8 renderer contract", () => {
  assert.match(source, /data-glb-renderer="first-party-webgl-pbr-alpha-mask-v8"/);
  assert.match(source, /data-material-state=\{materialState\}/);
});

// Tehkné Solutions
