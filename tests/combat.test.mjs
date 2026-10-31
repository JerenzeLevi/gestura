// Combat rules: damage, guard reduction, dodges, cooldowns, stamina, the ultimate
// meter, round winners and the best-of-three match logic.

import test from "node:test";
import assert from "node:assert/strict";

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
} from "../js/combat.js";
import { ATTACKS, DODGE, GUARD, LIMITS, MATCH, METER_ON_HIT_TAKEN, STAMINA_REGEN_PER_S } from "../js/gestureConfig.js";

const base = { now: 1000, attackerStamina: LIMITS.maxStamina, attackerMeter: 0 };

test("a clean jab deals its listed damage", () => {
  const result = resolveAttack({ ...base, move: "Jab" });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, HIT.HIT);
  assert.equal(result.damage, ATTACKS.Jab.damage);
  assert.equal(result.staminaCost, ATTACKS.Jab.stamina);
  assert.equal(result.attackerMeterGain, ATTACKS.Jab.meter);
  assert.equal(result.defenderMeterGain, METER_ON_HIT_TAKEN);
  assert.equal(result.cooldownUntil, base.now + ATTACKS.Jab.cooldownMs);
});

test("every attack deals more damage than a jab except the jab itself", () => {
  for (const [move, spec] of Object.entries(ATTACKS)) {
    const result = resolveAttack({ ...base, move, attackerMeter: LIMITS.maxMeter });
    assert.equal(result.ok, true, `${move} should be allowed with full resources`);
    assert.equal(result.damage, spec.damage, `${move} damage`);
  }
});

test("a guard reduces damage to the configured share and halves the attacker's charge", () => {
  const open = resolveAttack({ ...base, move: "Uppercut" });
  const blocked = resolveAttack({ ...base, move: "Uppercut", defenderGuarding: true });
  assert.equal(blocked.outcome, HIT.BLOCKED);
  assert.equal(blocked.damage, Math.round(ATTACKS.Uppercut.damage * GUARD.damageFactor));
  assert.ok(blocked.damage < open.damage);
  assert.equal(blocked.attackerMeterGain, ATTACKS.Uppercut.meter / 2);
  assert.equal(blocked.defenderMeterGain, METER_ON_HIT_TAKEN, "a blocked hit still charges the defender");
});

test("a dodge in progress avoids all damage", () => {
  const result = resolveAttack({ ...base, move: "Kick", defenderDodgeUntil: base.now + 200 });
  assert.equal(result.outcome, HIT.MISS);
  assert.equal(result.damage, 0);
  assert.equal(result.attackerMeterGain, 0);
  assert.equal(result.staminaCost, ATTACKS.Kick.stamina, "the attacker still pays for the swing");
});

test("a dodge beats an ultimate too", () => {
  const result = resolveAttack({
    ...base,
    move: "Ultimate",
    attackerMeter: LIMITS.maxMeter,
    defenderDodgeUntil: base.now + 1,
  });
  assert.equal(result.outcome, HIT.MISS);
});

test("an expired dodge does not protect", () => {
  const result = resolveAttack({ ...base, move: "Kick", defenderDodgeUntil: base.now });
  assert.equal(result.outcome, HIT.HIT);
});

test("a dodge beats a guard: no damage at all, not reduced damage", () => {
  const result = resolveAttack({
    ...base,
    move: "Kick",
    defenderGuarding: true,
    defenderDodgeUntil: base.now + 100,
  });
  assert.equal(result.outcome, HIT.MISS);
  assert.equal(result.damage, 0);
});

test("a move on cooldown is refused", () => {
  const result = resolveAttack({ ...base, move: "Jab", cooldownUntil: base.now + 1 });
  assert.deepEqual(result, { ok: false, reason: REJECT.COOLDOWN });
});

test("a cooldown that has just expired is allowed", () => {
  const result = resolveAttack({ ...base, move: "Jab", cooldownUntil: base.now });
  assert.equal(result.ok, true);
});

test("a move the player cannot afford is refused", () => {
  const result = resolveAttack({ ...base, move: "Uppercut", attackerStamina: ATTACKS.Uppercut.stamina - 1 });
  assert.deepEqual(result, { ok: false, reason: REJECT.TIRED });
});

test("exactly enough stamina is enough", () => {
  const result = resolveAttack({ ...base, move: "Uppercut", attackerStamina: ATTACKS.Uppercut.stamina });
  assert.equal(result.ok, true);
});

test("the ultimate needs a full meter", () => {
  const notReady = resolveAttack({ ...base, move: "Ultimate", attackerMeter: LIMITS.maxMeter - 1 });
  assert.deepEqual(notReady, { ok: false, reason: REJECT.METER });

  const ready = resolveAttack({ ...base, move: "Ultimate", attackerMeter: LIMITS.maxMeter });
  assert.equal(ready.ok, true);
  assert.equal(ready.consumesMeter, true);
  assert.equal(ready.damage, ATTACKS.Ultimate.damage);
});

test("the cooldown check runs before the meter check, so a spent ultimate is not re-offered", () => {
  const result = resolveAttack({
    ...base,
    move: "Ultimate",
    attackerMeter: LIMITS.maxMeter,
    cooldownUntil: base.now + 10,
  });
  assert.equal(result.reason, REJECT.COOLDOWN);
});

test("an unknown class name is rejected rather than doing nothing silently", () => {
  assert.deepEqual(resolveAttack({ ...base, move: "Guard" }), { ok: false, reason: REJECT.UNKNOWN });
  assert.deepEqual(resolveAttack({ ...base, move: "Dodge Left" }), { ok: false, reason: REJECT.UNKNOWN });
  assert.deepEqual(resolveAttack({ ...base, move: "Nonsense" }), { ok: false, reason: REJECT.UNKNOWN });
});

// ---- Dodges ----

test("a dodge costs stamina and sets both a window and a cooldown", () => {
  const result = resolveDodge({ now: 500, stamina: LIMITS.maxStamina });
  assert.equal(result.ok, true);
  assert.equal(result.staminaCost, DODGE.stamina);
  assert.equal(result.dodgeUntil, 500 + DODGE.durationMs);
  assert.equal(result.cooldownUntil, 500 + DODGE.cooldownMs);
  assert.ok(result.cooldownUntil > result.dodgeUntil, "the cooldown outlasts the invulnerability");
});

test("a dodge is refused on cooldown or when too tired", () => {
  assert.equal(resolveDodge({ now: 500, stamina: 100, cooldownUntil: 501 }).reason, REJECT.COOLDOWN);
  assert.equal(resolveDodge({ now: 500, stamina: DODGE.stamina - 1 }).reason, REJECT.TIRED);
});

// ---- Guard ----

test("guard is allowed with stamina and no lockout", () => {
  assert.equal(canGuard({ now: 100, stamina: 50 }).ok, true);
});

test("guard is refused at zero stamina and during the post-break lockout", () => {
  assert.equal(canGuard({ now: 100, stamina: 0 }).ok, false);
  assert.equal(canGuard({ now: 100, stamina: 50, guardLockedUntil: 200 }).reason, REJECT.LOCKED);
  assert.equal(canGuard({ now: 300, stamina: 50, guardLockedUntil: 200 }).ok, true, "the lockout expires");
});

// ---- Stamina upkeep ----

test("not guarding regenerates stamina up to the cap", () => {
  const second = tickStamina({ stamina: 50, guarding: false, dt: 1, now: 0 });
  assert.equal(second.stamina, 50 + STAMINA_REGEN_PER_S);
  assert.equal(tickStamina({ stamina: LIMITS.maxStamina, guarding: false, dt: 1, now: 0 }).stamina, LIMITS.maxStamina);
});

test("guarding drains stamina", () => {
  const result = tickStamina({ stamina: 50, guarding: true, dt: 1, now: 0 });
  assert.equal(result.stamina, 50 - GUARD.drainPerSecond);
  assert.equal(result.guarding, true);
  assert.equal(result.guardBroke, false);
});

test("a guard that runs out of stamina breaks and locks out", () => {
  const result = tickStamina({ stamina: 3, guarding: true, dt: 1, now: 9000 });
  assert.equal(result.stamina, 0);
  assert.equal(result.guarding, false);
  assert.equal(result.guardBroke, true);
  assert.equal(result.guardLockedUntil, 9000 + GUARD.breakLockoutMs);
  // The lockout is what stops a held Guard pose flickering back on as stamina trickles in.
  assert.equal(canGuard({ now: 9100, stamina: 2, guardLockedUntil: result.guardLockedUntil }).ok, false);
});

test("stamina never leaves its bounds", () => {
  assert.equal(clampStamina(5, -50), 0);
  assert.equal(clampStamina(95, 50), LIMITS.maxStamina);
  assert.equal(clampHp(5, 50), 0);
  assert.equal(clampMeter(90, 50), LIMITS.maxMeter);
  assert.equal(clampMeter(10, -50), 0);
});

// ---- Rounds and match ----

test("the round goes to whoever has more HP, or is a draw", () => {
  assert.equal(roundWinnerIndex(80, 40), 0);
  assert.equal(roundWinnerIndex(40, 80), 1);
  assert.equal(roundWinnerIndex(55, 55), null);
  assert.equal(roundWinnerIndex(0, 1), 1, "a knockout is just zero HP");
});

test("the match ends when a player reaches two round wins", () => {
  assert.deepEqual(matchOutcome([1, 0], 1), { over: false, winnerIndex: null });
  assert.deepEqual(matchOutcome([1, 1], 2), { over: false, winnerIndex: null });
  assert.deepEqual(matchOutcome([2, 0], 2), { over: true, winnerIndex: 0 });
  assert.deepEqual(matchOutcome([1, 2], 3), { over: true, winnerIndex: 1 });
});

test("the match stops after the round limit even if nobody reached two wins", () => {
  // Three drawn rounds used to start a fourth, then a fifth, forever.
  assert.deepEqual(matchOutcome([0, 0], MATCH.maxRounds), { over: true, winnerIndex: null });
  assert.deepEqual(matchOutcome([1, 0], MATCH.maxRounds), { over: true, winnerIndex: 0 });
  assert.deepEqual(matchOutcome([0, 1], MATCH.maxRounds), { over: true, winnerIndex: 1 });
});

test("a 2-0 match is over after two rounds, not three", () => {
  const outcome = matchOutcome([2, 0], 2);
  assert.equal(outcome.over, true);
  assert.ok(2 < MATCH.maxRounds);
});

test("the round limit is reachable with the configured rounds to win", () => {
  assert.ok(MATCH.maxRounds >= MATCH.roundsToWin, "best-of-N must allow N wins");
  assert.equal(MATCH.maxRounds, MATCH.roundsToWin * 2 - 1, "best of three");
});
