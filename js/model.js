// Loads the Teachable Machine image model exported into ./model/ (model.json, metadata.json, weights.bin).
// The model is shared by every screen, so it is loaded once and cached.

const MODEL_URL = "model/model.json";
const METADATA_URL = "model/metadata.json";

export const MODEL_ERROR =
  "Could not load the model. Copy model.json, metadata.json and weights.bin into the model/ folder.";

let model = null;
let loading = null;

export async function loadModel() {
  if (model) return model;
  if (!loading) {
    loading = tmImage.load(MODEL_URL, METADATA_URL)
      .then((m) => (model = m))
      .catch((err) => {
        loading = null; // allow a retry after the files are added
        throw err;
      });
  }
  return loading;
}

// Returns [{ className, probability }] for any image, video or canvas.
// Teachable Machine crops and resizes the input to its 224x224 training size.
export function predict(source) {
  return model.predict(source);
}

export function getClassLabels() {
  return model ? model.getClassLabels() : [];
}

export function topPrediction(predictions) {
  return predictions.reduce((best, p) => (p.probability > best.probability ? p : best));
}
