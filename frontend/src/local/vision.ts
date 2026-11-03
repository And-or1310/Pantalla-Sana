// Visión en el navegador: getUserMedia + MediaPipe Tasks (WASM). El video NUNCA sale de esta pestaña:
// se procesa aquí mismo y solo se dibuja en un <canvas> local.
import type { FaceLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import { LEFT_EYE, RIGHT_EYE, earValue, poseRaw, type Lm, type Raw } from "./core";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type FrameCb = (raw: Raw, ear: number | null, now: number) => void;

export class Vision {
  video: HTMLVideoElement | null = null;
  active = false;
  lastPose: Lm[] | null = null;
  connections: { start: number; end: number }[] = [];
  private stream: MediaStream | null = null;
  private pose: PoseLandmarker | null = null;
  private face: FaceLandmarker | null = null;
  private timer = 0;
  private token = 0;

  async start(onFrame: FrameCb, onReady: () => void, onFail: (e: unknown) => void) {
    this.active = true;
    const tok = ++this.token;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("este navegador no tiene cámara");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false });
      if (tok !== this.token) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
      const v = (this.video ??= document.createElement("video"));
      v.muted = true; v.playsInline = true; v.srcObject = stream;
      await v.play();
      if (!this.pose || !this.face) await this.loadModels();
      if (tok !== this.token) return;
      onReady();
      this.loop(onFrame, tok);
    } catch (e) {
      if (tok === this.token) { this.releaseStream(); this.active = false; onFail(e); }
    }
  }

  stop() {
    this.token++;
    window.clearTimeout(this.timer);
    this.releaseStream();
    this.lastPose = null;
    this.active = false;                                     // pausa = cámara APAGADA de verdad
  }

  private releaseStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  private async loadModels() {
    const { FilesetResolver, PoseLandmarker, FaceLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const make = async <T,>(f: (delegate: "GPU" | "CPU") => Promise<T>) => { try { return await f("GPU"); } catch { return f("CPU"); } };
    this.pose = await make((delegate) => PoseLandmarker.createFromOptions(fileset,
      { baseOptions: { modelAssetPath: POSE_MODEL, delegate }, runningMode: "VIDEO", numPoses: 1 }));
    this.face = await make((delegate) => FaceLandmarker.createFromOptions(fileset,
      { baseOptions: { modelAssetPath: FACE_MODEL, delegate }, runningMode: "VIDEO", numFaces: 1 }));
    this.connections = PoseLandmarker.POSE_CONNECTIONS;
  }

  private loop(cb: FrameCb, tok: number) {
    if (tok !== this.token) return;
    const v = this.video;
    if (v && this.pose && this.face && v.readyState >= 2 && v.videoWidth) {
      try {
        const ts = performance.now();
        const pr = this.pose.detectForVideo(v, ts);
        const fr = this.face.detectForVideo(v, ts);
        const plm = (pr.landmarks[0] as Lm[] | undefined) ?? null;
        this.lastPose = plm;
        const f = fr.faceLandmarks[0] as Lm[] | undefined;
        const ear = f ? (earValue(f, LEFT_EYE, v.videoWidth, v.videoHeight) + earValue(f, RIGHT_EYE, v.videoWidth, v.videoHeight)) / 2 : null;
        cb(plm ? poseRaw(plm) : {}, ear, Date.now() / 1000);
      } catch { /* un cuadro malo no detiene el bucle */ }
    }
    this.timer = window.setTimeout(() => this.loop(cb, tok), 50);
  }
}
