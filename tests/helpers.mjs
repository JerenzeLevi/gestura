// Shared helpers for the unit tests.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export const readRepoFile = (relative) => readFile(join(repoRoot, relative), "utf8");

export const readRepoJson = async (relative) => JSON.parse(await readRepoFile(relative));

/** Prediction list from a {className: probability} map, in insertion order. */
export const predictions = (map) =>
  Object.entries(map).map(([className, probability]) => ({ className, probability }));

/**
 * A prediction list where `name` takes `top` of the probability mass and the rest is
 * shared evenly, mimicking what Teachable Machine returns for a confident pose.
 */
export function oneHot(classes, name, top = 0.95) {
  const rest = classes.length > 1 ? (1 - top) / (classes.length - 1) : 0;
  return classes.map((className) => ({ className, probability: className === name ? top : rest }));
}

/** A prediction list with every class at the same probability: nothing recognisable. */
export const flat = (classes) =>
  classes.map((className) => ({ className, probability: 1 / classes.length }));
