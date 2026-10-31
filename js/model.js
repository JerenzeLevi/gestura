// Loads the Teachable Machine image model exported into ./model/
// (model.json, metadata.json, weights.bin).
//
// The model is shared by every screen, so it is loaded once and cached. Before
// handing it to the games this module:
//   - checks that both JSON files are actually reachable and well formed,
//   - checks the class names against the ones the game looks moves up by,
//   - keeps a load state and a precise error message for the UI,
//   - stays retriable, so a failed load can be fixed and tried again without a reload.

import { describeValidation, validateClassLabels } from "./modelValidation.js";

const MODEL_URL = "model/model.json";
const METADATA_URL = "model/metadata.json";

export const MODEL_STATE = {
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready", // loaded and the class names match
  INVALID: "invalid", // loaded but the class names do not match the game
  ERROR: "error", // could not be loaded at all
};

// Kept for the generic case; the loader produces a more specific message where it can.
export const MODEL_ERROR =
  "Could not load the AI model. Check that model.json, metadata.json and weights.bin are in the model/ folder.";

export class ModelLoadError extends Error {
  constructor(message, { cause, kind = "unknown" } = {}) {
    super(message);
    this.name = "ModelLoadError";
    this.kind = kind;
    this.cause = cause;
  }
}

let model = null;
let loading = null;
let state = MODEL_STATE.IDLE;
let validation = null;
let lastError = null;
const listeners = new Set();

export const getModelState = () => state;
export const getValidation = () => validation;
export const getLastError = () => lastError;
export const isModelUsable = () => state === MODEL_STATE.READY;

// Lets screens show "loading…" / "ready" / an error without polling.
export function onModelStateChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next) {
  state = next;
  for (const listener of listeners) {
    try {
      listener(next, { validation, error: lastError });
    } catch (err) {
      console.error(err);
    }
  }
}

async function fetchJson(url, label) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (cause) {
    throw new ModelLoadError(
      `${label} could not be requested. Serve the app over http (run start.bat) instead of opening index.html as a file.`,
      { cause, kind: "network" }
    );
  }
  if (response.status === 404) {
    throw new ModelLoadError(
      `${label} is missing from the model/ folder. Export the model from Teachable Machine and copy model.json, metadata.json and weights.bin into model/.`,
      { kind: "missing" }
    );
  }
  if (!response.ok) {
    throw new ModelLoadError(`${label} could not be read (HTTP ${response.status}).`, { kind: "unreadable" });
  }
  try {
    return await response.json();
  } catch (cause) {
    throw new ModelLoadError(`${label} is not valid JSON. Re-export the model from Teachable Machine.`, {
      cause,
      kind: "corrupt",
    });
  }
}

/**
 * Runs one throwaway prediction so the WebGL shaders are compiled and the weights are
 * uploaded to the GPU before the game asks for anything.
 *
 * Measured on the committed model: the very first prediction after load returns a
 * different, near-uniform distribution from every prediction after it (the same grey
 * frame gave a 19.9% top class first and a stable 70.5% from then on). Without a
 * warm-up that unreliable result is the one the first frame of a round sees, and the
 * first prediction is also the slowest.
 */
async function warmUp(loaded) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 224;
    canvas.height = 224;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await loaded.predict(canvas);
  } catch (err) {
    // A failed warm-up is not a failed load; the first real prediction will retry.
    console.warn("Model warm-up skipped:", err);
  }
}

async function load() {
  if (typeof tmImage === "undefined" || typeof tmImage.load !== "function") {
    throw new ModelLoadError(
      "The Teachable Machine library did not load. Check your internet connection (TensorFlow.js and the Teachable Machine library come from a CDN) and reload the page.",
      { kind: "library" }
    );
  }

  // Fetched first so a missing or malformed file gives a precise message, and so the
  // class names can be checked even if tmImage itself fails later.
  const metadata = await fetchJson(METADATA_URL, "model/metadata.json");
  await fetchJson(MODEL_URL, "model/model.json");

  const labelsFromMetadata = Array.isArray(metadata?.labels) ? metadata.labels : [];
  if (!labelsFromMetadata.length) {
    throw new ModelLoadError(
      "model/metadata.json has no class labels. Re-export the model from Teachable Machine.",
      { kind: "corrupt" }
    );
  }

  let loaded;
  try {
    loaded = await tmImage.load(MODEL_URL, METADATA_URL);
  } catch (cause) {
    throw new ModelLoadError(
      "The model files are present but TensorFlow.js could not load them. They may be from a different Teachable Machine project type — use an Image Project and export as TensorFlow.js. See the browser console for details.",
      { cause, kind: "incompatible" }
    );
  }

  await warmUp(loaded);

  // getClassLabels() is what the game actually looks moves up by, so validate that.
  const labels = loaded.getClassLabels?.() ?? labelsFromMetadata;
  validation = validateClassLabels(labels);
  model = loaded;

  if (!validation.usable) {
    lastError = new ModelLoadError(describeValidation(validation), { kind: "classes" });
    setState(MODEL_STATE.INVALID);
    return model;
  }

  lastError = null;
  setState(MODEL_STATE.READY);
  return model;
}

/**
 * Loads the model once and caches it. Concurrent callers share one load.
 * Resolves with the model even when the class names are wrong — check
 * `isModelUsable()` / `getValidation()` before starting gameplay.
 * Rejects with a ModelLoadError when the model cannot be loaded at all.
 */
export function loadModel() {
  if (model) return Promise.resolve(model);
  if (loading) return loading;

  lastError = null;
  validation = null;
  setState(MODEL_STATE.LOADING);

  loading = load().catch((err) => {
    loading = null; // allow a retry once the files or the connection are fixed
    lastError = err instanceof ModelLoadError ? err : new ModelLoadError(MODEL_ERROR, { cause: err });
    setState(MODEL_STATE.ERROR);
    throw lastError;
  });
  return loading;
}

/** Forgets a loaded or failed model so the next loadModel() starts from scratch. */
export function resetModel() {
  model = null;
  loading = null;
  validation = null;
  lastError = null;
  setState(MODEL_STATE.IDLE);
}

// Returns [{ className, probability }] for any image, video or canvas.
// Teachable Machine crops and resizes the input to its 224x224 training size.
export function predict(source) {
  if (!model) return Promise.reject(new ModelLoadError("The model is not loaded yet.", { kind: "not-loaded" }));
  return model.predict(source);
}

export function getClassLabels() {
  return model?.getClassLabels?.() ?? [];
}

export function topPrediction(predictions) {
  return predictions.reduce((best, p) => (p.probability > best.probability ? p : best));
}

/** A player-facing message for any error thrown by loadModel(). */
export function modelErrorMessage(err) {
  if (err instanceof ModelLoadError) return err.message;
  return MODEL_ERROR;
}
