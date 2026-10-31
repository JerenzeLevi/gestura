// The blank-frame safeguard.
//
// This is the one check that does not depend on the model, so it is worth testing on
// its own: the committed classifier reads a solid black frame as "Ultimate" at ~90%
// confidence, which no confidence threshold can reject. Measuring pixel detail can.

import test from "node:test";
import assert from "node:assert/strict";

// A canvas stand-in whose readback returns whatever the test last installed.
let pixels = new Uint8ClampedArray(0);

const context = () => ({
  drawImage() {},
  fillRect() {},
  getImageData: () => ({ data: pixels }),
});

globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: context }),
};

const { Region, BLANK_FRAME_DETAIL } = await import("../js/camera.js");

/** Builds RGBA pixel data from a list of grey levels. */
function grey(levels) {
  pixels = new Uint8ClampedArray(levels.length * 4);
  levels.forEach((level, i) => {
    pixels[i * 4] = level;
    pixels[i * 4 + 1] = level;
    pixels[i * 4 + 2] = level;
    pixels[i * 4 + 3] = 255;
  });
}

const region = () => new Region();

test("a solid frame has no detail at all", () => {
  grey(new Array(1024).fill(128));
  const r = region();
  assert.ok(r.detail() < 0.001, `expected ~0, got ${r.detail()}`);
  assert.equal(r.isBlank(), true);
});

test("solid black and solid white are both blank", () => {
  for (const level of [0, 255]) {
    grey(new Array(1024).fill(level));
    assert.equal(region().isBlank(), true, `level ${level}`);
  }
});

test("faint sensor noise on a dark frame still counts as blank", () => {
  // A covered lens is not perfectly uniform; it is uniform plus a little noise.
  grey(Array.from({ length: 1024 }, (_, i) => 6 + (i % 5)));
  const r = region();
  assert.ok(r.detail() < BLANK_FRAME_DETAIL, `detail ${r.detail()} should be under the threshold`);
  assert.equal(r.isBlank(), true);
});

test("a half-dark, half-bright frame is not blank", () => {
  grey(Array.from({ length: 1024 }, (_, i) => (i < 512 ? 20 : 200)));
  const r = region();
  assert.ok(r.detail() > BLANK_FRAME_DETAIL * 2, `detail ${r.detail()}`);
  assert.equal(r.isBlank(), false);
});

test("a varied scene is not blank", () => {
  grey(Array.from({ length: 1024 }, (_, i) => (i * 37) % 256));
  assert.equal(region().isBlank(), false);
});

test("the standard deviation is computed correctly", () => {
  // Half at 100, half at 150: mean 125, deviation 25 from each, so stddev is 25.
  grey([...new Array(512).fill(100), ...new Array(512).fill(150)]);
  assert.ok(Math.abs(region().detail() - 25) < 0.5, `got ${region().detail()}`);
});

test("a readback that throws never blocks the game", () => {
  const r = region();
  r.probeCtx.getImageData = () => {
    throw new Error("tainted canvas");
  };
  assert.equal(r.detail(), Number.POSITIVE_INFINITY);
  assert.equal(r.isBlank(), false, "a failed measurement must not look like an empty frame");
});

test("capture refuses an empty rectangle instead of predicting on nothing", () => {
  const r = region();
  const source = { width: 640, height: 320 };
  assert.equal(r.capture(source, 0, 0, 0, 320), null);
  assert.equal(r.capture(source, 0, 0, 320, 0), null);
  assert.equal(r.capture(null, 0, 0, 320, 320), null);
  assert.ok(r.capture(source, 0, 0, 320, 320), "a real rectangle still returns the canvas");
});

test("the threshold leaves room between noise and a real scene", () => {
  assert.ok(BLANK_FRAME_DETAIL > 0 && BLANK_FRAME_DETAIL < 30);
});
