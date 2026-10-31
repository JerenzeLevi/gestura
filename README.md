# Gestura

Touchless, gesture-controlled games in the browser. A webcam and a custom image model trained in
[Google Teachable Machine](https://teachablemachine.withgoogle.com/) turn hand poses into game moves.
No keyboard, mouse or touch screen needed, and camera frames never leave the device.

Course project for **Intelligent Systems**.

## Features

- **Boxing (2 players, 1 camera):** the mirrored webcam frame is split into a left half (P1) and a
  right half (P2), each classified separately. HP, stamina, ultimate meter, 60 s rounds, best of 3,
  and an end-of-match summary with the statistics the match actually recorded.
- **Practice (1 player):** the app asks for a move, you hold it until the bar fills, and live
  confidence bars show what the model predicts. Left, center and right zones let you check a move on
  both sides of the frame before a match.
- **First-run guide:** a five-step walkthrough covering camera permission, where each player stands,
  the practice zones, lighting, and what the confidence numbers mean. Shown once per browser and
  reopenable from the "How to play" button on any screen.
- **Model validation:** the class names in the loaded model are checked against the ones the game
  looks moves up by. A missing class, a typo or wrong capitalisation produces a specific message and
  the fight stays locked, instead of a move that silently never fires.
- **Rules, About and Credits** pages.

## Moves

| Class | Gesture | Effect |
|---|---|---|
| `Idle` | Hands down, relaxed | Stamina recovers |
| `Jab` | Closed fist | 5 damage, 0.5 s cooldown, 5 stamina |
| `Uppercut` | Thumbs up | 12 damage, 1.2 s cooldown, 12 stamina |
| `Kick` | Thumbs down | 10 damage, 1 s cooldown, 10 stamina |
| `Guard` | Both open palms | Take 20% damage, drains 10 stamina/s, 1.5 s lockout after a break |
| `Dodge Left` / `Dodge Right` | Head lean left / right | Avoid all damage for 0.5 s, 1.5 s shared cooldown |
| `Ultimate` | Peace sign | 30 damage, needs a full meter |

All of these numbers live in one place, [`js/gestureConfig.js`](js/gestureConfig.js), and both game
modes read them from there.

### How a move is recognised

Each zone is classified about seven times a second. A raw prediction becomes a move only after:

1. **Smoothing** — an exponential moving average over the per-class scores, so one noisy frame
   cannot fire a move.
2. **A confidence floor** — the top class must reach **75%**.
3. **A runner-up margin** — it must beat the second-place class by **15 points**, so a Jab/Kick
   coin-flip does nothing.
4. **A streak** — it must stay on top for **two readings in a row**.
5. **Debounce** — a pose fires **once**. It must be released (any other reading, including an
   uncertain one) before the same move can fire again.

Two safeguards sit around that pipeline:

- If nothing in a zone reaches **45%**, the zone is reported as empty rather than guessed at.
- Before a frame reaches the model at all, its pixel detail is measured. A featureless image — a
  covered lens, a pitch-dark room — is rejected outright. This matters because the model is only
  ever shown people: it classifies a blank frame confidently and wrongly (see
  [Known limitations](#known-limitations)).

## Running it

The browser only allows the camera and the model files over http, so don't open `index.html` directly.

- **Windows:** double-click `start.bat` (opens http://localhost:8000).
- **Anywhere:** `python -m http.server 8000` in this folder, then open http://localhost:8000.
- **With Node installed:** `npm run serve` does the same thing.

The trained model must be in `model/` (`model.json`, `metadata.json`, `weights.bin`). It is committed
to this repository, so a fresh clone works as-is. See [model/README.md](model/README.md) to retrain it.

### Camera permissions

The browser asks for camera access the first time you open Boxing or Practice. Choose **Allow**.

- The app works only over `http://localhost` or https. Opened as a `file://` page it shows a warning
  and the camera stays blocked.
- Only one application can hold the webcam. Close Zoom, Teams or the Camera app first.
- Leaving a game screen stops the camera tracks immediately; the camera light should go out.
- If you blocked the camera by accident, click the camera icon in the address bar, allow access, and
  reload the page.

### Hosting

The app is a static site with no build step, so it can be published on GitHub Pages as-is. Pages is
served over https, which is a secure context, so the camera works there too.

## System architecture

No framework, no bundler, no backend. `index.html` loads `js/main.js` as a native ES module, and
everything runs in the browser.

```
            index.html  ── hash router (js/main.js) ── one <section> per screen
                                   │
         ┌─────────────────────────┼─────────────────────────┐
    js/boxing.js               js/practice.js           js/onboarding.js
         │                          │
         └──────────┬───────────────┘
                    │ both modes share:
      js/gestureConfig.js    all tuning numbers and the eight class names
      js/gestureDetector.js  smoothing, thresholds, streak, one-shot debounce
      js/combat.js           damage, guard, dodge, cooldowns, round and match rules
      js/model.js            loading, file checks, class validation, retry, warm-up
      js/camera.js           mirrored webcam canvas, zone crops, blank-frame check
      js/predictionBars.js   live confidence bars
      js/sound.js            synthesized sound effects (Web Audio)
```

`gestureConfig.js`, `gestureDetector.js`, `combat.js`, `modelValidation.js`, `model.js`,
`camera.js` and `predictionBars.js` never touch the DOM when they are imported, which is what lets
the test suite run them under Node.

## Project structure

```
index.html            All screens (hash router: #/, #/boxing, #/practice, #/rules, #/about, #/credits)
style.css             Styles
assets/favicon.svg    App icon
js/main.js            Router, app name, page titles
js/gestureConfig.js   Class names, detection thresholds, damage and match numbers
js/gestureDetector.js Raw predictions -> at most one move per pose
js/combat.js          Combat and match rules as pure functions
js/model.js           Loads and validates the Teachable Machine model
js/modelValidation.js Checks the model's class names against the game's
js/camera.js          Mirrored webcam canvas, 224x224 region crops, blank-frame detection
js/boxing.js          Two-player boxing game
js/practice.js        Practice mode
js/predictionBars.js  Live confidence bars
js/onboarding.js      First-run guide
js/sound.js           Synthesized sound effects (Web Audio)
model/                Exported Teachable Machine model (committed)
tests/                Unit tests, run with Node's built-in test runner
package.json          Dev-only: the test script. The app itself has no dependencies.
start.bat             Local server launcher for Windows
kenrick-task.txt      Dataset and training checklist
```

## Model integration

The app loads `model/model.json` and `model/metadata.json` once and shares the result across screens.
On load it:

1. fetches both JSON files and reports precisely which one is missing, unreadable or malformed;
2. loads the model through the Teachable Machine library;
3. runs one throwaway prediction to warm up the WebGL shaders — the very first prediction after load
   returns a different distribution from every prediction after it, so the warm-up keeps the first
   frame of a round trustworthy;
4. compares `getClassLabels()` with the eight names the game uses and reports missing, duplicated,
   renamed or extra classes by name;
5. publishes a load state the screens use to show progress, errors and a working **Retry model load**
   button.

Gameplay is blocked unless every required class is present under its exact name. The camera preview
keeps working regardless, so a model problem can be diagnosed with the live bars on screen.

### Gesture classes

The model must have exactly these eight classes. Spelling, spaces and capitals matter.

```
Idle, Jab, Uppercut, Kick, Guard, Dodge Left, Dodge Right, Ultimate
```

The committed model (`tm-my-image-model`, exported 2026-10-22) has all eight.

## How to play

1. Serve the app and open it. Allow the camera, and read the five-step guide.
2. **Boxing:** P1 stands in the left half of the frame, P2 in the right. Fill your half from head to
   waist. Wait until both live panels report "ready", then press **Start fight**.
3. Hold a pose clearly until the move fires, then return to Idle before the next one. A held pose
   fires only once.
4. A round ends on a K.O. or after 60 seconds, whoever has more HP. First to two rounds wins; the
   match always stops after three.
5. **Practice:** copy the move shown until the hold bar fills. Switch zones to check a move on both
   the left and right sides — lighting is rarely even across a room.

## Testing

```bash
npm test
```

Runs the unit tests with Node's built-in runner (Node 20 or newer). There are no dependencies to
install and no build step — `package.json` exists only so `npm test` has somewhere to live.

The tests cover the model class-name validation (including the committed model's own metadata), the
gesture-detection pipeline, the combat and match rules, the confidence bars, the blank-frame
safeguard, the model loader's state machine, and a static check that every element id and
data-attribute the JavaScript looks up still exists in `index.html`.

Anything needing a camera, a GPU or a real person has to be checked by hand in the browser — see
[INTEGRATION_REPORT.md](INTEGRATION_REPORT.md) for what was and was not verified that way.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Open the app through a local server" | `index.html` was opened as a file. Run `start.bat`. |
| "Camera access was blocked" | Allow the camera via the icon in the address bar, then reload. |
| "The camera is busy in another app" | Close Zoom, Teams or the Camera app and reload. |
| "No camera was found" | Connect a webcam and reload. |
| "The Teachable Machine library did not load" | TensorFlow.js comes from a CDN; check your connection and reload. |
| "model/model.json is missing" | Copy the three exported files into `model/`. See [model/README.md](model/README.md). |
| A class name error on load | A Teachable Machine class is misspelled. Rename it there and re-export; the message names the class. |
| Zone check says "nothing in frame" | The half is blank or very dark. Turn on a light and step into it. |
| Zone check says "unclear" | Confidence is below 75%, or two moves are too close. Make the pose bigger and hold still. |
| A move never fires | Check it in Practice in the same zone first. If confidence stays low there, that class needs more training images. |
| Moves fire when nobody is in frame | The `Idle` class needs empty-frame and partial-person images. See [Known limitations](#known-limitations). |

## Known limitations

- **Empty frames are a model weakness, not just a tuning problem.** The committed model was trained
  on people, so it labels a featureless image with high confidence: a solid black frame reads as
  `Ultimate` at about 90%, a flat grey one as `Guard` at about 71%. The app works around this by
  measuring pixel detail and rejecting blank frames before the model sees them, and by treating
  anything under 45% as an empty zone. Neither helps with a *partly* visible player, who still
  produces a confident but meaningless classification. The real fix is training data: add
  empty-frame, partial-person and dark-room images to the `Idle` class.
- **Per-class accuracy has not been measured.** No accuracy figure is claimed anywhere in the app or
  these docs. Measure it in Practice, in both the left and right zones, before quoting numbers.
- **Two players rarely fit in a phone's front camera.** Boxing is designed for a laptop or an
  external webcam. The layout works on a phone and the app says so, but the camera usually will not.
- **The ambient lighting of the room matters more than any setting in the app.** Back-lighting turns
  players into silhouettes, which the model has not seen.
- **TensorFlow.js 1.3.1** is pinned to match the Teachable Machine export. It prints a
  "High memory usage in GPU" warning on load; it is that version's own low threshold firing on a
  0.19 MB allocation, not an observed leak.

## Tech

Google Teachable Machine (image model, transfer learning on MobileNet), TensorFlow.js 1.3.1,
`@teachablemachine/image` 0.8.4, plain HTML/CSS/JavaScript modules. No build step.

## Team

| Contributor | Role |
|---|---|
| JerenzeLevi | Game design and the original web app: router, boxing, practice, camera, UI |
| Kenrick | Dataset collection and Teachable Machine training of the eight-class model |
| Valerie Joy Intong | Integration, model validation, gesture-detection tuning, QA, documentation |

Roles are taken from this repository's Git history and task notes. Add any further team members, and
replace handles with full names, before submitting.

## License

[MIT](LICENSE)
