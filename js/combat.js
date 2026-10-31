// Combat rules as pure functions, so the numbers can be unit-tested without a
// browser, a camera or a model. js/boxing.js keeps the state and the rendering and
// calls into here to decide what a move does.

import {
  ATTACKS,
  DODGE,
  GUARD,
  LIMITS,
  MATCH,
  METER_ON_HIT_TAKEN,
  STAMINA_REGEN_PER_S,
} from "./gestureConfig.js";

export const REJECT = {
  COOLDOWN: "cooldown",
  TIRED: "tired",
  METER: "meter",
  UNKNOWN: "unknown-move",
  LOCKED: "guard-locked",
};

export const HIT = { MISS: "miss", BLOCKED: "blocked", HIT: "hit" };

/**
 * Decides what an attack does, without mutating anything.
 *
 * @param {object} p
 * @param {string} p.move             class name, must be a key of ATTACKS
 * @param {number} p.now              performance.now()-style timestamp in ms
 * @param {number} p.attackerStamina
 * @param {number} p.attackerMeter
 * @param {number} [p.cooldownUntil]  when this move becomes available again
 * @param {boolean} [p.defenderGuarding]
 * @param {number} [p.defenderDodgeUntil]
 * @returns {{ok: false, reason: string} | {
 *   ok: true, outcome: string, damage: number,
 *   staminaCost: number, attackerMeterGain: number, defenderMeterGain: number,
 *   consumesMeter: boolean, cooldownUntil: number,
 * }}
 */
export function resolveAttack({
  move,
  now,
  attackerStamina,
  attackerMeter,
  cooldownUntil = 0,
  defenderGuarding = false,
  defenderDodgeUntil = 0,
}) {
  const attack = ATTACKS[move];
  if (!attack) return { ok: false, reason: REJECT.UNKNOWN };
  if (cooldownUntil > now) return { ok: false, reason: REJECT.COOLDOWN };
  if (attack.needsFullMeter && attackerMeter < LIMITS.maxMeter) return { ok: false, reason: REJECT.METER };
  if (attackerStamina < attack.stamina) return { ok: false, reason: REJECT.TIRED };

  const base = {
    ok: true,
    staminaCost: attack.stamina,
    consumesMeter: Boolean(attack.needsFullMeter),
    cooldownUntil: now + attack.cooldownMs,
  };

  // A dodge beats everything, including an ultimate.
  if (defenderDodgeUntil > now) {
    return { ...base, outcome: HIT.MISS, damage: 0, attackerMeterGain: 0, defenderMeterGain: 0 };
  }

  const damage = defenderGuarding ? Math.round(attack.damage * GUARD.damageFactor) : attack.damage;
  return {
    ...base,
    outcome: defenderGuarding ? HIT.BLOCKED : HIT.HIT,
    damage,
    // A blocked hit still charges the attacker, at half rate.
    attackerMeterGain: defenderGuarding ? attack.meter / 2 : attack.meter,
    defenderMeterGain: METER_ON_HIT_TAKEN,
  };
}

/** Whether a dodge is allowed right now, without mutating anything. */
export function resolveDodge({ now, stamina, cooldownUntil = 0 }) {
  if (cooldownUntil > now) return { ok: false, reason: REJECT.COOLDOWN };
  if (stamina < DODGE.stamina) return { ok: false, reason: REJECT.TIRED };
  return {
    ok: true,
    staminaCost: DODGE.stamina,
    dodgeUntil: now + DODGE.durationMs,
    cooldownUntil: now + DODGE.cooldownMs,
  };
}

/** Whether a Guard pose may be held, given a recent guard break. */
export function canGuard({ now, stamina, guardLockedUntil = 0 }) {
  if (guardLockedUntil > now) return { ok: false, reason: REJECT.LOCKED };
  if (stamina <= 0) return { ok: false, reason: REJECT.TIRED };
  return { ok: true };
}

export const clampHp = (hp, damage) => Math.max(0, Math.min(LIMITS.maxHp, hp - damage));
export const clampMeter = (meter, gain = 0) => Math.max(0, Math.min(LIMITS.maxMeter, meter + gain));
export const clampStamina = (stamina, delta = 0) =>
  Math.max(0, Math.min(LIMITS.maxStamina, stamina + delta));

/**
 * One second of upkeep: guarding drains stamina, anything else regenerates it.
 * @returns {{stamina: number, guarding: boolean, guardLockedUntil: number, guardBroke: boolean}}
 */
export function tickStamina({ stamina, guarding, guardLockedUntil = 0, dt, now }) {
  if (!guarding) {
    return {
      stamina: clampStamina(stamina, STAMINA_REGEN_PER_S * dt),
      guarding: false,
      guardLockedUntil,
      guardBroke: false,
    };
  }
  const next = clampStamina(stamina, -GUARD.drainPerSecond * dt);
  if (next > 0) return { stamina: next, guarding: true, guardLockedUntil, guardBroke: false };
  return {
    stamina: 0,
    guarding: false,
    guardLockedUntil: now + GUARD.breakLockoutMs,
    guardBroke: true,
  };
}

/** Index of the round winner, or null for a draw. Higher HP wins when time runs out. */
export function roundWinnerIndex(hpA, hpB) {
  if (hpA === hpB) return null;
  return hpA > hpB ? 0 : 1;
}

/**
 * Is the match over, and who won?
 *
 * The match ends as soon as a player has `roundsToWin` rounds, or after
 * `maxRounds` have been played. Without the second rule a run of drawn rounds
 * kept starting new rounds forever.
 *
 * @param {number[]} wins rounds won, [p1, p2]
 * @param {number} roundsPlayed
 * @returns {{over: boolean, winnerIndex: number|null}}
 */
export function matchOutcome(wins, roundsPlayed, { roundsToWin = MATCH.roundsToWin, maxRounds = MATCH.maxRounds } = {}) {
  const [a, b] = wins;
  if (a >= roundsToWin || b >= roundsToWin) {
    return { over: true, winnerIndex: a === b ? null : a > b ? 0 : 1 };
  }
  if (roundsPlayed >= maxRounds) {
    return { over: true, winnerIndex: a === b ? null : a > b ? 0 : 1 };
  }
  return { over: false, winnerIndex: null };
}
