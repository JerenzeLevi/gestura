// Two-player boxing on one webcam.
// The mirrored 2:1 frame is split into a left half (P1) and a right half (P2);
// each half is classified separately by the same Teachable Machine model.
//
// This module owns the state and the rendering. The numbers live in js/gestureConfig.js,
// the rules in js/combat.js and the prediction-to-move pipeline in js/gestureDetector.js,
// so Practice and the unit tests share exactly the same behaviour.

import { Region, startCamera, cameraErrorMessage, CAMERA_LOST_MESSAGE } from "./camera.js";
import {
  MODEL_STATE,
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
import { DETECTION, DODGE_MOVES, IDLE_CLASS, LIMITS, MATCH } from "./gestureConfig.js";
import {
  HIT,
  REJECT,
  canGuard,
  clampHp,
  clampMeter,
  clampStamina,
  matchOutcome,
  resolveAttack,
  resolveDodge,
  roundWinnerIndex,
  tickStamina,
} from "./combat.js";

const CAMERA_WIDTH = 640;
const CAMERA_HEIGHT = 320;

// A hidden tab stops requestAnimationFrame, so the first frame back can report a
// multi-second delta. Clamping keeps a backgrounded tab from draining the round timer.
const MAX_FRAME_DT = 0.1;

const el = {};
const regions = [new Region(), new Region()];
let fighters = [];
let camera = null;
let session = 0;
let predictTimer = null;
let rafId = null;
let predicting = false;
let timeouts = [];
let state = "waiting"; // waiting | countdown | fighting | roundOver | matchOver | paused
let resumeState = null; // the state to go back to when the tab becomes visible again
let round = 1;
let roundsPlayed = 0;
let roundHistory = [];
let timeLeft = MATCH.roundSeconds;
let lastFrameAt = 0;

function createFighter(index) {
  return {
    index,
    name: `P${index + 1}`,
    hp: LIMITS.maxHp,
    stamina: LIMITS.maxStamina,
    meter: 0,
    wins: 0,
    guarding: false,
    guardLockedUntil: 0,
    dodgeUntil: 0,
    cooldowns: {},
    detector: new GestureDetector(),
    reading: null,
    stats: emptyStats(),
  };
}

// Only events the game actually raises are counted, so the summary cannot invent numbers.
function emptyStats() {
  return {
    movesAttempted: 0,
    hitsLanded: 0,
    damageDealt: 0,
    blocks: 0, // attacks this fighter absorbed while guarding
    dodges: 0, // attacks this fighter avoided with a dodge
    ultimatesLanded: 0,
    knockouts: 0,
    guardBreaks: 0,
  };
}

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle("error", isError);
}

// The arena placeholder sits behind the camera canvas. Leaving it on "Starting camera…"
// with the spinner turning is misleading once starting has definitively failed.
function setPlaceholder(text, spinning) {
  el.placeholder.querySelector("p").textContent = text;
  el.placeholder.querySelector(".spinner").hidden = !spinning;
}

export function initBoxing() {
  Object.assign(el, {
    arena: document.getElementById("arenaVideo"),
    placeholder: document.querySelector("#arenaVideo .arena-placeholder"),
    message: document.getElementById("arenaMessage"),
    round: document.getElementById("roundLabel"),
    timer: document.getElementById("roundTimer"),
    start: document.getElementById("fightStart"),
    retry: document.getElementById("fightRetry"),
    status: document.getElementById("boxingStatus"),
    summary: document.getElementById("matchSummary"),
    summaryTitle: document.getElementById("matchSummaryTitle"),
    summaryScore: document.getElementById("matchSummaryScore"),
    summaryRounds: document.getElementById("matchSummaryRounds"),
    summaryStats: document.getElementById("matchSummaryStats"),
    summaryRematch: document.getElementById("matchSummaryRematch"),
    players: [1, 2].map((n) => {
      const hud = document.querySelector(`.fighter-hud[data-player="${n}"]`);
      return {
        hud,
        hp: hud.querySelector(".hp .meter-fill"),
        hpLag: hud.querySelector(".hp .meter-lag"),
        hpText: hud.querySelector(".hp-text"),
        stamina: hud.querySelector(".stamina .meter-fill"),
        ult: hud.querySelector(".ult .meter-fill"),
        ultBar: hud.querySelector(".ult"),
        pips: hud.querySelector(".pips"),
        overlay: document.querySelector(`.half-overlay[data-player="${n}"]`),
        live: document.querySelector(`.live-pred[data-player="${n}"]`),
      };
    }),
  });
  el.players.forEach((p) => {
    p.liveLabel = p.live.querySelector(".live-label");
    p.liveBars = p.live.querySelector(".bars");
    p.liveHint = p.live.querySelector(".live-hint");
    p.ready = p.live.querySelector(".zone-ready");
  });

  el.start.addEventListener("click", startMatch);
  el.retry.addEventListener("click", retryModel);
  el.summaryRematch.addEventListener("click", () => {
    hideSummary();
    startMatch();
  });
  document.addEventListener("visibilitychange", onVisibilityChange);
}

export async function enterBoxing() {
  const mySession = ++session;
  fighters = [createFighter(0), createFighter(1)];
  state = "waiting";
  resumeState = null;
  round = 1;
  roundsPlayed = 0;
  roundHistory = [];
  timeLeft = MATCH.roundSeconds;
  el.start.disabled = true;
  el.start.textContent = "Start fight";
  el.retry.hidden = true;
  el.message.textContent = "";
  el.message.hidden = false;
  hideSummary();
  resetLivePanels();
  setPlaceholder("Starting camera…", true);
  renderHud();
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
    showMessage("Camera unavailable");
    setStatus(cameraErrorMessage(cam.reason), true);
    return;
  }
  camera = cam.value;
  camera.onLost = () => {
    if (mySession !== session) return;
    stopLoops();
    state = "waiting";
    el.start.disabled = true;
    showMessage("Camera lost");
    setStatus(CAMERA_LOST_MESSAGE, true);
  };
  el.arena.replaceChildren(camera.canvas);

  if (mdl.status === "rejected") {
    console.error(mdl.reason);
    showMessage("AI model unavailable");
    setStatus(`${modelErrorMessage(mdl.reason)} The camera works; the fight unlocks once the model loads.`, true);
    el.retry.hidden = false;
    return;
  }

  // Loaded, but the class names may not be the ones the game looks moves up by.
  if (!isModelUsable()) {
    const validation = getValidation();
    console.error("Model class names do not match the game:", validation);
    showMessage("Model classes wrong");
    setStatus(
      `${describeValidation(validation)} The fight stays locked until the class names match. See model/README.md.`,
      true
    );
    el.retry.hidden = false;
    startPredictionLoop(); // live bars still help diagnose the mismatch
    return;
  }

  const warning = getValidation()?.warnings?.length ? ` ${describeValidation(getValidation())}` : "";
  showMessage("Get into position");
  setStatus(
    `P1 stands on the left, P2 on the right. Both zone checks should read "ready" before you start.${warning}`
  );
  el.start.disabled = false;
  startPredictionLoop();
}

export function leaveBoxing() {
  session += 1;
  stopLoops();
  if (camera) camera.stop();
  camera = null;
  state = "waiting";
  resumeState = null;
  hideSummary();
  el.arena.replaceChildren(el.placeholder);
}

function startPredictionLoop() {
  stopLoops();
  predictTimer = setInterval(predictBoth, DETECTION.predictIntervalMs);
  lastFrameAt = performance.now();
  rafId = requestAnimationFrame(tick);
}

function stopLoops() {
  clearTimers();
  if (predictTimer) clearInterval(predictTimer);
  if (rafId) cancelAnimationFrame(rafId);
  predictTimer = null;
  rafId = null;
  predicting = false;
}

function clearTimers() {
  timeouts.forEach(clearTimeout);
  timeouts = [];
}

function later(fn, ms) {
  timeouts.push(setTimeout(fn, ms));
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
    // Re-run the whole entry path so the camera, status and buttons end up consistent.
    if (camera) camera.stop();
    camera = null;
    el.arena.replaceChildren(el.placeholder);
    await enterBoxing();
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

// Pausing a hidden tab keeps the round timer honest and stops the webcam being
// classified while nobody is looking at the screen.
function onVisibilityChange() {
  if (!camera) return;
  if (document.hidden) {
    if (state !== "countdown" && state !== "fighting") return;
    resumeState = state;
    state = "paused";
    if (predictTimer) clearInterval(predictTimer);
    predictTimer = null;
    showMessage("PAUSED");
  } else if (state === "paused") {
    state = resumeState ?? "waiting";
    resumeState = null;
    fighters.forEach((f) => f.detector.reset());
    lastFrameAt = performance.now();
    if (!predictTimer) predictTimer = setInterval(predictBoth, DETECTION.predictIntervalMs);
    if (state === "fighting") showMessage("FIGHT!", 600);
    else el.message.textContent = "";
  }
}

// ---- Match flow ----

function startMatch() {
  clearTimers();
  hideSummary();
  fighters.forEach((f) => {
    f.wins = 0;
    f.meter = 0; // a rematch starts with empty ultimate meters
    f.stats = emptyStats();
  });
  round = 1;
  roundsPlayed = 0;
  roundHistory = [];
  el.start.textContent = "Restart";
  setStatus("Hold each move clearly, then return to Idle before the next one.");
  startRound();
}

function startRound() {
  fighters.forEach((f) => {
    Object.assign(f, {
      hp: LIMITS.maxHp,
      stamina: LIMITS.maxStamina,
      guarding: false,
      guardLockedUntil: 0,
      dodgeUntil: 0,
      cooldowns: {},
    });
    // Without this, a pose held through the countdown carries its streak into the
    // round: the move either fired late or never fired until the player reset.
    f.detector.reset();
    f.reading = null;
  });
  timeLeft = MATCH.roundSeconds;
  state = "countdown";
  renderHud();

  const steps = ["3", "2", "1"];
  steps.forEach((text, i) => later(() => { showMessage(text); playSound("beep"); }, i * 800));
  later(() => {
    showMessage("FIGHT!", 700);
    playSound("go");
    state = "fighting";
    lastFrameAt = performance.now();
  }, steps.length * 800);
}

function endRound(winner, knockout = false) {
  if (state === "roundOver" || state === "matchOver") return; // a KO and the timer can land together
  state = "roundOver";
  roundsPlayed += 1;
  if (winner) winner.wins += 1;
  if (winner && knockout) winner.stats.knockouts += 1;
  fighters.forEach((f) => {
    f.guarding = false;
    f.dodgeUntil = 0;
  });
  roundHistory.push({
    round,
    winnerIndex: winner ? winner.index : null,
    knockout,
    hp: fighters.map((f) => Math.ceil(f.hp)),
  });
  renderHud();

  const outcome = matchOutcome(fighters.map((f) => f.wins), roundsPlayed);
  if (outcome.over) {
    state = "matchOver";
    const champion = outcome.winnerIndex === null ? null : fighters[outcome.winnerIndex];
    showMessage(champion ? `${knockout ? "K.O.! " : ""}${champion.name} WINS THE MATCH!` : "MATCH DRAWN");
    el.start.textContent = "Rematch";
    playSound(champion ? "ultimate" : "beep");
    later(() => showSummary(champion), 1400);
    return;
  }

  const prefix = knockout ? "K.O.! " : "";
  showMessage(winner ? `${prefix}${winner.name} takes round ${round}` : `Round ${round}: draw`);
  later(() => {
    round += 1;
    startRound();
  }, MATCH.betweenRoundsMs);
}

// ---- Predictions → moves ----

async function predictBoth() {
  if (!camera || !camera.active || predicting) return;
  const mySession = session;
  predicting = true;
  try {
    const half = CAMERA_WIDTH / 2;
    const results = [];
    for (let i = 0; i < 2; i++) {
      const frame = regions[i].capture(camera.canvas, i * half, 0, half, CAMERA_HEIGHT);
      if (!frame) return;
      // A featureless half (covered lens, dark room) is rejected before the model sees
      // it. The model would answer confidently anyway, and it is never right.
      if (regions[i].isBlank()) {
        results.push(null);
        continue;
      }
      results.push(await predict(frame));
      // Leaving the screen mid-inference used to let a stale result reach the new match.
      if (mySession !== session) return;
    }
    const now = performance.now();
    results.forEach((predictions, i) => {
      if (predictions) handlePrediction(fighters[i], predictions, now);
      else handleBlankZone(fighters[i]);
    });
  } catch (err) {
    console.error(err);
    setStatus("A prediction failed. If this keeps happening, reload the page.", true);
  } finally {
    if (mySession === session) predicting = false;
  }
}

// A zone with nothing in it: drop any pose in progress and say so, rather than
// letting whatever the model would have guessed act on the match.
function handleBlankZone(f) {
  f.detector.reset();
  f.reading = null;
  f.guarding = false;
  const ui = el.players[f.index];
  ui.liveLabel.textContent = "No image";
  ui.ready.textContent = "nothing in frame";
  ui.ready.dataset.state = "bad";
  ui.liveHint.textContent = "This half of the frame is blank — check the lens is not covered and turn on a light.";
  ui.liveBars.replaceChildren();
}

function handlePrediction(f, predictions, now) {
  const reading = f.detector.update(predictions);
  f.reading = reading;
  renderLivePanel(f, reading);

  if (state !== "fighting") return;

  // Guard is a sustained state, not a one-shot move.
  const wantsGuard = reading.stable && reading.label === "Guard";
  f.guarding =
    wantsGuard && canGuard({ now, stamina: f.stamina, guardLockedUntil: f.guardLockedUntil }).ok;

  if (reading.triggered) performMove(f, reading.triggered, now);
}

function performMove(f, move, now) {
  const opponent = fighters[1 - f.index];
  f.stats.movesAttempted += 1;

  if (DODGE_MOVES[move]) {
    const dodge = resolveDodge({ now, stamina: f.stamina, cooldownUntil: f.cooldowns.Dodge ?? 0 });
    if (!dodge.ok) {
      if (dodge.reason === REJECT.TIRED) popText(f, "TOO TIRED", "muted");
      return;
    }
    f.stamina = clampStamina(f.stamina, -dodge.staminaCost);
    f.dodgeUntil = dodge.dodgeUntil;
    f.cooldowns.Dodge = dodge.cooldownUntil;
    popText(f, DODGE_MOVES[move], "muted");
    return;
  }

  const result = resolveAttack({
    move,
    now,
    attackerStamina: f.stamina,
    attackerMeter: f.meter,
    cooldownUntil: f.cooldowns[move] ?? 0,
    defenderGuarding: opponent.guarding,
    defenderDodgeUntil: opponent.dodgeUntil,
  });

  if (!result.ok) {
    if (result.reason === REJECT.METER) popText(f, "ULTIMATE NOT READY", "muted");
    else if (result.reason === REJECT.TIRED) popText(f, "TOO TIRED", "muted");
    return;
  }

  f.stamina = clampStamina(f.stamina, -result.staminaCost);
  f.cooldowns[move] = result.cooldownUntil;
  if (result.consumesMeter) f.meter = 0;
  popText(f, move.toUpperCase(), result.consumesMeter ? "ultimate" : "attack");

  if (result.outcome === HIT.MISS) {
    opponent.stats.dodges += 1;
    popText(opponent, "MISS", "muted");
    playSound("miss");
    renderHud();
    return;
  }

  const blocked = result.outcome === HIT.BLOCKED;
  opponent.hp = clampHp(opponent.hp, result.damage);
  opponent.meter = clampMeter(opponent.meter, result.defenderMeterGain);
  f.meter = clampMeter(f.meter, result.attackerMeterGain);

  f.stats.damageDealt += result.damage;
  if (blocked) opponent.stats.blocks += 1;
  else f.stats.hitsLanded += 1;
  if (result.consumesMeter) f.stats.ultimatesLanded += 1;

  popText(opponent, blocked ? `BLOCKED −${result.damage}` : `−${result.damage}`, blocked ? "muted" : "damage");
  flash(opponent, blocked ? "blocked" : "hit");
  playSound(result.consumesMeter ? "ultimate" : blocked ? "block" : "hit");
  renderHud();

  if (opponent.hp === 0) endRound(f, true);
}

// ---- Game loop and rendering ----

function tick(now) {
  const dt = Math.min(MAX_FRAME_DT, Math.max(0, (now - lastFrameAt) / 1000));
  lastFrameAt = now;

  if (state === "fighting") {
    timeLeft = Math.max(0, timeLeft - dt);
    fighters.forEach((f) => {
      const upkeep = tickStamina({
        stamina: f.stamina,
        guarding: f.guarding,
        guardLockedUntil: f.guardLockedUntil,
        dt,
        now,
      });
      f.stamina = upkeep.stamina;
      f.guarding = upkeep.guarding;
      f.guardLockedUntil = upkeep.guardLockedUntil;
      if (upkeep.guardBroke) {
        f.stats.guardBreaks += 1;
        popText(f, "GUARD BROKEN", "damage");
      }
    });

    if (timeLeft === 0) {
      const winnerIndex = roundWinnerIndex(fighters[0].hp, fighters[1].hp);
      endRound(winnerIndex === null ? null : fighters[winnerIndex]);
    }
  }

  renderHud();
  rafId = requestAnimationFrame(tick);
}

function renderHud() {
  el.round.textContent = state === "matchOver" ? "Match over" : `Round ${round} of ${MATCH.maxRounds}`;
  el.timer.textContent = String(Math.ceil(timeLeft));
  const now = performance.now();

  fighters.forEach((f, i) => {
    const ui = el.players[i];
    ui.hp.style.width = `${(f.hp / LIMITS.maxHp) * 100}%`;
    ui.hpLag.style.width = ui.hp.style.width; // trails behind via a delayed CSS transition
    ui.hpText.textContent = String(Math.ceil(f.hp));
    ui.stamina.style.width = `${(f.stamina / LIMITS.maxStamina) * 100}%`;
    ui.ult.style.width = `${(f.meter / LIMITS.maxMeter) * 100}%`;
    ui.ultBar.classList.toggle("ready", f.meter >= LIMITS.maxMeter);
    ui.hud.classList.toggle("guarding", f.guarding);
    ui.overlay.classList.toggle("guarding", f.guarding);
    ui.overlay.classList.toggle("dodging", f.dodgeUntil > now);
    ui.pips.textContent = "●".repeat(f.wins) + "○".repeat(Math.max(0, MATCH.roundsToWin - f.wins));
  });
}

function resetLivePanels() {
  el.players.forEach((ui) => {
    ui.liveLabel.textContent = "—";
    ui.liveHint.textContent = "Waiting for the camera…";
    ui.ready.textContent = "checking";
    ui.ready.dataset.state = "unknown";
    ui.liveBars.replaceChildren();
  });
}

function renderLivePanel(f, reading) {
  const ui = el.players[f.index];
  ui.liveLabel.textContent = reading.label
    ? `${reading.label} · ${Math.round(reading.top.probability * 100)}%`
    : "Uncertain";
  renderPredictions(ui.liveBars, reading.predictions);

  // "Zone check" is deliberately phrased as a confidence check: the model classifies
  // the whole half-frame, it does not detect or track a body.
  if (reading.reason === REASON.NO_POSE) {
    ui.ready.textContent = "nobody detected";
    ui.ready.dataset.state = "bad";
    ui.liveHint.textContent = "Step into this half of the frame, head to waist, and turn up the light.";
  } else if (reading.label === null) {
    ui.ready.textContent = "unclear";
    ui.ready.dataset.state = "warn";
    ui.liveHint.textContent =
      reading.reason === REASON.AMBIGUOUS
        ? `Torn between ${reading.top.className} and ${reading.runnerUp?.className ?? "another move"} — make the pose clearer.`
        : `Low confidence (${Math.round(reading.top.probability * 100)}%) — hold the pose still and fill more of this half.`;
  } else {
    ui.ready.textContent = "ready";
    ui.ready.dataset.state = "good";
    ui.liveHint.textContent =
      reading.label === IDLE_CLASS ? "Idle — throw a move when the round starts." : `Reading ${reading.label}.`;
  }
}

function showMessage(text, hideAfterMs) {
  el.message.textContent = text;
  el.message.hidden = false;
  el.message.classList.remove("pop-in");
  void el.message.offsetWidth; // restart the CSS animation
  el.message.classList.add("pop-in");
  if (hideAfterMs) later(() => (el.message.hidden = true), hideAfterMs);
}

function popText(f, text, kind) {
  const span = document.createElement("span");
  span.className = `pop ${kind}`;
  span.textContent = text;
  span.style.left = `${30 + Math.random() * 40}%`;
  span.addEventListener("animationend", () => span.remove());
  el.players[f.index].overlay.append(span);
}

function flash(f, kind) {
  const overlay = el.players[f.index].overlay;
  overlay.classList.remove("hit", "blocked");
  void overlay.offsetWidth;
  overlay.classList.add(kind);
}

// ---- End-of-match summary ----

function hideSummary() {
  if (el.summary) el.summary.hidden = true;
}

// Every figure here comes from an event the game raised during the match.
function showSummary(champion) {
  el.message.hidden = true; // the arena banner has said its piece
  el.summaryTitle.textContent = champion ? `${champion.name} wins the match` : "Match drawn";
  el.summaryScore.textContent = `${fighters[0].wins} – ${fighters[1].wins}`;

  el.summaryRounds.replaceChildren(
    ...roundHistory.map((entry) => {
      const li = document.createElement("li");
      const who =
        entry.winnerIndex === null ? "draw" : `${fighters[entry.winnerIndex].name}${entry.knockout ? " by K.O." : ""}`;
      li.textContent = `Round ${entry.round}: ${who} (HP ${entry.hp[0]} – ${entry.hp[1]})`;
      return li;
    })
  );

  const rows = [
    ["Rounds won", (f) => f.wins],
    ["Knockouts", (f) => f.stats.knockouts],
    ["Clean hits landed", (f) => f.stats.hitsLanded],
    ["Damage dealt", (f) => f.stats.damageDealt],
    ["Ultimates landed", (f) => f.stats.ultimatesLanded],
    ["Attacks blocked", (f) => f.stats.blocks],
    ["Attacks dodged", (f) => f.stats.dodges],
    ["Guard breaks", (f) => f.stats.guardBreaks],
    ["Moves thrown", (f) => f.stats.movesAttempted],
  ];

  const table = document.createElement("table");
  table.className = "summary-table";
  const head = document.createElement("thead");
  head.append(row("th", ["", fighters[0].name, fighters[1].name]));
  const body = document.createElement("tbody");
  for (const [label, read] of rows) {
    body.append(row("td", [label, String(read(fighters[0])), String(read(fighters[1]))], "th"));
  }
  table.append(head, body);
  el.summaryStats.replaceChildren(table);

  el.summary.hidden = false;
  el.summaryRematch.focus();
}

function row(cellTag, values, firstCellTag = cellTag) {
  const tr = document.createElement("tr");
  values.forEach((value, i) => {
    const cell = document.createElement(i === 0 ? firstCellTag : cellTag);
    if (cell.tagName === "TH") cell.scope = i === 0 ? "row" : "col";
    cell.textContent = value;
    tr.append(cell);
  });
  return tr;
}
