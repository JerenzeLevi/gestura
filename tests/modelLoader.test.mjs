// The model loader's state machine and the camera's error wording.
//
// Node has no Teachable Machine library and no camera, which is exactly the "model
// cannot be loaded" path the UI has to handle, so it can be exercised here for real.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MODEL_STATE,
  ModelLoadError,
  getClassLabels,
  getLastError,
  getModelState,
  isModelUsable,
  loadModel,
  modelErrorMessage,
  onModelStateChange,
  predict,
  resetModel,
} from "../js/model.js";
import { CAMERA_LOST_MESSAGE, cameraErrorMessage } from "../js/camera.js";

test("the loader starts idle and nothing is usable yet", () => {
  resetModel();
  assert.equal(getModelState(), MODEL_STATE.IDLE);
  assert.equal(isModelUsable(), false);
  assert.deepEqual(getClassLabels(), []);
});

test("predicting before the model is loaded rejects instead of throwing on a null", async () => {
  resetModel();
  await assert.rejects(() => predict({}), (err) => {
    assert.ok(err instanceof ModelLoadError);
    assert.equal(err.kind, "not-loaded");
    return true;
  });
});

test("a missing Teachable Machine library gives an actionable message, not a ReferenceError", async () => {
  resetModel();
  await assert.rejects(loadModel(), (err) => {
    assert.ok(err instanceof ModelLoadError, `expected ModelLoadError, got ${err?.name}`);
    assert.equal(err.kind, "library");
    assert.match(err.message, /library did not load/i);
    return true;
  });
  assert.equal(getModelState(), MODEL_STATE.ERROR);
  assert.equal(isModelUsable(), false);
});

test("a failed load is remembered and reported", async () => {
  resetModel();
  await loadModel().catch(() => {});
  const error = getLastError();
  assert.ok(error instanceof ModelLoadError);
  assert.equal(modelErrorMessage(error), error.message);
});

test("a failed load can be retried: it does not latch into a permanent failure", async () => {
  resetModel();
  await loadModel().catch(() => {});
  assert.equal(getModelState(), MODEL_STATE.ERROR);

  // A second attempt must actually try again rather than returning the cached rejection,
  // which is what makes the "Retry model load" button work.
  const second = loadModel();
  assert.ok(second instanceof Promise);
  await second.catch(() => {});
  assert.equal(getModelState(), MODEL_STATE.ERROR);

  resetModel();
  assert.equal(getModelState(), MODEL_STATE.IDLE, "resetModel clears the failure");
});

test("state changes are published to listeners", async () => {
  resetModel();
  const seen = [];
  const unsubscribe = onModelStateChange((state) => seen.push(state));
  await loadModel().catch(() => {});
  unsubscribe();

  assert.deepEqual(seen, [MODEL_STATE.LOADING, MODEL_STATE.ERROR]);

  const after = seen.length;
  resetModel();
  assert.equal(seen.length, after, "unsubscribing stops the updates");
});

test("a throwing listener cannot break the loader", async () => {
  resetModel();
  const unsubscribe = onModelStateChange(() => {
    throw new Error("listener blew up");
  });
  await loadModel().catch(() => {});
  unsubscribe();
  assert.equal(getModelState(), MODEL_STATE.ERROR, "the state still advanced");
  resetModel();
});

test("modelErrorMessage falls back to the generic advice for unknown errors", () => {
  assert.match(modelErrorMessage(new Error("boom")), /model\/ folder/);
  assert.match(modelErrorMessage(undefined), /model\/ folder/);
});

// ---- Camera messages ----

test("every getUserMedia failure maps to advice the player can act on", () => {
  const cases = {
    NotAllowedError: /address bar/i,
    SecurityError: /address bar/i,
    NotFoundError: /No camera was found/i,
    OverconstrainedError: /No camera was found/i,
    NotReadableError: /busy in another app/i,
    AbortError: /busy in another app/i,
    InsecureContextError: /localhost/i,
  };
  for (const [name, expected] of Object.entries(cases)) {
    assert.match(cameraErrorMessage({ name }), expected, `message for ${name}`);
  }
});

test("an unknown or absent camera error still produces a message", () => {
  for (const input of [{ name: "WeirdError" }, {}, null, undefined]) {
    const message = cameraErrorMessage(input);
    assert.equal(typeof message, "string");
    assert.ok(message.length > 20);
  }
});

test("there is a message for a camera that disappears mid-game", () => {
  assert.match(CAMERA_LOST_MESSAGE, /unplugged|taken over/i);
});
