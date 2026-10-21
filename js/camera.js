// Mirrored webcam drawn to a canvas of a fixed size.
// tmImage.Webcam only supports square frames, so the boxing game's 2:1 split view needs its own camera.

export class Camera {
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
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Object.assign(new Error("Camera API unavailable"), { name: "InsecureContextError" });
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.loop();
  }

  loop = () => {
    this.draw();
    this.rafId = requestAnimationFrame(this.loop);
  };

  // Center-crops the video to the canvas aspect ratio and draws it mirrored,
  // so players see themselves like in a mirror (left side of the screen = player on the left).
  draw() {
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
  }

  stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    this.rafId = null;
    this.stream = null;
    this.video = null;
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
      return "The camera is busy in another app (Zoom, Teams, the Camera app…). Close that app and reload the page.";
    case "InsecureContextError":
      return "The browser blocks the camera here. Open the app through http://localhost (run start.bat), not as a file.";
    default:
      return "Could not start the webcam. Check that a camera is connected and allowed for this page.";
  }
}

// A square canvas that receives one region of the camera frame, sized to the model's 224x224 input.
export class Region {
  constructor(size = 224) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = size;
    this.canvas.height = size;
    this.ctx = this.canvas.getContext("2d");
  }

  // Copies the rectangle (x, y, w, h) of the source canvas into this region.
  capture(source, x, y, w, h) {
    this.ctx.drawImage(source, x, y, w, h, 0, 0, this.canvas.width, this.canvas.height);
    return this.canvas;
  }
}
