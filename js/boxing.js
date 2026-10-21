// Two-player boxing on one webcam.
// The mirrored 2:1 frame is split into a left half (P1) and a right half (P2);
// each half is classified separately by the same Teachable Machine model.

import { Region, startCamera, cameraErrorMessage } from "./camera.js";
import { loadModel, predict, topPrediction, MODEL_ERROR } from "./model.js";
import { renderPredictions } from "./predictionBars.js";
import { playSound } from "./sound.js";

const CAMERA_WIDTH = 640;
const CAMERA_HEIGHT = 320;
const PREDICT_INTERVAL_MS = 150;

// A move fires when the same class is the top prediction, above this confidence,
// this many predictions in a row. Holding a pose does not repeat the move.
const TRIGGER_CONFIDENCE = 0.75;
const TRIGGER_STREAK = 2;

// Class names must match the Teachable Machine classes exactly (see model/README.md).
const ATTACKS = {
  Jab:      { damage: 5,  cooldownMs: 500,  stamina: 5,  meter: 10 },
  Uppercut: { damage: 12, cooldownMs: 1200, stamina: 12, meter: 15 },
  Kick:     { damage: 10, cooldownMs: 1000, stamina: 10, meter: 15 },
  Ultimate: { damage: 30, cooldownMs: 3000, stamina: 0,  meter: 0, needsFullMeter: true },
};
const DODGE = { durationMs: 500, cooldownMs: 1500, stamina: 8 };
// Both dodge directions share one cooldown; the class name only changes the pop text.
const DODGE_MOVES = { "Dodge Left": "← DODGE", "Dodge Right": "DODGE →" };
const GUARD_DAMAGE_FACTOR = 0.2;   // damage taken while guarding
const GUARD_DRAIN_PER_S = 10;      // stamina spent per second of guarding
const STAMINA_REGEN_PER_S = 12;
const METER_ON_HIT_TAKEN = 5;      // comeback bonus for the player who gets hit

const MAX_HP = 100;
const MAX_STAMINA = 100;
const MAX_METER = 100;
const ROUND_SECONDS = 60;
const ROUNDS_TO_WIN = 2;           // best of 3
const BETWEEN_ROUNDS_MS = 3000;

const el = {};
const regions = [new Region(), new Region()];
let fighters = [];
let camera = null;
let session = 0;
let predictTimer = null;
let rafId = null;
let busy = false;
let timeouts = [];
let state = "waiting"; // waiting | countdown | fighting | roundOver | matchOver
let round = 1;
let timeLeft = ROUND_SECONDS;
let lastFrameAt = 0;

function createFighter(index) {
  return {
    index,
    name: `P${index + 1}`,
    hp: MAX_HP,
    stamina: MAX_STAMINA,
    meter: 0,
    wins: 0,
    label: null,     // current confident class, or null when uncertain
    streak: 0,
    guarding: false,
    dodgeUntil: 0,
    cooldowns: {},
  };
}

function setStatus(message, isError = false) {
  el.status.textContent = message;
  el.status.classList.toggle("error", isError);
}

export function initBoxing() {
  Object.assign(el, {
    arena: document.getElementById("arenaVideo"),
    placeholder: document.querySelector("#arenaVideo .arena-placeholder"),
    message: document.getElementById("arenaMessage"),
    round: document.getElementById("roundLabel"),
    timer: document.getElementById("roundTimer"),
    start: document.getElementById("fightStart"),
    status: document.getElementById("boxingStatus"),
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
  });
  el.start.addEventListener("click", startMatch);
}

export async function enterBoxing() {
  const mySession = ++session;
  fighters = [createFighter(0), createFighter(1)];
  state = "waiting";
  round = 1;
  timeLeft = ROUND_SECONDS;
  el.start.disabled = true;
  el.start.textContent = "Start fight";
  el.message.textContent = "";
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
    setStatus(cameraErrorMessage(cam.reason), true);
    return;
  }
  camera = cam.value;
  el.arena.replaceChildren(camera.canvas);

  if (mdl.status === "rejected") {
    console.error(mdl.reason);
    showMessage("AI model missing");
    setStatus(`${MODEL_ERROR} The camera works; the fight unlocks once the model is added.`, true);
    return;
  }

  showMessage("Get into position");
  setStatus("P1 stands on the left, P2 on the right. Check that both live predictions react, then start.");
  el.start.disabled = false;
  predictTimer = setInterval(predictBoth, PREDICT_INTERVAL_MS);
  lastFrameAt = performance.now();
  rafId = requestAnimationFrame(tick);
}

export function leaveBoxing() {
  session += 1;
  clearTimers();
  if (predictTimer) clearInterval(predictTimer);
  if (rafId) cancelAnimationFrame(rafId);
  if (camera) camera.stop();
  predictTimer = null;
  rafId = null;
  camera = null;
  busy = false;
  state = "waiting";
  el.arena.replaceChildren(el.placeholder);
}

function clearTimers() {
  timeouts.forEach(clearTimeout);
  timeouts = [];
}

function later(fn, ms) {
  timeouts.push(setTimeout(fn, ms));
}

// ---- Match flow ----

function startMatch() {
  clearTimers();
  fighters.forEach((f) => (f.wins = 0));
  round = 1;
  el.start.textContent = "Restart";
  setStatus("Hold each move clearly, then return to Idle before the next one.");
  startRound();
}

function startRound() {
  fighters.forEach((f) => {
    Object.assign(f, { hp: MAX_HP, stamina: MAX_STAMINA, guarding: false, dodgeUntil: 0, cooldowns: {} });
  });
  timeLeft = ROUND_SECONDS;
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
  state = "roundOver";
  if (winner) winner.wins += 1;
  renderHud();

  if (winner && winner.wins >= ROUNDS_TO_WIN) {
    state = "matchOver";
    showMessage(`${knockout ? "K.O.! " : ""}${winner.name} WINS THE MATCH!`);
    el.start.textContent = "Rematch";
    playSound("ultimate");
    return;
  }

  const prefix = knockout ? "K.O.! " : "";
  showMessage(winner ? `${prefix}${winner.name} takes round ${round}` : `Round ${round}: draw`);
  later(() => {
    round += 1;
    startRound();
  }, BETWEEN_ROUNDS_MS);
}

// ---- Predictions → moves ----

async function predictBoth() {
  if (!camera || busy) return;
  busy = true;
  try {
    const half = CAMERA_WIDTH / 2;
    const results = [];
    for (let i = 0; i < 2; i++) {
      results.push(await predict(regions[i].capture(camera.canvas, i * half, 0, half, CAMERA_HEIGHT)));
    }
    if (!camera) return; // left the screen while predicting
    const now = performance.now();
    results.forEach((predictions, i) => handlePrediction(fighters[i], predictions, now));
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
  }
}

function handlePrediction(f, predictions, now) {
  const top = topPrediction(predictions);
  const label = top.probability >= TRIGGER_CONFIDENCE ? top.className : null;

  const ui = el.players[f.index];
  ui.liveLabel.textContent = label ? `${label} · ${Math.round(top.probability * 100)}%` : "Uncertain";
  renderPredictions(ui.liveBars, predictions);

  if (label === f.label) f.streak += 1;
  else {
    f.label = label;
    f.streak = 1;
  }

  if (state !== "fighting") return;
  const stable = f.label !== null && f.streak >= TRIGGER_STREAK;
  f.guarding = stable && f.label === "Guard" && f.stamina > 0;
  if (f.streak === TRIGGER_STREAK && f.label) performMove(f, f.label, now);
}

function performMove(f, move, now) {
  const opponent = fighters[1 - f.index];

  if (DODGE_MOVES[move]) {
    if ((f.cooldowns.Dodge ?? 0) > now) return;
    if (f.stamina < DODGE.stamina) return popText(f, "TOO TIRED", "muted");
    f.stamina -= DODGE.stamina;
    f.dodgeUntil = now + DODGE.durationMs;
    f.cooldowns.Dodge = now + DODGE.cooldownMs;
    popText(f, DODGE_MOVES[move], "muted");
    return;
  }

  const attack = ATTACKS[move];
  if (!attack || (f.cooldowns[move] ?? 0) > now) return;
  if (attack.needsFullMeter && f.meter < MAX_METER) return popText(f, "ULTIMATE NOT READY", "muted");
  if (f.stamina < attack.stamina) return popText(f, "TOO TIRED", "muted");

  f.stamina -= attack.stamina;
  f.cooldowns[move] = now + attack.cooldownMs;
  if (attack.needsFullMeter) f.meter = 0;
  popText(f, move.toUpperCase(), attack.needsFullMeter ? "ultimate" : "attack");

  if (opponent.dodgeUntil > now) {
    popText(opponent, "MISS", "muted");
    playSound("miss");
    return;
  }

  const blocked = opponent.guarding;
  const damage = blocked ? Math.round(attack.damage * GUARD_DAMAGE_FACTOR) : attack.damage;
  opponent.hp = Math.max(0, opponent.hp - damage);
  opponent.meter = Math.min(MAX_METER, opponent.meter + METER_ON_HIT_TAKEN);
  f.meter = Math.min(MAX_METER, f.meter + (blocked ? attack.meter / 2 : attack.meter));

  popText(opponent, blocked ? `BLOCKED −${damage}` : `−${damage}`, blocked ? "muted" : "damage");
  flash(opponent, blocked ? "blocked" : "hit");
  playSound(attack.needsFullMeter ? "ultimate" : blocked ? "block" : "hit");
  renderHud();

  if (opponent.hp === 0) endRound(f, true);
}

// ---- Game loop and rendering ----

function tick(now) {
  const dt = (now - lastFrameAt) / 1000;
  lastFrameAt = now;

  if (state === "fighting") {
    timeLeft = Math.max(0, timeLeft - dt);
    fighters.forEach((f) => {
      if (f.guarding) {
        f.stamina = Math.max(0, f.stamina - GUARD_DRAIN_PER_S * dt);
        if (f.stamina === 0) {
          f.guarding = false;
          popText(f, "GUARD BROKEN", "damage");
        }
      } else {
        f.stamina = Math.min(MAX_STAMINA, f.stamina + STAMINA_REGEN_PER_S * dt);
      }
    });

    if (timeLeft === 0) {
      const [a, b] = fighters;
      endRound(a.hp === b.hp ? null : a.hp > b.hp ? a : b);
    }
  }

  renderHud();
  rafId = requestAnimationFrame(tick);
}

function renderHud() {
  el.round.textContent = `Round ${round}`;
  el.timer.textContent = String(Math.ceil(timeLeft));
  const now = performance.now();

  fighters.forEach((f, i) => {
    const ui = el.players[i];
    ui.hp.style.width = `${(f.hp / MAX_HP) * 100}%`;
    ui.hpLag.style.width = ui.hp.style.width; // trails behind via a delayed CSS transition
    ui.hpText.textContent = String(Math.ceil(f.hp));
    ui.stamina.style.width = `${(f.stamina / MAX_STAMINA) * 100}%`;
    ui.ult.style.width = `${(f.meter / MAX_METER) * 100}%`;
    ui.ultBar.classList.toggle("ready", f.meter >= MAX_METER);
    ui.hud.classList.toggle("guarding", f.guarding);
    ui.overlay.classList.toggle("guarding", f.guarding);
    ui.overlay.classList.toggle("dodging", f.dodgeUntil > now);
    ui.pips.textContent = "●".repeat(f.wins) + "○".repeat(Math.max(0, ROUNDS_TO_WIN - f.wins));
  });
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
