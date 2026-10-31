// First-run onboarding: what the camera is used for, where to stand, and what the
// confidence numbers mean. Shown once per browser and reopenable from any screen.
//
// Uses <dialog>.showModal(), so focus trapping, Esc and the backdrop come from the
// browser instead of hand-rolled JavaScript.

const SEEN_KEY = "gestura.onboarding.seen.v1";

// localStorage throws in some privacy modes; onboarding must never break the app.
function hasSeen() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Nothing to do: the guide simply shows again next time.
  }
}

let dialog = null;
let steps = [];
let dots = [];
let index = 0;
let el = {};

export function initOnboarding() {
  dialog = document.getElementById("onboarding");
  if (!dialog) return;

  steps = [...dialog.querySelectorAll("[data-step]")];
  el = {
    back: dialog.querySelector("[data-onboarding-back]"),
    next: dialog.querySelector("[data-onboarding-next]"),
    close: dialog.querySelectorAll("[data-onboarding-close]"),
    progress: dialog.querySelector(".onboarding-dots"),
    counter: dialog.querySelector("[data-onboarding-counter]"),
  };

  dots = steps.map((_, i) => {
    const dot = document.createElement("span");
    dot.className = "onboarding-dot";
    dot.setAttribute("aria-hidden", "true");
    dot.addEventListener("click", () => show(i));
    el.progress.append(dot);
    return dot;
  });

  el.back.addEventListener("click", () => show(index - 1));
  el.next.addEventListener("click", () => {
    if (index === steps.length - 1) closeOnboarding();
    else show(index + 1);
  });
  el.close.forEach((button) => button.addEventListener("click", closeOnboarding));
  // Covers Esc and the backdrop as well as the buttons.
  dialog.addEventListener("close", markSeen);

  document.querySelectorAll("[data-open-onboarding]").forEach((button) => {
    button.addEventListener("click", () => openOnboarding(Number(button.dataset.openOnboarding) || 0));
  });

  if (!hasSeen()) openOnboarding(0);
}

export function openOnboarding(startStep = 0) {
  if (!dialog) return;
  show(startStep);
  if (!dialog.open) dialog.showModal();
}

export function closeOnboarding() {
  markSeen();
  if (dialog?.open) dialog.close();
}

function show(next) {
  index = Math.max(0, Math.min(steps.length - 1, next));
  steps.forEach((step, i) => (step.hidden = i !== index));
  dots.forEach((dot, i) => dot.classList.toggle("active", i === index));
  el.back.disabled = index === 0;
  el.next.textContent = index === steps.length - 1 ? "Start playing" : "Next";
  el.counter.textContent = `Step ${index + 1} of ${steps.length}`;
}
