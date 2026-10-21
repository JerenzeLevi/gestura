# Gestura

Touchless, gesture-controlled games in the browser. A webcam and a custom image model trained in
[Google Teachable Machine](https://teachablemachine.withgoogle.com/) turn hand poses into game moves.
No keyboard, mouse or touch screen needed, and camera frames never leave the device.

Course project for **Intelligent Systems**.

## Features

- **Boxing (2 players, 1 camera):** the mirrored webcam frame is split into a left half (P1) and a right half (P2), each classified separately. HP, stamina, ultimate meter, 60 s rounds, best of 3.
- **Practice (1 player):** the app asks for a move, you hold it until the bar fills, and live confidence bars show what the model predicts.
- **Rules, About and Credits** pages.

## Moves

| Class | Gesture | Effect |
|---|---|---|
| `Idle` | Hands down, relaxed | Stamina recovers |
| `Jab` | Closed fist | 5 damage |
| `Uppercut` | Thumbs up | 12 damage |
| `Kick` | Thumbs down | 10 damage |
| `Guard` | Both open palms | Take 20% damage, drains stamina |
| `Dodge Left` / `Dodge Right` | Head lean left / right | Avoid all damage for 0.5 s |
| `Ultimate` | Peace sign | 30 damage, needs a full meter |

A move fires when its class stays the top prediction above 75% confidence for two predictions in a row.

## Running it

The browser only allows the camera and the model files over http, so don't open `index.html` directly.

- **Windows:** double-click `start.bat` (opens http://localhost:8000).
- **Anywhere:** `python -m http.server 8000` in this folder, then open http://localhost:8000.

The trained model must be in `model/` (`model.json`, `metadata.json`, `weights.bin`). See [model/README.md](model/README.md).

## Project structure

```
index.html          All screens (hash router: #/, #/boxing, #/practice, #/rules, #/about, #/credits)
style.css           Styles
js/main.js          Router, app name
js/model.js         Loads the Teachable Machine model and runs predictions
js/camera.js        Mirrored webcam canvas and the 224x224 region crops
js/boxing.js        Two-player boxing game logic
js/practice.js      Practice mode
js/predictionBars.js Live confidence bars
js/sound.js         Synthesized sound effects (Web Audio)
model/              Exported Teachable Machine model goes here
start.bat           Local server launcher for Windows
kenrick-task.txt    Step-by-step dataset and training checklist
```

## Status / to do

The game code works, but the project is not finished. Open items:

### Dataset and model (blocking)
- [ ] **No trained model yet.** `model/` only has a README, so both games stop at "Could not load the model". Follow [kenrick-task.txt](kenrick-task.txt).
- [ ] Record the 8 classes with the exact names above (150+ images each, several people, lighting conditions and backgrounds, one person per sample at half-frame size).
- [ ] Include empty-frame and partial-person shots in `Idle`, so the game doesn't fire moves when nobody is there.
- [ ] Test every move in both the P1 and P2 zones in Practice, and note per-class accuracy / confusions (Jab vs Kick, Dodge Left vs Dodge Right are likely) for the report.
- [ ] Keep the raw images out of the repo (`dataset/` is git-ignored). Commit only the three exported model files.

### UI and polish
- [ ] **Credits page still says "Your name here"** (`index.html`, Credits section). Add the team names.
- [ ] Rules page uses emoji for gestures. Photos or short GIFs of each real pose would make the moves much easier to learn.
- [ ] No warning when the model's class names don't match the game's (a typo like `Dodge left` just never triggers). Show a clear message on load if a class is missing.
- [ ] No first-run onboarding or camera calibration (e.g. "stand so your body fits the P1 box").
- [ ] Home screen has two "Coming soon" cards (Sign Language, More games): build one or remove them before submitting.
- [ ] Tune `TRIGGER_CONFIDENCE`, `TRIGGER_STREAK` and the damage/cooldown values in `js/boxing.js` once the real model exists.
- [ ] Check the layout on a phone and a small laptop screen.
- [ ] No app icon / favicon, and no end-of-match summary screen.
- [ ] Optional: host it on GitHub Pages (works as-is, it's a static site served over https).

## Tech

Google Teachable Machine (image model, transfer learning on MobileNet), TensorFlow.js 1.3.1,
`@teachablemachine/image` 0.8.4, plain HTML/CSS/JavaScript modules. No build step.

## License

[MIT](LICENSE)
