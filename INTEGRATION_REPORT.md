# Gestura — integration report

Branch: `improvement/integration-and-polish`
Base: `main` at `98aca3f`
Date: 2026-10-31

This report covers the integration and polish pass over the combined work of the team. No
teammate's module was replaced. The existing architecture — static site, hash router, ES modules,
TensorFlow.js plus the Teachable Machine image library, no build step — is unchanged.

---

## 1. Original project status

What was on `main`:

| Area | State |
|---|---|
| Web app (`d8dc93a`, JerenzeLevi) | Complete and working: router, boxing, practice, camera, prediction bars, sound, Rules/About/Credits pages |
| Trained model (`98aca3f`, Kenrick) | **Delivered.** `model/` contains `model.json`, `metadata.json` and `weights.bin`, exported 2026-10-22 with all eight required classes |
| Documentation | Out of date — `README.md` still described the model as the blocking open item |
| Tests | None |

The most significant finding of the inspection was simply that **the model is no longer missing**.
`model/metadata.json` lists exactly `Idle, Jab, Uppercut, Kick, Guard, Dodge Left, Dodge Right,
Ultimate`, so the dependency the README called "blocking" was already resolved; the documentation
had not caught up. Everything in the README's open-items list other than the model was still open.

---

## 2. Issues discovered

### Correctness

| # | Issue | Where | Effect |
|---|---|---|---|
| 1 | No validation of the model's class names | `js/model.js` | A typo like `Dodge left` meant that move silently never fired, with nothing on screen to explain it |
| 2 | A hidden tab froze `requestAnimationFrame`, then delivered one huge frame delta | `js/boxing.js` `tick()` | Switching tabs mid-round drained the whole 60 s timer in a single frame and ended the round |
| 3 | A stale prediction from a previous visit could reach a new match | `js/boxing.js`, `js/practice.js` | The guard against this (`if (!camera) return`) passed as soon as a *new* camera existed, so the old result was applied to the new fighters |
| 4 | Drawn rounds could never end the match | `js/boxing.js` `endRound()` | Three drawn rounds started a fourth, then a fifth, with no stop condition |
| 5 | The ultimate meter was not reset on rematch | `js/boxing.js` `startMatch()` | A rematch could begin with a full ultimate already charged |
| 6 | Detector state carried across rounds | `js/boxing.js` `startRound()` | A pose held through the countdown either fired late or could not fire at all until the player reset to Idle |
| 7 | A broken guard flickered back on | `js/boxing.js` | At zero stamina the guard broke, regenerated for one frame, and re-engaged, repeatedly |
| 8 | A failed prediction credited the next reading with the failure's duration | `js/practice.js` `updateChallenge()` | `lastPredictAt` was only updated on the success path, so one exception could complete a challenge instantly |
| 9 | `hidden` had no effect on buttons | `style.css` | `.btn { display: inline-flex }` outranks the browser's `[hidden]` rule, so "Retry model load" was visible at all times |
| 10 | An unknown hash left the nav unhighlighted | `js/main.js` `route()` | `#/typo` fell back to the menu internally but the URL and the nav state disagreed |
| 11 | `aria-current` was set to the empty string | `js/main.js` | Not a valid token; screen readers get nothing |
| 12 | Camera tracks leaked on a failed `video.play()` | `js/camera.js` `start()` | The stream stayed live with nothing using it — camera light on |
| 13 | `stop()` left `srcObject` attached | `js/camera.js` | The decoder and frame buffer were held after leaving a screen |
| 14 | A camera unplugged mid-game was never noticed | `js/camera.js` | The canvas froze on the last frame and predictions kept running on it |
| 15 | The first prediction after model load differs from every later one | found while testing | Measured on the committed model: the same grey frame gives a 19.9% top class on the first call and a stable 70.5% from then on |
| 16 | The spinner kept turning after a definitive camera failure | both game screens | "Starting camera…" stayed on screen next to "Camera unavailable" |

### Model behaviour

| # | Issue | Effect |
|---|---|---|
| 17 | The model classifies featureless frames confidently | A solid black frame reads as `Ultimate` at **89.7%**, flat grey as `Guard` at **70.5%**. Every confidence threshold passes, because the confidence genuinely is high. A covered lens or a dark room could fire an ultimate. |

### Gaps against the brief

No shared configuration between the two modes (thresholds and class names were duplicated in
`boxing.js` and `practice.js` and had already drifted — 150 ms vs 200 ms intervals, the same 0.75
threshold written twice); no smoothing, no runner-up margin, no empty-frame handling; no
end-of-match summary; no onboarding or position check; no favicon; two "Coming soon" cards on the
home page; `Your name here` on the Credits page; the `file://` warning named a folder
(`task1_teachable_web`) that does not exist in this repository; no automated tests.

---

## 3. Changes implemented

### New shared modules

Extracted so both game modes behave identically and so the logic can be tested without a browser.
None of this replaces a teammate's module — `boxing.js` and `practice.js` keep their structure and
call into these.

- **`js/gestureConfig.js`** — one home for the eight class names, the detection thresholds, the
  damage/stamina/cooldown numbers, the match format and the per-gesture pose descriptions.
- **`js/gestureDetector.js`** — the prediction-to-move pipeline: EMA smoothing, confidence floor,
  runner-up margin, hysteresis, streak, and a one-shot debounce so a held pose fires exactly once
  and must be released before firing again.
- **`js/combat.js`** — damage, guard reduction, dodges, cooldowns, stamina upkeep, round winner and
  match outcome, as pure functions.
- **`js/modelValidation.js`** — compares the model's class names with the game's, distinguishing
  missing, renamed (wrong capitals or spacing), duplicated and extra classes.
- **`js/onboarding.js`** — the first-run guide.

### Model integration (`js/model.js`)

Fetches and checks both JSON files before loading, so a missing, unreadable or malformed file gets
its own message instead of a generic failure; detects the Teachable Machine library not loading at
all; validates the class names and exposes the result; adds a load-state machine with listeners, a
`resetModel()` that makes **Retry model load** work without a page reload, a `predict()` that
rejects cleanly before load, and a warm-up prediction that fixes issue 15.

Gameplay is blocked unless every required class is present under its exact name. The camera preview
keeps working either way, and the live bars stay on so a mismatch can be diagnosed on screen.

### Gesture recognition

Centralised and tuned: smoothing at 0.5, trigger 75%, release 55% (hysteresis), margin 15 points,
streak 2, empty-zone floor 45%. Detector state is reset at the start of every round, on zone change
in Practice, and when the tab becomes visible again.

Two safeguards for a player who is out of frame, which the brief asked to keep distinct:

- **Model-dependent:** the 45% floor and the runner-up margin. These rely on the classifier being
  unsure, which it often is not.
- **Model-independent:** `Region.detail()` measures the standard deviation of brightness over a
  32×32 copy of the zone and rejects a featureless frame before the model ever sees it. This is the
  only defence that works against issue 17, and it is deliberately conservative — it catches a
  covered lens or a dark room, not a partly visible player.

### Boxing (`js/boxing.js`)

Fixes 2–7 above. Added: a hard three-round cap with a proper drawn-match result; a session guard on
every async prediction; pause and resume on tab visibility change; a frame-delta clamp; per-fighter
statistics; a live **zone check** per player, labelled in the UI as a confidence reading and
explicitly *not* body detection; and an end-of-match summary showing the winner or draw, the round
score, a per-round breakdown with final HP, and nine statistics — all of them counters incremented
by real game events, none derived or estimated.

### Practice (`js/practice.js`)

Fixes 8 above. Added: five actionable feedback states (nothing in the zone / confidence too low /
torn between two moves / hold your position / gesture detected), a grace period so one unclear
frame pauses the hold bar instead of emptying it, a skipped counter, the pose description for the
current target, detector reset on zone change, a retry button, visibility pausing, and an
`aria-valuenow` progress bar.

### UI, accessibility and responsiveness

Original SVG favicon and app icon; "Coming soon" cards replaced with a link to the Rules page and a
three-step "how it works" strip; real team credits from the Git history; the `file://` warning now
names the right folder; Rules page split into all eight gestures with the real numbers, plus a note
that the emoji are decoration and the written pose descriptions are what the model was trained on;
a skip link; one focus-ring rule covering every interactive element; `aria-current="page"`;
per-screen document titles; a global `[hidden]` fix; breakpoints at 1040px, 760px and 420px; a
landscape layout for short viewports; 44–48px touch targets on coarse pointers; and the ambient
animation disabled under `prefers-reduced-motion`.

### Camera and lifecycle

Tracks stopped on every failure path; `srcObject` cleared and the video paused on stop; `stop()`
made idempotent and safe to call while `start()` is still pending; `ended` listeners for a camera
that is unplugged or taken over, with a message; `pagehide` releases the camera when the page is
left or reloaded; prediction intervals stopped while the tab is hidden; `Region.capture()` returns
`null` for an empty rectangle instead of predicting on nothing.

---

## 4. Testing results

### 4.1 Automated tests passed

`npm test` — **98 tests, 98 passed, 0 failed** (Node 22.17.1, Node's built-in runner, no
dependencies).

| Suite | Tests | Covers |
|---|---|---|
| `modelValidation.test.mjs` | 12 | Exact match, order independence, missing classes, wrong capitals, stray and doubled whitespace, duplicates, extra classes, empty input, **and the committed `model/metadata.json`** |
| `gestureDetector.test.mjs` | 18 | Streak, one-shot firing, release-before-refire, Idle never firing, confidence floor, ambiguity, empty-frame safeguard, hysteresis in both directions, reset, smoothing damping a spike while passing a sustained pose, hint wording |
| `combat.test.mjs` | 22 | Damage per move, guard reduction and halved charge, dodge beating guard and ultimate, expiry boundaries, cooldowns, stamina limits, meter gating, check ordering, stamina regen/drain/break/lockout, round winner, match end and the drawn-round cap |
| `region.test.mjs` | 9 | Blank-frame detection: solid, black, white, sensor noise, split and varied frames, the standard-deviation maths, a throwing readback, empty rectangles |
| `modelLoader.test.mjs` | 11 | State machine, predict-before-load, missing library, retriability, listeners (including a throwing one), every camera error message |
| `predictionBars.test.mjs` | 7 | Ordering, top-row marking, percentages and widths, extremes, replacement, no-innerHTML, empty list |
| `domContract.test.mjs` | 11 | Every `getElementById` and literal selector resolves, data-attribute hooks exist, router screens match `data-screen` sections, nav links are valid, onboarding parts present, all eight gestures documented on the Rules page, local file references exist, imports resolve, the non-DOM modules import cleanly under Node, thresholds are internally consistent |

One test failure during development was a genuine bug, not a bad test: the margin check sat after
the confidence floor, so "torn between two moves" could never be reported below 75%. The order was
corrected in `js/gestureDetector.js`.

### 4.2 Static validation completed

- All eight modules parse and import cleanly under Node (enforced by `domContract.test.mjs`).
- No stray files, datasets, credentials or tokens staged; `dataset/` remains ignored.
- `git diff` reviewed file by file before committing.

### 4.3 Browser tests completed

Served over `http://localhost` and driven in a real browser:

- **Model load, for real.** `loadModel()` returns `state: "ready"`, `usable: true`, all eight labels
  exact, validation clean, TensorFlow.js 1.3.1. Cold load ≈ 3.6 s.
- **Inference, for real.** A prediction on a 224×224 canvas returns 8 probabilities summing to 1.
- **Warm-up verified.** Before the fix, first vs second prediction on the same frame: 0.199 then
  0.705. After: 0.705 and 0.705.
- **Issue 17 measured, not assumed.** Black → `Ultimate` 0.897; grey → `Guard` 0.705; white →
  `Guard` 0.732; dark blue → `Ultimate` 0.494.
- **Blank-frame safeguard verified end to end.** Black and grey zones both report `blank: true`
  (detail 0.00) and never reach the model; a busy synthetic scene reports detail 21.47 and passes
  through.
- **Routing.** All six screens render; `#/nonsense-route` redirects to the menu with the nav and
  title corrected; per-screen titles update.
- **Onboarding.** Opens automatically on first visit, all five steps, dots and Back/Next/Skip work,
  the last step reads "Start playing", and it does not reopen once dismissed.
- **Camera failure path.** With the camera blocked, both screens show the correct advice, the arena
  reads "Camera unavailable", the spinner stops, and the fight stays locked.
- **`[hidden]` fix confirmed:** "Retry model load" is hidden before and shown after a model failure.
- **Responsive.** Desktop and 375×812 both check out: HUD relocates above the arena, nav scrolls,
  buttons wrap, no horizontal overflow.
- **Match summary.** Layout, table alignment and legibility verified by rendering the panel with
  representative values. Two defects found and fixed this way: it was translucent over the arena's
  banner text, and it was cramped inside the ~300 px arena box; it is now a full-viewport result
  modal and `showSummary()` hides the arena banner.
- **Console.** Clean apart from the camera errors the app logs deliberately, and one
  "High memory usage in GPU: 0.19 MB" warning from TensorFlow.js 1.3.1 — that version's own low
  threshold, not an observed leak.

### 4.4 Real-camera tests completed

**None.** No webcam was available in the environment used for this work.

### 4.5 Tests blocked by missing hardware

These need a webcam and at least one person, and remain **unverified**:

- Whether each of the eight gestures is recognised reliably by a real person, and at what confidence.
- Per-class accuracy, and the Jab/Kick and Dodge Left/Dodge Right confusions the task notes predict.
- Whether the left and right zones behave consistently under real room lighting.
- Whether the tuned thresholds feel right in play — whether 75%/15 points/2 readings is too strict
  or too loose, and whether the 0.5 smoothing adds noticeable input lag.
- A full two-player match: round transitions, knockouts, the best-of-three flow and the summary
  populated by real events. The summary's *rules* are unit-tested and its *layout* was checked in
  the browser, but the two have not been exercised together.
- Whether the blank-frame threshold of 8 is right for a real dim room, as opposed to the synthetic
  frames it was verified against.

**No claim is made about gesture-recognition accuracy anywhere in this repository.**

---

## 5. Unresolved dependencies

1. **Retraining for empty frames — Kenrick.** This is the one substantive model issue. The `Idle`
   class needs empty-frame, partial-person and dark-room images. Issue 17 is measured, reproducible
   and not fixable in application code; the pixel-detail safeguard only covers the extreme case.
2. **Play-testing with a real camera and two people — whole team.** Everything in 4.5. This is the
   gate on calling the project demo-ready.
3. **Accuracy measurement for the report — whole team.** Use Practice, in both the left and right
   zones, and record per-class figures. Nothing in the repo claims accuracy today.
4. **Team details.** The Credits page and the README list three contributors with roles taken from
   the Git history and `kenrick-task.txt`. Any further members must be added, and the handles
   replaced with full names, before submission. An HTML comment in `index.html` marks the spot.

---

## 6. Recommended next steps

1. Run a real two-player match and work through the 4.5 list; adjust the thresholds in
   `js/gestureConfig.js` if the feel is wrong. They are all in one place now.
2. Retrain with empty-frame and partial-person images in `Idle`, re-export, and re-run `npm test` —
   `modelValidation.test.mjs` checks the new metadata automatically.
3. Record per-class accuracy in Practice and put the numbers in the course report, not in the app.
4. Fill in the remaining team details.
5. Optional: replace the Rules page emoji with photographs of the real poses. The page currently
   states plainly that the symbols are decoration, which is accurate but less useful than a photo.
6. Optional: publish on GitHub Pages. The site is static and already works over https.

---

## 7. Files changed

| File | Change |
|---|---|
| `js/gestureConfig.js` | **New.** All class names, thresholds and game numbers |
| `js/gestureDetector.js` | **New.** Smoothing, thresholds, streak, one-shot debounce |
| `js/combat.js` | **New.** Combat and match rules as pure functions |
| `js/modelValidation.js` | **New.** Class-name checking |
| `js/onboarding.js` | **New.** First-run guide |
| `js/model.js` | File checks, class validation, state machine, retry, warm-up, safe `predict()` |
| `js/camera.js` | Leak-free lifecycle, disconnection handling, blank-frame detection |
| `js/boxing.js` | Uses the shared modules; fixes 2–7; summary, zone checks, visibility pausing, statistics |
| `js/practice.js` | Uses the shared modules; fixes 8; feedback states, grace period, retry, zone reset |
| `js/main.js` | Hash normalisation, valid `aria-current`, page titles, `pagehide` cleanup, onboarding init |
| `index.html` | Favicon, skip link, onboarding dialog, summary markup, zone checks, honest Rules and Credits, "Coming soon" removed, corrected `file://` warning |
| `style.css` | `[hidden]` fix, new components, focus rings, breakpoints, landscape, touch targets, reduced motion |
| `assets/favicon.svg` | **New.** Original app icon |
| `package.json` | **New.** Dev-only test script; no dependencies, no build step |
| `tests/` | **New.** 98 tests across 7 suites plus shared helpers |
| `README.md` | Rewritten to match the implementation; architecture, model integration, troubleshooting, known limitations |
| `INTEGRATION_REPORT.md` | **New.** This file |
| `kenrick-task.txt` | Status note added; the original checklist is unchanged |

`model/`, `LICENSE`, `start.bat`, `js/sound.js`, `js/predictionBars.js` and `model/README.md` are
unchanged. The MIT license is intact and Git history is preserved — no commits were rewritten.

---

## 8. Project status

**Partially ready — ready to demonstrate, not yet validated.**

Everything that can be built and verified without a camera is done and tested: the model loads and
validates against the real committed model, the detection pipeline and the combat rules are covered
by 98 passing unit tests, every integration defect found has been fixed, and the UI, onboarding,
summary and responsive layouts were verified in a browser.

What is outstanding is the part that needs people in front of a webcam: whether the eight gestures
are recognised reliably, what the real accuracy is, and whether the thresholds feel right in play.
Until that session happens, the project should be described as working but unvalidated, and no
accuracy figure should be quoted.
