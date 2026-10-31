// Practice mode: one player, live prediction bars for every class, and a "hold this move" challenge.
// Also the tool for checking the trained model during the presentation.
//
// Uses the same GestureDetector and the same thresholds as the boxing game, so what
// works here works in a match.

import { Region, startCamera, cameraErrorMessage, CAMERA_LOST_MESSAGE } from "./camera.js";
import {
  MODEL_STATE,
  getClassLabels,
  getModelState,
  getValidation,
  isModelUsable,
  loadModel,
  modelErrorMessage,
  predict,
  resetModel,
} from "./model.js";
import { describeValidation } from "./modelValidation.js";
import { renderPredictions } from "./predictionBars.js";
import { playSound } from "./sound.js";
import { GestureDetector, REASON } from "./gestureDetector.js";
import { DETECTION, GESTURE_HINTS, IDLE_CLASS, PRACTICE } from "./gestureConfig.js";

const CAMERA_WIDTH = 640;
const CAMERA_HEIGHT = 320; // same 2:1 frame as the boxing arena

// Which part of the frame is classified. Halves match the boxing game's player zones.
const ZONES = {
  left: { x: 0, w: CAMERA_WIDTH / 2 },
  center: { x: CAMERA_WIDTH / 4, w: CAMERA_WIDTH / 2 },
  right: { x: CAMERA_WIDTH / 2, w: CAMERA_WIDTH / 2 },
};

const el = {};
const region = new Region();
const detector = new GestureDetector();
let camera = null;
let predictTimer = null;
let predicting = false;
let zone = "left";
let target = null;
let holdMs = 0;
let uncertainMs = 0;
let lastPredictAt = 0;
let score = 0;
let skipped = 0;
let session = 0; // bumped on every enter/leave so stale async work can tell it is outdated

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle("error", isError);
}

// Keeping the spinner turning on "Starting camera…" is misleading once it has failed.
function setPlaceholder(text, spinning) {
  el.placeholder.querySelector("p").textContent = text;
  el.placeholder.querySelector(".spinner").hidden = !spinning;
}

function setFeedback(message, kind = "") {
  el.feedback.textContent = message;
  el.feedback.dataset.kind = kind;
}

export function initPractice() {
  Object.assign(el, {
    video: document.getElementById("practiceVideo"),
    placeholder: document.querySelector("#practiceVideo .arena-placeholder"),
    zone: document.getElementById("practiceZone"),
    zoneSelect: document.getElementById("practiceZoneSelect"),
    label: document.getElementById("practiceLabel"),
    bars: document.getElementById("practiceBars"),
    target: document.getElementById("practiceTarget"),
    targetHint: document.getElementById("practiceTargetHint"),
    hold: document.getElementById("practiceHold"),
    holdMeter: document.getElementById("practiceHoldMeter"),
    score: document.getElementById("practiceScore"),
    skipped: document.getElementById("practiceSkipped"),
    skip: document.getElementById("practiceSkip"),
    retry: document.getElementById("practiceRetry"),
    feedback: document.getElementById("practiceFeedback"),
    status: document.getElementById("practiceStatus"),
  });

  el.zoneSelect.addEventListener("change", () => {
    zone = el.zoneSelect.value;
    el.zone.dataset.zone = zone;
    // The new zone sees a different part of the room, so old readings mean nothing.
    detector.reset();
    resetHold();
    setFeedback(`Zone changed to ${el.zoneSelect.selectedOptions[0].textContent}. Step into the highlighted box.`);
  });
  el.skip.addEventListener("click", () => {
    if (!target) return;
    skipped += 1;
    el.skipped.textContent = String(skipped);
    nextTarget();
  });
  el.retry.addEventListener("click", retryModel);
}

export async function enterPractice() {
  const mySession = ++session;
  score = 0;
  skipped = 0;
  target = null;
  detector.reset();
  resetHold();
  el.score.textContent = "0";
  el.skipped.textContent = "0";
  el.label.textContent = "—";
  el.target.textContent = "—";
  el.targetHint.textContent = "";
  el.bars.replaceChildren();
  el.zone.dataset.zone = zone;
  el.retry.hidden = true;
  el.skip.disabled = true;
  setFeedback("");
  setPlaceholder("Starting camera…", true);
  setStatus("Starting camera and loading the AI model…");

  // The camera does not depend on the model, so a missing model still shows the live camera.
  const [cam, mdl] = await Promise.allSettled([startCamera(CAMERA_WIDTH, CAMERA_HEIGHT), loadModel()]);
  if (mySession !== session) {
    if (cam.status === "fulfilled") cam.value.stop(); // user left while starting
    return;
  }
  if (cam.status === "rejected") {
    console.error(cam.reason);
    setPlaceholder("Camera unavailable", false);
    setStatus(cameraErrorMessage(cam.reason), true);
    return;
  }
  camera = cam.value;
  camera.onLost = () => {
    if (mySession !== session) return;
    stopPredicting();
    setStatus(CAMERA_LOST_MESSAGE, true);
  };
  el.video.replaceChildren(camera.canvas);

  if (mdl.status === "rejected") {
    console.error(mdl.reason);
    setStatus(`${modelErrorMessage(mdl.reason)} The camera works; predictions start once the model loads.`, true);
    el.retry.hidden = false;
    return;
  }

  if (!isModelUsable()) {
    const validation = getValidation();
    console.error("Model class names do not match the game:", validation);
    setStatus(`${describeValidation(validation)} See model/README.md.`, true);
    el.retry.hidden = false;
    // Challenges need the real class names, but the live bars still help diagnose it.
    startPredicting();
    return;
  }

  const warning = getValidation()?.warnings?.length ? ` ${describeValidation(getValidation())}` : "";
  setStatus(`Stand inside the highlighted zone and copy the move shown.${warning}`);
  el.skip.disabled = false;
  nextTarget();
  startPredicting();
}

export function leavePractice() {
  session += 1;
  stopPredicting();
  if (camera) camera.stop();
  camera = null;
  el.video.replaceChildren(el.placeholder);
}

function startPredicting() {
  stopPredicting();
  lastPredictAt = performance.now();
  predictTimer = setInterval(predictFrame, DETECTION.practiceIntervalMs);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function stopPredicting() {
  if (predictTimer) clearInterval(predictTimer);
  predictTimer = null;
  predicting = false;
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

// A hidden tab should not burn CPU on inference, and the hold bar should not
// creep forward while nobody can see it.
function onVisibilityChange() {
  if (!camera) return;
  if (document.hidden) {
    if (predictTimer) clearInterval(predictTimer);
    predictTimer = null;
  } else if (!predictTimer) {
    detector.reset();
    resetHold();
    lastPredictAt = performance.now();
    predictTimer = setInterval(predictFrame, DETECTION.practiceIntervalMs);
  }
}

function resetHold() {
  holdMs = 0;
  uncertainMs = 0;
  if (el.hold) el.hold.style.width = "0%";
  if (el.holdMeter) el.holdMeter.setAttribute("aria-valuenow", "0");
}

function nextTarget() {
  // Only classes the loaded model actually reports can be asked for.
  const moves = getClassLabels().filter((c) => c !== IDLE_CLASS && c !== target);
  target = moves.length ? moves[Math.floor(Math.random() * moves.length)] : null;
  resetHold();
  detector.reset(); // a pose already held should not instantly complete the new challenge
  el.target.textContent = target ?? "—";
  el.targetHint.textContent = target ? (GESTURE_HINTS[target] ?? "") : "";
  if (!target) setFeedback("The model reports no usable moves to practise.", "bad");
}

async function retryModel() {
  el.retry.disabled = true;
  setStatus("Loading the AI model again…");
  resetModel();
  let error = null;
  try {
    await loadModel();
  } catch (err) {
    console.error(err);
    error = err;
  } finally {
    el.retry.disabled = false;
  }

  if (getModelState() === MODEL_STATE.READY) {
    stopPredicting();
    if (camera) camera.stop();
    camera = null;
    el.video.replaceChildren(el.placeholder);
    await enterPractice();
    return;
  }
  const validation = getValidation();
  setStatus(
    validation && !validation.usable
      ? `${describeValidation(validation)} See model/README.md.`
      : modelErrorMessage(error),
    true
  );
}

async function predictFrame() {
  if (!camera || !camera.active || predicting) return;
  const mySession = session;
  predicting = true;
  try {
    const z = ZONES[zone];
    const frame = region.capture(camera.canvas, z.x, 0, z.w, CAMERA_HEIGHT);
    if (!frame) return;
    // A featureless zone is rejected before the model sees it: the model answers
    // confidently for a blank image, and that answer is never meaningful.
    if (region.isBlank()) {
      detector.reset();
      resetHold();
      el.label.textContent = "No image";
      el.bars.replaceChildren();
      setFeedback("The selected zone is blank — check the lens is not covered and turn on a light.", "bad");
      return;
    }
    const predictions = await predict(frame);
    if (mySession !== session || !camera) return; // left the screen while predicting

    const reading = detector.update(predictions);
    el.label.textContent = reading.label ?? "Uncertain";
    renderPredictions(el.bars, reading.predictions);
    updateChallenge(reading);
  } catch (err) {
    console.error(err);
    setFeedback("A prediction failed. If this keeps happening, reload the page.", "bad");
  } finally {
    if (mySession === session) predicting = false;
    // Updated even on the error path: otherwise the next reading would be credited
    // with all the time the failure took and complete a challenge instantly.
    lastPredictAt = performance.now();
  }
}

function updateChallenge(reading) {
  const now = performance.now();
  // Clamp so a stalled tab or a slow first inference cannot fill the bar in one step.
  const elapsed = Math.min(DETECTION.practiceIntervalMs * 3, Math.max(0, now - lastPredictAt));

  if (!target) {
    describeReading(reading);
    return;
  }

  if (reading.label === target) {
    holdMs += elapsed;
    uncertainMs = 0;
  } else if (reading.label === null) {
    // One or two unclear frames should not wipe out a good hold.
    uncertainMs += elapsed;
    if (uncertainMs > PRACTICE.graceMs) holdMs = 0;
  } else {
    holdMs = 0;
    uncertainMs = 0;
  }

  const progress = Math.min(100, (holdMs / PRACTICE.holdMs) * 100);
  el.hold.style.width = `${progress}%`;
  el.holdMeter.setAttribute("aria-valuenow", String(Math.round(progress)));

  if (holdMs >= PRACTICE.holdMs) {
    score += 1;
    el.score.textContent = String(score);
    playSound("success");
    setFeedback(`Challenge completed: ${target}.`, "good");
    nextTarget();
    return;
  }

  describeReading(reading);
}

// The five feedback states the player can act on.
function describeReading(reading) {
  if (!reading.top) {
    setFeedback("Waiting for the camera…");
    return;
  }
  const confidence = `${Math.round(reading.top.probability * 100)}%`;

  if (reading.reason === REASON.NO_POSE) {
    setFeedback("Move farther into the highlighted zone — nothing recognisable is in it.", "bad");
  } else if (reading.reason === REASON.LOW_CONFIDENCE) {
    setFeedback(`Confidence too low (${confidence}) — make the pose bigger and hold still.`, "warn");
  } else if (reading.reason === REASON.AMBIGUOUS) {
    setFeedback(
      `Torn between ${reading.top.className} and ${reading.runnerUp?.className ?? "another move"} — make the pose clearer.`,
      "warn"
    );
  } else if (target && reading.label === target) {
    setFeedback("Hold your position…", "good");
  } else {
    setFeedback(`Gesture detected: ${reading.label} (${confidence}).`);
  }
}
