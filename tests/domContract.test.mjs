// Static checks that the JavaScript and index.html still agree.
//
// The modules look elements up by id and by data-attribute. There is no compiler to
// catch a renamed id, and a missing element only shows up as a null-property crash in
// the browser, usually on the screen you did not open while testing. These tests read
// both sides and compare them.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, access } from "node:fs/promises";
import { join } from "node:path";

import { REQUIRED_CLASSES } from "../js/gestureConfig.js";
import { readRepoFile, repoRoot } from "./helpers.mjs";

const html = await readRepoFile("index.html");
const jsFiles = (await readdir(join(repoRoot, "js"))).filter((f) => f.endsWith(".js"));
const sources = new Map();
for (const file of jsFiles) sources.set(file, await readRepoFile(`js/${file}`));

const matchAll = (text, re) => [...text.matchAll(re)].map((m) => m[1]);

const htmlIds = new Set(matchAll(html, /\bid="([^"]+)"/g));

test("index.html ids are unique", () => {
  const all = matchAll(html, /\bid="([^"]+)"/g);
  const duplicates = all.filter((id, i) => all.indexOf(id) !== i);
  assert.deepEqual([...new Set(duplicates)], [], "duplicate ids break getElementById");
});

test("every getElementById in js/ exists in index.html", () => {
  const missing = [];
  for (const [file, source] of sources) {
    for (const id of matchAll(source, /getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
      if (!htmlIds.has(id)) missing.push(`${file}: #${id}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("every literal #id in a querySelector exists in index.html", () => {
  const missing = [];
  for (const [file, source] of sources) {
    // Only plain string selectors; template literals are checked by the suites below.
    for (const selector of matchAll(source, /querySelector(?:All)?\(\s*"([^"`$]+)"\s*\)/g)) {
      for (const id of matchAll(selector, /#([A-Za-z][\w-]*)/g)) {
        if (!htmlIds.has(id)) missing.push(`${file}: ${selector}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("every data-attribute selector used in js/ appears in index.html", () => {
  const missing = [];
  for (const [file, source] of sources) {
    for (const selector of matchAll(source, /querySelector(?:All)?\(\s*["`]([^"`]+)["`]\s*\)/g)) {
      for (const attribute of matchAll(selector, /\[(data-[\w-]+)/g)) {
        if (!html.includes(attribute)) missing.push(`${file}: [${attribute}]`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("every class the boxing HUD queries exists for both players", () => {
  // boxing.js builds these selectors per player with a template literal.
  for (const n of [1, 2]) {
    assert.match(html, new RegExp(`class="fighter-hud" data-player="${n}"`), `fighter-hud for P${n}`);
    assert.match(html, new RegExp(`class="half-overlay" data-player="${n}"`), `half-overlay for P${n}`);
    assert.match(html, new RegExp(`class="card live-pred" data-player="${n}"`), `live-pred for P${n}`);
  }
  for (const cls of ["meter-lag", "hp-text", "meter hp", "meter stamina", "meter ult", "pips", "live-label", "live-hint", "zone-ready"]) {
    assert.ok(html.includes(cls), `index.html is missing .${cls}, which boxing.js queries`);
  }
});

test("the router's screens and the page's sections match exactly", () => {
  const main = sources.get("main.js");
  const block = main.slice(main.indexOf("const SCREENS"), main.indexOf("let current"));
  const screens = matchAll(block, /^\s{2}(\w+):\s*\{/gm);
  const sections = matchAll(html, /data-screen="([^"]+)"/g);

  assert.ok(screens.length >= 6, `expected the router to define screens, parsed ${screens.length}`);
  assert.deepEqual([...screens].sort(), [...sections].sort());
});

test("every nav link points at a screen the router knows", () => {
  const nav = html.slice(html.indexOf('<nav class="nav'), html.indexOf("</nav>"));
  const hrefs = matchAll(nav, /href="#\/([^"]*)"/g);
  const main = sources.get("main.js");
  const block = main.slice(main.indexOf("const SCREENS"), main.indexOf("let current"));
  const screens = new Set(matchAll(block, /^\s{2}(\w+):\s*\{/gm));

  assert.ok(hrefs.length > 0, "the nav has links");
  for (const href of hrefs) {
    const screen = href === "" ? "menu" : href;
    assert.ok(screens.has(screen), `nav links to #/${href}, which is not a screen`);
  }
});

test("the onboarding dialog has the parts onboarding.js wires up", () => {
  const dialog = html.slice(html.indexOf('<dialog id="onboarding"'), html.indexOf("</dialog>"));
  assert.ok(dialog.length > 0, "the onboarding dialog exists");
  for (const hook of ["data-onboarding-back", "data-onboarding-next", "data-onboarding-close", "data-onboarding-counter", "onboarding-dots"]) {
    assert.ok(dialog.includes(hook), `the dialog is missing ${hook}`);
  }
  const steps = matchAll(dialog, /(data-step)/g);
  assert.ok(steps.length >= 3, `expected several onboarding steps, found ${steps.length}`);
});

test("the Rules page documents all eight gesture classes", () => {
  const rules = html.slice(html.indexOf('data-screen="rules"'), html.indexOf('data-screen="about"'));
  for (const name of REQUIRED_CLASSES) {
    assert.ok(rules.includes(`<h2>${name}</h2>`), `the Rules page has no card for ${name}`);
  }
});

test("every local file index.html references exists on disk", async () => {
  const refs = [
    ...matchAll(html, /\bsrc="([^"]+)"/g),
    ...matchAll(html, /\bhref="([^"]+)"/g),
  ].filter((ref) => !/^(https?:|#|mailto:|data:)/.test(ref));

  assert.ok(refs.length >= 3, "expected local references (css, js, icon)");
  for (const ref of refs) {
    await access(join(repoRoot, ref)); // throws, and names the file, if it is missing
  }
});

test("every module js/ imports resolves to a file that exists", async () => {
  for (const [file, source] of sources) {
    for (const spec of matchAll(source, /from\s+"(\.\/[^"]+)"/g)) {
      await access(join(repoRoot, "js", spec.replace(/^\.\//, "")), undefined).catch(() => {
        throw new Error(`${file} imports ${spec}, which does not exist`);
      });
    }
  }
});

test("no module reads the DOM at import time except the screen modules", async () => {
  // These are safe to import in Node, which is what makes them unit-testable.
  for (const file of ["gestureConfig.js", "modelValidation.js", "gestureDetector.js", "combat.js", "model.js", "camera.js", "predictionBars.js"]) {
    await import(`../js/${file}`); // throws if it touches document/window on load
  }
});

test("the tuning numbers are internally consistent", async () => {
  const { DETECTION, GUARD, LIMITS, PRACTICE } = await import("../js/gestureConfig.js");
  assert.ok(
    DETECTION.releaseConfidence < DETECTION.triggerConfidence,
    "hysteresis needs a release floor below the trigger"
  );
  assert.ok(
    DETECTION.noPoseMaxConfidence < DETECTION.releaseConfidence,
    "the empty-frame floor must be the lowest threshold"
  );
  assert.ok(DETECTION.triggerStreak >= 1 && Number.isInteger(DETECTION.triggerStreak));
  assert.ok(DETECTION.smoothing > 0 && DETECTION.smoothing <= 1);
  assert.ok(GUARD.damageFactor > 0 && GUARD.damageFactor < 1, "a guard reduces damage, it does not remove it");
  assert.ok(PRACTICE.holdMs > DETECTION.practiceIntervalMs, "a challenge must need more than one reading");
  assert.ok(PRACTICE.graceMs < PRACTICE.holdMs);
  assert.equal(LIMITS.maxHp > 0 && LIMITS.maxStamina > 0 && LIMITS.maxMeter > 0, true);
});
