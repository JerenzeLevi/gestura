// Hash router: shows one screen at a time and starts/stops the camera screens as you move between them.

import { initBoxing, enterBoxing, leaveBoxing } from "./boxing.js";
import { initPractice, enterPractice, leavePractice } from "./practice.js";
import { initOnboarding } from "./onboarding.js";

// Working title; change it here to rename the app everywhere.
const APP_NAME = "Gestura";

const SCREENS = {
  menu: { title: "Games" },
  boxing: { title: "Boxing", enter: enterBoxing, leave: leaveBoxing },
  practice: { title: "Practice", enter: enterPractice, leave: leavePractice },
  rules: { title: "Moves & rules" },
  about: { title: "About" },
  credits: { title: "Credits" },
};

let current = null;

const hrefFor = (name) => `#/${name === "menu" ? "" : name}`;

function route() {
  const name = location.hash.replace(/^#\/?/, "").split(/[?#]/)[0] || "menu";
  const next = Object.hasOwn(SCREENS, name) ? name : "menu";

  // An unknown hash (a stale bookmark, a typo) falls back to the menu, and the URL is
  // corrected so the nav highlight and the address bar agree. Without this the nav
  // stayed unhighlighted until the next navigation.
  if (next !== name) {
    location.replace(hrefFor(next));
    return;
  }
  if (next === current) return;

  if (current) SCREENS[current].leave?.();
  current = next;

  document.querySelectorAll("[data-screen]").forEach((section) => {
    section.hidden = section.dataset.screen !== next;
  });
  document.querySelectorAll(".nav a").forEach((link) => {
    // aria-current takes a token, not an empty string.
    if (link.getAttribute("href") === hrefFor(next)) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  document.title = next === "menu" ? `${APP_NAME} — gesture-controlled games` : `${SCREENS[next].title} · ${APP_NAME}`;
  window.scrollTo(0, 0);
  SCREENS[next].enter?.();
}

document.querySelectorAll("[data-app-name]").forEach((node) => (node.textContent = APP_NAME));

initBoxing();
initPractice();
initOnboarding();
window.addEventListener("hashchange", route);
// Leaving the page (reload, tab close, back out of the SPA) must release the webcam.
window.addEventListener("pagehide", () => {
  if (current) SCREENS[current].leave?.();
  current = null;
});
route();
