// Single source of truth for the gesture classes, detection tuning and combat numbers.
// Boxing and Practice both read from here, so the two modes can never drift apart.

// The Teachable Machine class names, exactly as they must appear in model/metadata.json.
// Order matters only for the Rules page; lookups are by name.
export const REQUIRED_CLASSES = [
  "Idle",
  "Jab",
  "Uppercut",
  "Kick",
  "Guard",
  "Dodge Left",
  "Dodge Right",
  "Ultimate",
];

export const IDLE_CLASS = "Idle";

// How a raw stream of predictions becomes a move.
export const DETECTION = {
  // Boxing runs two predictions per tick (one per half), Practice one.
  predictIntervalMs: 150,
  practiceIntervalMs: 200,

  // Exponential moving average over the per-class probabilities. 1 = no smoothing.
  // 0.5 halves single-frame noise while adding only ~1 frame (~150 ms) of latency.
  smoothing: 0.5,

  // A class must reach this confidence to count as recognised.
  triggerConfidence: 0.75,
  // Once recognised it stays recognised until it drops below this (hysteresis),
  // so a steady pose does not flicker between "Guard" and "Uncertain".
  releaseConfidence: 0.55,

  // Consecutive smoothed readings of the same class before a move fires.
  triggerStreak: 2,

  // The top class must beat the runner-up by this margin, otherwise the frame is
  // "ambiguous" and no move fires. Stops Jab/Kick coin-flips from acting.
  minMargin: 0.15,

  // If even the best class stays under this, nothing recognisable is in the zone
  // (empty frame, player half out of shot, very dark room). Treated as "no pose"
  // rather than as Idle, because Idle is only as reliable as its training images.
  noPoseMaxConfidence: 0.45,
};

// Class names must match REQUIRED_CLASSES. `meter` is the ultimate charge gained on a landed hit.
export const ATTACKS = {
  Jab: { damage: 5, cooldownMs: 500, stamina: 5, meter: 10 },
  Uppercut: { damage: 12, cooldownMs: 1200, stamina: 12, meter: 15 },
  Kick: { damage: 10, cooldownMs: 1000, stamina: 10, meter: 15 },
  Ultimate: { damage: 30, cooldownMs: 3000, stamina: 0, meter: 0, needsFullMeter: true },
};

export const DODGE = { durationMs: 500, cooldownMs: 1500, stamina: 8 };

// Both dodge directions share one cooldown; the class name only changes the pop text.
export const DODGE_MOVES = { "Dodge Left": "← DODGE", "Dodge Right": "DODGE →" };

export const GUARD = {
  damageFactor: 0.2, // share of damage taken while guarding
  drainPerSecond: 10, // stamina spent per second of guarding
  // After a guard breaks the player cannot guard again for this long, so a held
  // Guard pose cannot flicker on and off as stamina trickles back.
  breakLockoutMs: 1500,
};

export const STAMINA_REGEN_PER_S = 12;
export const METER_ON_HIT_TAKEN = 5; // comeback bonus for the player who gets hit

export const LIMITS = { maxHp: 100, maxStamina: 100, maxMeter: 100 };

export const MATCH = {
  roundSeconds: 60,
  roundsToWin: 2, // best of 3
  maxRounds: 3, // hard stop, so a run of drawn rounds cannot loop forever
  betweenRoundsMs: 3000,
};

export const PRACTICE = {
  holdMs: 1200, // how long a move must be held to pass a challenge
  // A reading that is merely uncertain pauses the hold bar instead of emptying it,
  // so a single noisy frame does not punish the player.
  graceMs: 400,
};

// Shown on the Rules page and in the Practice hint line. Descriptions only:
// these are the poses the model was trained on (see model/README.md).
export const GESTURE_HINTS = {
  Idle: "Stand relaxed with your hands down.",
  Jab: "Show a closed fist toward the camera.",
  Uppercut: "Thumbs up.",
  Kick: "Thumbs down.",
  Guard: "Both open palms facing the camera.",
  "Dodge Left": "Lean your head to your left, hands down.",
  "Dodge Right": "Lean your head to your right, hands down.",
  Ultimate: "Peace sign, two fingers up.",
};
