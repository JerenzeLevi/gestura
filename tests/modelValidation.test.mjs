// Class-name validation: the check that used to be missing entirely, so a typo in a
// Teachable Machine class just meant the move silently never fired.

import test from "node:test";
import assert from "node:assert/strict";

import { validateClassLabels } from "../js/modelValidation.js";
import { REQUIRED_CLASSES } from "../js/gestureConfig.js";
import { readRepoJson } from "./helpers.mjs";

test("accepts the exact set of required classes", () => {
  const result = validateClassLabels([...REQUIRED_CLASSES]);
  assert.equal(result.ok, true);
  assert.equal(result.usable, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.missing, []);
});

test("class order does not matter", () => {
  const result = validateClassLabels([...REQUIRED_CLASSES].reverse());
  assert.equal(result.ok, true);
});

test("reports a missing class by name", () => {
  const labels = REQUIRED_CLASSES.filter((c) => c !== "Ultimate");
  const result = validateClassLabels(labels);
  assert.equal(result.usable, false);
  assert.deepEqual(result.missing, ["Ultimate"]);
  assert.match(result.errors.join(" "), /Ultimate/);
});

test("reports several missing classes", () => {
  const result = validateClassLabels(["Idle", "Jab"]);
  assert.equal(result.usable, false);
  assert.equal(result.missing.length, REQUIRED_CLASSES.length - 2);
});

test("catches wrong capitalisation instead of calling the class missing", () => {
  const labels = REQUIRED_CLASSES.map((c) => (c === "Dodge Left" ? "Dodge left" : c));
  const result = validateClassLabels(labels);
  assert.equal(result.usable, false);
  assert.deepEqual(result.missing, []); // it is renamed, not absent
  assert.deepEqual(result.renamed, [{ expected: "Dodge Left", found: "Dodge left" }]);
  assert.match(result.errors.join(" "), /must be spelled exactly "Dodge Left"/);
});

test("catches stray whitespace in a class name", () => {
  const labels = REQUIRED_CLASSES.map((c) => (c === "Jab" ? " Jab " : c));
  const result = validateClassLabels(labels);
  assert.equal(result.usable, false);
  assert.equal(result.renamed[0].expected, "Jab");
});

test("catches a double space in a two-word class name", () => {
  const labels = REQUIRED_CLASSES.map((c) => (c === "Dodge Right" ? "Dodge  Right" : c));
  const result = validateClassLabels(labels);
  assert.equal(result.usable, false);
  assert.equal(result.renamed[0].expected, "Dodge Right");
});

test("rejects duplicate class names", () => {
  const result = validateClassLabels([...REQUIRED_CLASSES, "Jab"]);
  assert.equal(result.usable, false);
  assert.deepEqual(result.duplicates, ["jab"]);
  assert.match(result.errors.join(" "), /unique/);
});

test("tolerates an extra class but warns about it", () => {
  const result = validateClassLabels([...REQUIRED_CLASSES, "Wave"]);
  assert.equal(result.usable, true, "every required class is still present");
  assert.equal(result.ok, false, "but the model is not an exact match");
  assert.deepEqual(result.extra, ["Wave"]);
  assert.equal(result.errors.length, 0);
  assert.match(result.warnings.join(" "), /Wave/);
});

test("rejects an empty or non-array label list", () => {
  for (const input of [[], null, undefined, "Idle"]) {
    const result = validateClassLabels(input);
    assert.equal(result.usable, false);
    assert.equal(result.errors.length > 0, true);
  }
});

// Guards the committed model: if someone re-exports it with different classes, this fails.
test("the committed model/metadata.json matches the game's classes", async () => {
  const metadata = await readRepoJson("model/metadata.json");
  const result = validateClassLabels(metadata.labels);
  assert.equal(
    result.ok,
    true,
    `model/metadata.json labels do not match the game: ${result.errors.concat(result.warnings).join(" ")}`
  );
});
