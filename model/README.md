# Model files

Put the files exported from Teachable Machine here: `model.json`, `metadata.json` and `weights.bin`.
The app loads them from `model/model.json` and `model/metadata.json`.

## Classes

Create an **Image Project** with exactly these class names (spelling and capitals matter, the game looks them up by name):

| Class | Pose to record |
|---|---|
| `Idle` | Standing relaxed, hands down. Also add a few shots with nobody or only part of a person in view. |
| `Jab` | Closed fist toward the camera. |
| `Uppercut` | Thumbs up (like). |
| `Kick` | Thumbs down (dislike). |
| `Guard` | Both open palms facing the camera. |
| `Dodge Left` | Head leaning to the left (the player's own left). |
| `Dodge Right` | Head leaning to the right (the player's own right). |
| `Ultimate` | Peace sign (two fingers up). |

If a move is unreliable, retrain those classes with a different, clearly distinct hand pose. Keep the class name the same; no code changes are needed.

## Recording tips for the 2-player game

The game cuts the camera image into a **left half (P1)** and a **right half (P2)** and classifies each half on its own. So:

- Record each sample with **one person**, filling the frame roughly as they will fill their half in the game (shoulders to waist, a bit of space around).
- Record several people, both sides of the room, different clothes and lighting. Aim for 150 or more images per class.
- Hold each pose steady while recording. The model sees single frames, not motion.
- After exporting, open **Practice** in the app and check every move reaches a high confidence in the P1 and P2 zones.

## Export

1. In Teachable Machine click **Export Model** → **Tensorflow.js** → **Download my model**.
2. Unzip and copy `model.json`, `metadata.json` and `weights.bin` into this folder.
3. Serve the app over http (e.g. `python -m http.server` inside `task1_teachable_web`), not by opening the file directly.
