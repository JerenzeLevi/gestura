// The confidence bars. Rendering needs a document, so the test provides a minimal
// stand-in that records what was built: enough to verify the ordering, the labels,
// the percentages and that class names are never injected as HTML.

import test from "node:test";
import assert from "node:assert/strict";

import { renderPredictions } from "../js/predictionBars.js";
import { predictions } from "./helpers.mjs";

function element(tag) {
  return {
    tag,
    className: "",
    textContent: "",
    style: {},
    children: [],
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
  };
}

// renderPredictions only touches document at call time, so installing the stand-in here is enough.
globalThis.document = { createElement: element };

const container = () => element("div");
const rowsOf = (box) => box.children;
const textOf = (row) => row.children[0].children.map((span) => span.textContent);
const widthOf = (row) => row.children[1].children[0].style.width;

test("renders one row per class, highest confidence first", () => {
  const box = container();
  renderPredictions(box, predictions({ Jab: 0.2, Guard: 0.7, Idle: 0.1 }));

  const rows = rowsOf(box);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => textOf(row)[0]), ["Guard", "Jab", "Idle"]);
});

test("marks only the leading row as top", () => {
  const box = container();
  renderPredictions(box, predictions({ Jab: 0.2, Guard: 0.7, Idle: 0.1 }));

  const rows = rowsOf(box);
  assert.equal(rows[0].className, "bar-row top");
  assert.equal(rows[1].className, "bar-row");
  assert.equal(rows[2].className, "bar-row");
});

test("shows rounded percentages and matching bar widths", () => {
  const box = container();
  renderPredictions(box, predictions({ Guard: 0.666, Jab: 0.334 }));

  const [first, second] = rowsOf(box);
  assert.deepEqual(textOf(first), ["Guard", "67%"]);
  assert.equal(widthOf(first), "67%");
  assert.deepEqual(textOf(second), ["Jab", "33%"]);
  assert.equal(widthOf(second), "33%");
});

test("handles the extremes without producing out-of-range widths", () => {
  const box = container();
  renderPredictions(box, predictions({ Jab: 1, Idle: 0 }));
  assert.equal(widthOf(rowsOf(box)[0]), "100%");
  assert.equal(widthOf(rowsOf(box)[1]), "0%");
});

test("replaces the previous rows instead of appending to them", () => {
  const box = container();
  renderPredictions(box, predictions({ Jab: 0.6, Idle: 0.4 }));
  renderPredictions(box, predictions({ Kick: 0.9, Idle: 0.1 }));

  const rows = rowsOf(box);
  assert.equal(rows.length, 2, "the old rows are gone");
  assert.equal(textOf(rows[0])[0], "Kick");
});

test("class names from the model metadata are set as text, never as markup", () => {
  const box = container();
  // Class names come from a file outside the app's control, so they must not be
  // interpolated into innerHTML.
  renderPredictions(box, predictions({ '<img src=x onerror="alert(1)">': 0.9, Idle: 0.1 }));

  const row = rowsOf(box)[0];
  assert.equal(textOf(row)[0], '<img src=x onerror="alert(1)">');
  assert.equal("innerHTML" in row, false, "the renderer never reaches for innerHTML");
});

test("an empty prediction list clears the container", () => {
  const box = container();
  renderPredictions(box, predictions({ Jab: 1 }));
  renderPredictions(box, []);
  assert.deepEqual(rowsOf(box), []);
});
