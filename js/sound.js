// Tiny synthesized sound effects (Web Audio), so the game needs no audio files.

let audio = null;

const SOUNDS = {
  hit:      { type: "square",   from: 220, to: 90,  duration: 0.12, volume: 0.18 },
  block:    { type: "triangle", from: 160, to: 140, duration: 0.10, volume: 0.20 },
  miss:     { type: "sine",     from: 600, to: 900, duration: 0.10, volume: 0.10 },
  ultimate: { type: "sawtooth", from: 120, to: 900, duration: 0.45, volume: 0.15 },
  beep:     { type: "sine",     from: 660, to: 660, duration: 0.12, volume: 0.15 },
  go:       { type: "sine",     from: 880, to: 880, duration: 0.30, volume: 0.15 },
  success:  { type: "triangle", from: 520, to: 1040, duration: 0.20, volume: 0.15 },
};

export function playSound(name) {
  const s = SOUNDS[name];
  if (!s) return;
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = s.type;
    osc.frequency.setValueAtTime(s.from, t);
    osc.frequency.exponentialRampToValueAtTime(s.to, t + s.duration);
    gain.gain.setValueAtTime(s.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + s.duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + s.duration);
  } catch {
    // Sound is optional; ignore browsers that block or lack Web Audio.
  }
}
