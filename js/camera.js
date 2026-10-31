// Mirrored webcam drawn to a canvas of a fixed size.
// tmImage.Webcam only supports square frames, so the boxing game's 2:1 split view needs its own camera.

export class Camera {
  // Kept so the "ended" listeners can be removed again in stop().
  #handleTrackEnd = null;

  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d");
    this.video = null;
    this.stream = null;
    this.rafId = null;
    this.stopped = false;
    this.ready = false; // true once the video has produced at least one frame
    // Set by the caller to hear about a camera that is unplugged or taken over mid-game.
    this.onLost = null;
    this.onReady = null;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error("Camera API unavailable"), { name: "InsecureContextError" });
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

    // From here on the stream is live, so every failure path must stop its tracks
    // or the camera light stays on with nothing using it.
    try {
      this.video = document.createElement("video");
      this.video.playsInline = true;
      this.video.muted = true;
      this.video.srcObject = this.stream;
      await this.video.play();
    } catch (err) {
      this.stop();
      throw err;
    }
    if (this.stopped) {
      // The caller left the screen while getUserMedia was still pending.
      this.stop();
      return;
    }

    // A webcam that is unplugged, or grabbed by another app, ends its track.
    this.#handleTrackEnd = () => {
      if (this.stopped) return;
      this.onLost?.();
    };
    this.stream.getTracks().forEach((track) => track.addEventListener("ended", this.#handleTrackEnd));

    this.loop();
  }

  loop = () => {
    if (this.stopped) return;
    this.draw();
    this.rafId = requestAnimationFrame(this.loop);
  };

  // Center-crops the video to the canvas aspect ratio and draws it mirrored,
  // so players see themselves like in a mirror (left side of the screen = player on the left).
  draw() {
    if (!this.video) return;
    const { videoWidth: vw, videoHeight: vh } = this.video;
    if (!vw || !vh) return;
    const aspect = this.width / this.height;
    let sw = vw;
    let sh = vh;
    if (vw / vh > aspect) sw = vh * aspect;
    else sh = vw / aspect;

    this.ctx.save();
    this.ctx.translate(this.width, 0);
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(this.video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, this.width, this.height);
    this.ctx.restore();

    if (!this.ready) {
      this.ready = true;
      this.onReady?.();
    }
  }

  // Idempotent: safe to call twice, and safe to call while start() is still pending.
  stop() {
    this.stopped = true;
    this.onLost = null;
    this.onReady = null;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        if (this.#handleTrackEnd) track.removeEventListener("ended", this.#handleTrackEnd);
        track.stop();
      }
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null; // releases the decoder; without this Chrome keeps the frame buffer
      this.video.removeAttribute("src");
    }
    this.stream = null;
    this.video = null;
    this.ready = false;
  }

  get active() {
    return !this.stopped && Boolean(this.stream);
  }
}

export async function startCamera(width, height) {
  const camera = new Camera(width, height);
  await camera.start();
  return camera;
}

// Turns a getUserMedia error into advice the player can act on.
export function cameraErrorMessage(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Click the camera icon in the address bar, allow access, then reload the page.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found. Connect a webcam and reload the page.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is busy in another app (Zoom, Teams, the Camera app…). Close that app and reload the page.";
    case "InsecureContextError":
      return "The browser blocks the camera here. Open the app through http://localhost (run start.bat), not as a file.";
    default:
      return "Could not start the webcam. Check that a camera is connected and allowed for this page.";
  }
}

export const CAMERA_LOST_MESSAGE =
  "The camera stopped sending video. It may have been unplugged or taken over by another app. Reconnect it, then leave and re-enter this screen.";

// Below this standard deviation of brightness, a region has no visible structure:
// a covered lens, a pitch-dark room, a blank wall filling the whole zone.
//
// This is a safeguard the model cannot provide. The trained classifier was only ever
// shown people, so a featureless frame still gets confidently assigned to some class
// (the committed model reads a solid black frame as "Ultimate" at about 90%). No
// confidence threshold can catch that, because the confidence really is high.
// Measuring the pixels instead is independent of the model and of its Idle class.
export const BLANK_FRAME_DETAIL = 8;

// A square canvas that receives one region of the camera frame, sized to the model's 224x224 input.
export class Region {
  constructor(size = 224) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext("2d");

    // Detail is measured on a 32x32 copy: 1024 pixels is plenty to tell a blank
    // frame from a room, and it keeps the per-frame readback cheap.
    this.probe = document.createElement("canvas");
    this.probe.width = 32;
    this.probe.height = 32;
    this.probeCtx = this.probe.getContext("2d", { willReadFrequently: true });
  }

  // Copies the rectangle (x, y, w, h) of the source canvas into this region.
  // Returns null for an empty rectangle, so callers can skip a pointless prediction.
  capture(source, x, y, w, h) {
    if (!source || w <= 0 || h <= 0) return null;
    this.ctx.drawImage(source, x, y, w, h, 0, 0, this.canvas.width, this.canvas.height);
    return this.canvas;
  }

  /** Standard deviation of brightness (0-255) across the captured region. */
  detail() {
    this.probeCtx.drawImage(this.canvas, 0, 0, this.probe.width, this.probe.height);
    let pixels;
    try {
      pixels = this.probeCtx.getImageData(0, 0, this.probe.width, this.probe.height).data;
    } catch {
      return Number.POSITIVE_INFINITY; // a tainted canvas should never block the game
    }
    let sum = 0;
    let sumSquares = 0;
    const count = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      // Rec. 601 luma, close enough for a "is anything there" test.
      const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      sum += luma;
      sumSquares += luma * luma;
    }
    const mean = sum / count;
    return Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
  }

  /** True when the region has no visible structure, whatever the model would say about it. */
  isBlank() {
    return this.detail() < BLANK_FRAME_DETAIL;
  }
}
