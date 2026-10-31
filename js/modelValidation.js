// Checks the class labels a loaded Teachable Machine model reports against the
// names the game looks moves up by. A typo like "Dodge left" used to mean that
// move simply never fired, with nothing on screen to explain why.
//
// Pure functions, no DOM and no model object: boxing, practice and the tests all
// call the same code.

import { REQUIRED_CLASSES } from "./gestureConfig.js";

const normalize = (name) => String(name).trim().replace(/\s+/g, " ").toLowerCase();

/**
 * @param {string[]} labels class names from model.getClassLabels()
 * @returns {{
 *   ok: boolean, usable: boolean,
 *   missing: string[], extra: string[], duplicates: string[],
 *   renamed: {expected: string, found: string}[],
 *   errors: string[], warnings: string[],
 * }}
 *
 * `ok`     - the model matches the game exactly.
 * `usable` - every required class is present under its exact name. Extra classes
 *            are tolerated (they just never map to a move), so the game can still run.
 */
export function validateClassLabels(labels) {
  const result = {
    ok: false,
    usable: false,
    missing: [],
    extra: [],
    duplicates: [],
    renamed: [],
    errors: [],
    warnings: [],
  };

  if (!Array.isArray(labels) || labels.length === 0) {
    result.errors.push("The model reports no classes at all. Re-export it from Teachable Machine.");
    return result;
  }

  const seen = new Map();
  for (const label of labels) {
    const key = normalize(label);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  result.duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([key]) => key);

  const exact = new Set(labels);
  const byNormalized = new Map();
  for (const label of labels) {
    if (!byNormalized.has(normalize(label))) byNormalized.set(normalize(label), label);
  }

  for (const required of REQUIRED_CLASSES) {
    if (exact.has(required)) continue;
    const near = byNormalized.get(normalize(required));
    if (near) result.renamed.push({ expected: required, found: near });
    else result.missing.push(required);
  }

  const requiredNormalized = new Set(REQUIRED_CLASSES.map(normalize));
  result.extra = labels.filter((label) => !requiredNormalized.has(normalize(label)));

  if (result.missing.length) {
    result.errors.push(
      `The model is missing ${result.missing.length} class${result.missing.length > 1 ? "es" : ""}: ` +
        `${result.missing.join(", ")}. Add ${result.missing.length > 1 ? "them" : "it"} in Teachable Machine and retrain.`
    );
  }
  for (const { expected, found } of result.renamed) {
    result.errors.push(
      `Class "${found}" must be spelled exactly "${expected}" (capitals and spaces matter). Rename it in Teachable Machine and re-export.`
    );
  }
  for (const key of result.duplicates) {
    result.errors.push(`Two or more classes are named "${key}". Class names must be unique.`);
  }
  if (result.extra.length) {
    result.warnings.push(
      `The model has ${result.extra.length} class${result.extra.length > 1 ? "es" : ""} the game does not use: ${result.extra.join(", ")}. ` +
        "They are ignored, but they take confidence away from the moves."
    );
  }

  result.usable = result.missing.length === 0 && result.renamed.length === 0 && result.duplicates.length === 0;
  result.ok = result.usable && result.extra.length === 0;
  return result;
}

// One line fit for a status bar, or "" when there is nothing to report.
export function describeValidation(validation) {
  if (!validation) return "";
  if (validation.errors.length) return validation.errors.join(" ");
  if (validation.warnings.length) return validation.warnings.join(" ");
  return "";
}
