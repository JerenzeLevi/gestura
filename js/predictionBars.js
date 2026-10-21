// Renders a probability bar per class, highest first.
// Uses textContent (not innerHTML) because class names come from the model metadata.
export function renderPredictions(container, predictions) {
  const sorted = [...predictions].sort((a, b) => b.probability - a.probability);

  container.replaceChildren(...sorted.map((p, i) => {
    const pct = Math.round(p.probability * 100);

    const row = document.createElement("div");
    row.className = i === 0 ? "bar-row top" : "bar-row";

    const meta = document.createElement("div");
    meta.className = "bar-meta";
    const name = document.createElement("span");
    name.textContent = p.className;
    const value = document.createElement("span");
    value.textContent = `${pct}%`;
    meta.append(name, value);

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.width = `${pct}%`;
    track.append(fill);

    row.append(meta, track);
    return row;
  }));
}
