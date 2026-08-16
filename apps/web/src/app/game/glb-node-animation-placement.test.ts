import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./glb-node-animation-placement.tsx", import.meta.url), "utf8");
const canonical = readFileSync(new URL("./glb-placement.ts", import.meta.url), "utf8");
const stateful = readFileSync(new URL("./glb-stateful-placement.tsx", import.meta.url), "utf8");

test("canonical GLB entrypoint routes persisted state into node animation v10", () => {
  assert.match(canonical, /export \{ GlbPlacement \} from "\.\/glb-stateful-placement";/);
  assert.doesNotMatch(canonical, /glb-alpha-blend-placement/);
  assert.match(stateful, /GlbPlacement as CertifiedGlbPlacement/);
  assert.match(stateful, /from "\.\/glb-node-animation-placement"/);
  assert.match(stateful, /prepareGlbForAnimationState\(buffer, normalizedState\)/);
  assert.match(source, /data-glb-renderer="first-party-webgl-pbr-node-animation-v10"/);
});

test("persisted object policy reaches the renderer as loop versus one-shot hold", () => {
  assert.match(stateful, /animationPlaybackForObjectState\(normalizedState\)/);
  assert.match(stateful, /playbackLoop=\{playbackPolicy\.loop\}/);
  assert.match(stateful, /data-playback-policy=\{playbackPolicy\.loop \? "loop" : "one-shot-hold"\}/);
  assert.match(source, /playbackLoop\?: boolean;/);
  assert.match(source, /playbackLoop = true/);
  assert.match(source, /data-playback-loop=\{playbackLoop \? "true" : "false"\}/);
});

test("one-shot playback clamps at authored duration and stops scheduling while preserving the final pose", () => {
  assert.match(source, /const animationDurationSeconds = hasAnimation \? animationModel\.clips\[0\]!\.durationSeconds : 0;/);
  assert.match(source, /sampleCertifiedNodeWorldMatrices\(animationModel, 0, elapsed, playbackLoop\)/);
  assert.match(source, /if \(hasAnimation && !playbackLoop && elapsed >= animationDurationSeconds\) completed = true;/);
  assert.match(source, /if \(completed\) return;/);
  assert.match(source, /const resizeObserver = new ResizeObserver\(\(\) => draw\(performance\.now\(\)\)\);/);
});

test("animated runtime schedules cancellable frames only while visible", () => {
  assert.match(source, /requestAnimationFrame\(/);
  assert.match(source, /cancelAnimationFrame\(frameId\)/);
  assert.match(source, /if \(!hasAnimation \|\| !visible \|\| disposed \|\| frameId !== null\) return;/);
  assert.match(source, /new IntersectionObserver\(/);
  assert.match(source, /if \(visible\) resume\(\); else pause\(\);/);
});

test("animation clock excludes time spent outside the viewport", () => {
  assert.match(source, /let accumulatedVisibleMs = 0;/);
  assert.match(source, /let visibleStartMs: number \| null = null;/);
  assert.match(source, /accumulatedVisibleMs \+= Math\.max\(0, performance\.now\(\) - visibleStartMs\)/);
  assert.match(source, /elapsedSeconds\(timestamp\)/);
});

test("cleanup cancels frame loop, disconnects observers and frees GPU resources", () => {
  assert.match(source, /disposed = true;\s*pause\(\);/s);
  assert.match(source, /resizeObserver\.disconnect\(\);/);
  assert.match(source, /intersectionObserver\?\.disconnect\(\);/);
  assert.match(source, /gl\.deleteBuffer\(resource\.positionBuffer\)/);
  assert.match(source, /gl\.deleteTexture\(whiteTexture\); gl\.deleteProgram\(program\);/);
});

test("static GLB remains supported without starting a RAF animation loop", () => {
  assert.match(source, /const hasAnimation = animationModel\.clips\.length > 0 && animationModel\.clips\[0\]!\.durationSeconds > 0;/);
  assert.match(source, /if \(hasAnimation\) \{ visibleStartMs = performance\.now\(\); schedule\(\); \}/);
  assert.match(source, /setAnimation\(animationModel\.clips\.length > 0 \? \(playbackLoop \? "animated-loop" : "animated-one-shot-hold"\) : "static"\)/);
});

test("animated transparency uses transformed centroid and inverse-transpose normals", () => {
  assert.match(source, /normalMatrix3\(model\)/);
  assert.match(source, /transformPoint\(model, resource\.drawable\.centroid\)/);
  assert.match(source, /transparent\.sort\(\(left, right\) => right\.depth - left\.depth\)/);
  assert.match(source, /determinant3\(model\) < 0 \? -1 : 1/);
});

// Tehkné Solutions
