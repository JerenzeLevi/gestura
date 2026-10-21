// Hash router: shows one screen at a time and starts/stops the camera screens as you move between them.

import { initBoxing, enterBoxing, leaveBoxing } from "./boxing.js";
import { initPractice, enterPractice, leavePractice } from "./practice.js";

// Working title; change it here to rename the app everywhere.
const APP_NAME = "Gestura";

const SCREENS = {
  menu:     {},
  boxing:   { enter: enterBoxing, leave: leaveBoxing },
  practice: { enter: enterPractice, leave: leavePractice },
  rules:    {},
  about:    {},
  credits:  {},
};

let current = null;

function route() {
  const name = location.hash.replace(/^#\/?/, "") || "menu";
  const next = SCREENS[name] ? name : "menu";
  if (next === current) return;

  if (current) SCREENS[current].leave?.();
  current = next;

  document.querySelectorAll("[data-screen]").forEach((section) => {
    section.hidden = section.dataset.screen !== next;
  });
  document.querySelectorAll(".nav a").forEach((link) => {
    link.toggleAttribute("aria-current", link.getAttribute("href") === `#/${next === "menu" ? "" : next}`);
  });

  window.scrollTo(0, 0);
  SCREENS[next].enter?.();
}

document.title = APP_NAME;
document.querySelectorAll("[data-app-name]").forEach((node) => (node.textContent = APP_NAME));

initBoxing();
initPractice();
window.addEventListener("hashchange", route);
route();
