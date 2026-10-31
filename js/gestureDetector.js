// Turns a stream of raw Teachable Machine predictions into at most one move per pose.
// Shared by Boxing (one detector per player zone) and Practice (one detector), so both
// modes behave identically. Pure logic: no DOM, no model, no timers.
//
// The pipeline, in order:
//   1. smooth   - exponential moving average per class, to drop single-frame spikes.
//   2. classify - confidence floor, runner-up margin and hysteresis decide whether the
//                 frame has a recognisable pose at all.
//   3. stabilise- the same class must hold for `triggerStreak` readings in a row.
//   4. debounce - a pose fires once; it must be released before it can fire again.

import { DETECTION, IDLE_CLASS } from "./gestureConfig.js";

// Why no label was produced, for the on-screen hint.
export const REASON = {
  OK: "ok",
  NO_POSE: "no-pose", // nothing recognisable in the zone (empty frame, player out of shot)
  LOW_CONFIDENCE: "low-confidence",
  AMBIGUOUS: "ambiguous", // two classes too close to call
};

export class GestureDetector {
  constructor(options = {}) {
    this.options = { ...DETECTION, ...options };
    this.reset();
  }

  // Drops all history. Call between rounds and whenever the camera restarts, so a
  // pose held during a countdown cannot carry a stale streak into the next round.
  reset() {
    this.smoothed = null; // Map<className, probability>
    this.label = null; // currently recognised class, or null
    this.streak = 0;
    this.held = null; // class that already fired and has not been released
    this.reason = REASON.NO_POSE;
    this.lastTop = null;
  }

  /**
   * @param {{className: string, probability: number}[]} predictions raw model output
   * @returns {{
   *   predictions: {className: string, probability: number}[], // smoothed, same order in
   *   top: {className: string, probability: number}|null,
   *   runnerUp: {className: string, probability: number}|null,
   *   label: string|null,       // recognised class this reading, null when unusable
   *   reason: string,           // REASON.*
   *   stable: boolean,          // label held long enough to act on (used by Guard)
   *   triggered: string|null,   // fires once per pose; null on every other reading
   *   absent: boolean,          // nothing recognisable in the zone
   * }}
   */
  update(predictions) {
    if (!Array.isArray(predictions) || predictions.length === 0) {
      this.reset();
      return this.#result([], null, null, false, null);
    }

    const smoothedList = this.#smooth(predictions);
    const ranked = [...smoothedList].sort((a, b) => b.probability - a.probability);
    const top = ranked[0];
    const runnerUp = ranked[1] ?? null;
    const margin = runnerUp ? top.probability - runnerUp.probability : 1;
    const o = this.options;

    let label = null;
    if (top.probability < o.noPoseMaxConfidence) {
      this.reason = REASON.NO_POSE;
    } else if (
      // Hysteresis: keep an already-recognised class while it stays reasonably strong.
      this.label !== null &&
      top.className === this.label &&
      top.probability >= o.releaseConfidence
    ) {
      label = top.className;
      this.reason = REASON.OK;
    } else if (margin < o.minMargin) {
      // Checked before the confidence floor: when two classes are neck and neck,
      // "torn between Jab and Uppercut" tells the player far more than "too low".
      this.reason = REASON.AMBIGUOUS;
    } else if (top.probability < o.triggerConfidence) {
      this.reason = REASON.LOW_CONFIDENCE;
    } else {
      label = top.className;
      this.reason = REASON.OK;
    }

    if (label !== null && label === this.label) this.streak += 1;
    else this.streak = label === null ? 0 : 1;
    this.label = label;
    this.lastTop = top;

    // A pose is "released" as soon as a reading is anything other than that pose,
    // including an uncertain or empty one. Until then it cannot fire again, so
    // holding a fist does not machine-gun jabs.
    if (this.held !== null && label !== this.held) this.held = null;

    const stable = label !== null && this.streak >= o.triggerStreak;
    let triggered = null;
    if (stable && label !== IDLE_CLASS && this.held === null) {
      triggered = label;
      this.held = label;
    }

    return this.#result(smoothedList, top, runnerUp, stable, triggered);
  }

  // Exponential moving average per class. Unseen classes decay toward 0 rather than
  // being dropped, so the bar list stays complete and stable.
  #smooth(predictions) {
    const a = Math.min(1, Math.max(0.05, this.options.smoothing));
    if (!this.smoothed) {
      this.smoothed = new Map(predictions.map((p) => [p.className, p.probability]));
    } else {
      for (const p of predictions) {
        const prev = this.smoothed.get(p.className) ?? p.probability;
        this.smoothed.set(p.className, prev + a * (p.probability - prev));
      }
    }
    return predictions.map((p) => ({
      className: p.className,
      probability: this.smoothed.get(p.className) ?? p.probability,
    }));
  }

  #result(predictions, top, runnerUp, stable, triggered) {
    return {
      predictions,
      top,
      runnerUp,
      label: this.label,
      reason: this.reason,
      stable,
      triggered,
      absent: this.reason === REASON.NO_POSE,
    };
  }
}

// Short, player-facing explanation of a reading. Used by Practice and by the
// boxing live panels, so the wording is identical in both modes.
export function readingHint(reading, target = null) {
  if (!reading || !reading.top) return "Waiting for the camera…";
  switch (reading.reason) {
    case REASON.NO_POSE:
      return "No clear pose — move farther into the highlighted zone and check the lighting.";
    case REASON.LOW_CONFIDENCE:
      return `Confidence too low (${pct(reading.top.probability)}) — make the pose bigger and hold still.`;
    case REASON.AMBIGUOUS:
      return `Not sure between ${reading.top.className} and ${reading.runnerUp?.className ?? "another move"} — make the pose clearer.`;
    default:
      break;
  }
  if (target && reading.label !== target) return `Detected ${reading.label} — the target is ${target}.`;
  if (target && reading.label === target) return "Hold your position…";
  return `Detected ${reading.label} (${pct(reading.top.probability)}).`;
}

const pct = (p) => `${Math.round(p * 100)}%`;
