// Practice mode: one player, live prediction bars for every class, and a "hold this move" challenge.
// Also the tool for checking the trained model during the presentation.

import { Region, startCamera, cameraErrorMessage } from "./camera.js";
import { loadModel, predict, getClassLabels, topPrediction, MODEL_ERROR } from "./model.js";
import { renderPredictions } from "./predictionBars.js";
import { playSound } from "./sound.js";

const CAMERA_WIDTH = 640;
const CAMERA_HEIGHT = 320;          // same 2:1 frame as the boxing arena
const PREDICT_INTERVAL_MS = 200;
const CONFIDENCE_THRESHOLD = 0.75;  // same as the boxing trigger, so practice matches the game
const HOLD_MS = 1200;               // how long a move must be held to pass a challenge

// Which part of the frame is classified. Halves match the boxing game's player zones.
const ZONES = {
  left:   { x: 0,                 w: CAMERA_WIDTH / 2 },
  center: { x: CAMERA_WIDTH / 4,  w: CAMERA_WIDTH / 2 },
  right:  { x: CAMERA_WIDTH / 2,  w: CAMERA_WIDTH / 2 },
};

const el = {};
let camera = null;
const region = new Region();
let predictTimer = null;
let busy = false;
let zone = "left";
let target = null;
let holdMs = 0;
let lastPredictAt = 0;
let score = 0;
let session = 0; // bumped on every enter/leave so stale async work can tell it is outdated

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle("error", isError);
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
    hold: document.getElementById("practiceHold"),
    score: document.getElementById("practiceScore"),
    skip: document.getElementById("practiceSkip"),
    status: document.getElementById("practiceStatus"),
  });

  el.zoneSelect.addEventListener("change", () => {
    zone = el.zoneSelect.value;
    el.zone.dataset.zone = zone;
  });
  el.skip.addEventListener("click", nextTarget);
}

export async function enterPractice() {
  const mySession = ++session;
  score = 0;
  el.score.textContent = "0";
  el.label.textContent = "—";
  el.bars.replaceChildren();
  el.zone.dataset.zone = zone;

  setStatus("Starting camera and loading the AI model…");

  // The camera does not depend on the model, so a missing model still shows the live camera.
  const [cam, mdl] = await Promise.allSettled([startCamera(CAMERA_WIDTH, CAMERA_HEIGHT), loadModel()]);
  if (mySession !== session) {
    if (cam.status === "fulfilled") cam.value.stop(); // user left while starting
    return;
  }
  if (cam.status === "rejected") {
    console.error(cam.reason);
    setStatus(cameraErrorMessage(cam.reason), true);
    return;
  }
  camera = cam.value;
  el.video.replaceChildren(camera.canvas);

  if (mdl.status === "rejected") {
    console.error(mdl.reason);
    setStatus(`${MODEL_ERROR} The camera works; predictions start once the model is added.`, true);
    return;
  }

  setStatus("Stand inside the highlighted zone and copy the move shown.");
  nextTarget();
  lastPredictAt = performance.now();
  predictTimer = setInterval(predictFrame, PREDICT_INTERVAL_MS);
}

export function leavePractice() {
  session += 1;
  if (predictTimer) clearInterval(predictTimer);
  if (camera) camera.stop();
  predictTimer = null;
  camera = null;
  busy = false;
  el.video.replaceChildren(el.placeholder);
}

function nextTarget() {
  const moves = getClassLabels().filter((c) => c !== "Idle" && c !== target);
  target = moves.length ? moves[Math.floor(Math.random() * moves.length)] : null;
  holdMs = 0;
  el.target.textContent = target ?? "—";
  el.hold.style.width = "0%";
}

async function predictFrame() {
  if (!camera || busy) return;
  busy = true;
  try {
    const z = ZONES[zone];
    const predictions = await predict(region.capture(camera.canvas, z.x, 0, z.w, CAMERA_HEIGHT));
    if (!camera) return; // left the screen while predicting

    const top = topPrediction(predictions);
    const confident = top.probability >= CONFIDENCE_THRESHOLD;
    el.label.textContent = confident ? top.className : "Uncertain";
    renderPredictions(el.bars, predictions);
    updateChallenge(confident ? top.className : null);
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
  }
}

function updateChallenge(label) {
  const now = performance.now();
  const elapsed = now - lastPredictAt;
  lastPredictAt = now;
  if (!target) return;

  holdMs = label === target ? holdMs + elapsed : 0;
  el.hold.style.width = `${Math.min(100, (holdMs / HOLD_MS) * 100)}%`;

  if (holdMs >= HOLD_MS) {
    score += 1;
    el.score.textContent = String(score);
    playSound("success");
    nextTarget();
  }
}
