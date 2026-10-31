// The prediction -> move pipeline: confidence floor, runner-up margin, streak,
// one-shot debounce and the empty-frame safeguard.

import test from "node:test";
import assert from "node:assert/strict";

import { GestureDetector, REASON, readingHint } from "../js/gestureDetector.js";
import { DETECTION, REQUIRED_CLASSES } from "../js/gestureConfig.js";
import { flat, oneHot, predictions } from "./helpers.mjs";

// Smoothing is tested on its own below; the trigger tests switch it off so a single
// update represents a single reading.
const raw = (overrides = {}) => new GestureDetector({ smoothing: 1, ...overrides });
const pose = (name, top = 0.95) => oneHot(REQUIRED_CLASSES, name, top);

/** Feeds the same pose n times and returns every class name that fired. */
function feed(detector, name, times, top = 0.95) {
  const fired = [];
  for (let i = 0; i < times; i++) {
    const reading = detector.update(pose(name, top));
    if (reading.triggered) fired.push(reading.triggered);
  }
  return fired;
}

test("needs triggerStreak consecutive readings before a move fires", () => {
  const d = raw();
  const first = d.update(pose("Jab"));
  assert.equal(first.label, "Jab");
  assert.equal(first.triggered, null, "one reading is not enough");
  assert.equal(first.stable, false);

  const second = d.update(pose("Jab"));
  assert.equal(second.triggered, "Jab");
  assert.equal(second.stable, true);
});

test("a held pose fires exactly once", () => {
  const d = raw();
  assert.deepEqual(feed(d, "Jab", 20), ["Jab"]);
});

test("the same move fires again only after the pose is released", () => {
  const d = raw();
  assert.deepEqual(feed(d, "Jab", 5), ["Jab"]);
  // Release through Idle, then pose again.
  feed(d, "Idle", 2);
  assert.deepEqual(feed(d, "Jab", 5), ["Jab"]);
});

test("an uncertain frame also counts as releasing the pose", () => {
  const d = raw();
  feed(d, "Jab", 3);
  d.update(flat(REQUIRED_CLASSES)); // nothing recognisable
  assert.deepEqual(feed(d, "Jab", 3), ["Jab"], "the pose can fire again after the gap");
});

test("Idle never fires a move", () => {
  const d = raw();
  assert.deepEqual(feed(d, "Idle", 20), []);
});

test("alternating poses each fire once", () => {
  const d = raw();
  const fired = [...feed(d, "Jab", 2), ...feed(d, "Kick", 2), ...feed(d, "Jab", 2)];
  assert.deepEqual(fired, ["Jab", "Kick", "Jab"]);
});

test("below the confidence floor nothing is recognised", () => {
  const d = raw();
  const reading = d.update(pose("Jab", 0.6)); // over noPose, under trigger
  assert.equal(reading.label, null);
  assert.equal(reading.reason, REASON.LOW_CONFIDENCE);
  assert.equal(reading.triggered, null);
});

test("two close classes are ambiguous, not a coin flip", () => {
  const d = raw();
  const reading = d.update(
    predictions({ Idle: 0.01, Jab: 0.5, Uppercut: 0.47, Kick: 0.01, Guard: 0.01 })
  );
  assert.equal(reading.reason, REASON.AMBIGUOUS);
  assert.equal(reading.label, null);
  assert.equal(reading.triggered, null);
});

test("a clear winner over the margin is recognised", () => {
  const d = raw();
  const reading = d.update(predictions({ Idle: 0.02, Jab: 0.9, Uppercut: 0.08 }));
  assert.equal(reading.reason, REASON.OK);
  assert.equal(reading.label, "Jab");
});

test("an empty-looking frame reports no-pose rather than guessing Idle", () => {
  const d = raw();
  const reading = d.update(flat(REQUIRED_CLASSES)); // every class at 12.5%
  assert.equal(reading.reason, REASON.NO_POSE);
  assert.equal(reading.absent, true);
  assert.equal(reading.label, null);
});

test("a weak Idle reading is still treated as no-pose", () => {
  const d = raw();
  // The safeguard for a player who has walked out of frame: Idle is only as
  // trustworthy as its training images, so a weak Idle is not accepted.
  const reading = d.update(pose("Idle", DETECTION.noPoseMaxConfidence - 0.05));
  assert.equal(reading.reason, REASON.NO_POSE);
});

test("hysteresis keeps a recognised pose through a dip, without re-firing it", () => {
  const d = raw();
  feed(d, "Guard", 2);
  // Confidence sags below the 75% trigger but stays above the release floor.
  const dip = d.update(pose("Guard", 0.65));
  assert.equal(dip.label, "Guard", "the pose is kept instead of flickering to Uncertain");
  assert.equal(dip.triggered, null, "and it does not fire a second time");
});

test("a pose that falls under the release floor is dropped", () => {
  const d = raw();
  feed(d, "Guard", 2);
  const dropped = d.update(pose("Guard", 0.5));
  assert.equal(dropped.label, null);
});

test("reset clears the streak, so a pose held through a countdown starts fresh", () => {
  const d = raw();
  d.update(pose("Jab"));
  d.reset();
  const after = d.update(pose("Jab"));
  assert.equal(after.triggered, null, "the first reading after a reset cannot fire");
  assert.equal(d.update(pose("Jab")).triggered, "Jab");
});

test("reset also clears the debounce, so the held pose can fire again", () => {
  const d = raw();
  feed(d, "Jab", 3);
  d.reset();
  assert.deepEqual(feed(d, "Jab", 3), ["Jab"]);
});

test("an empty prediction list is handled instead of throwing", () => {
  const d = raw();
  const reading = d.update([]);
  assert.equal(reading.label, null);
  assert.equal(reading.absent, true);
  assert.deepEqual(reading.predictions, []);
});

test("smoothing damps a single spike", () => {
  const d = new GestureDetector({ smoothing: 0.5 });
  d.update(pose("Idle", 0.95)); // settle on Idle
  d.update(pose("Idle", 0.95));
  const spike = d.update(pose("Ultimate", 0.95)); // one bad frame
  const ultimate = spike.predictions.find((p) => p.className === "Ultimate");
  assert.ok(ultimate.probability < 0.75, `smoothed to ${ultimate.probability}, expected under the trigger`);
  assert.equal(spike.triggered, null, "a one-frame spike must not fire a move");
});

test("smoothing still lets a sustained pose through", () => {
  const d = new GestureDetector({ smoothing: 0.5 });
  const fired = feed(d, "Uppercut", 8);
  assert.deepEqual(fired, ["Uppercut"], "a held pose fires once, a few frames later");
});

test("smoothing keeps the prediction list complete and in input order", () => {
  const d = new GestureDetector({ smoothing: 0.5 });
  const reading = d.update(pose("Jab"));
  assert.deepEqual(
    reading.predictions.map((p) => p.className),
    REQUIRED_CLASSES
  );
  const total = reading.predictions.reduce((sum, p) => sum + p.probability, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "the first reading passes the raw probabilities through");
});

test("readingHint explains each failure state in words a player can act on", () => {
  const d = raw();
  assert.match(readingHint(d.update(flat(REQUIRED_CLASSES))), /zone/i);
  d.reset();
  assert.match(readingHint(d.update(pose("Jab", 0.6))), /[Cc]onfidence/);
  d.reset();
  assert.match(
    readingHint(d.update(predictions({ Jab: 0.5, Uppercut: 0.47, Idle: 0.03 }))),
    /Not sure between/
  );
  d.reset();
  assert.match(readingHint(d.update(pose("Guard")), "Guard"), /Hold your position/);
  d.reset();
  assert.match(readingHint(d.update(pose("Guard")), "Kick"), /target is Kick/);
});
