import { useEffect, useState } from "react";
import type { LiveState } from "../lib/types";
import CameraPreview from "./Preview";

export default function CameraSetup({ state, deviceId, onDevice, onCalibrate, onContinue, onSkip }: {
  state: LiveState | null;
  deviceId: string;
  onDevice: (id: string) => void;
  onCalibrate: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const cameraOn = state?.camera_on;
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let active = true;
    let request = 0;
    const update = async () => {
      const current = ++request;
      const items = await media.enumerateDevices().catch(() => []);
      if (active && current === request) setDevices(items.filter((item) => item.kind === "videoinput" && item.deviceId));
    };
    void update();
    media.addEventListener("devicechange", update);
    return () => { active = false; media.removeEventListener("devicechange", update); };
  }, [cameraOn]);

  const message = state?.cam_error ? "Revisa el permiso de cámara o elige otro dispositivo."
    : !cameraOn ? "Preparando tu cámara…"
    : state.calibrating ? "Quédate en esa posición mirando la pantalla."
    : state.calibrated ? "Calibración lista. Ya puedes continuar."
    : !state.present ? "No detectamos tu cara y tus hombros. Destapa la cámara y acomódate frente a ella."
    : state.calibration_failed ? "La calibración se interrumpió. Mantén la postura y vuelve a intentarlo."
    : "Siéntate derecho y pulsa Calibrar postura.";

  return <>
    <h1>Configura tu cámara</h1>
    <label className="camera-device">Cámara
      <select value={deviceId} onChange={(event) => onDevice(event.target.value)}>
        <option value="">Cámara predeterminada</option>
        {deviceId && !devices.some((device) => device.deviceId === deviceId) &&
          <option value={deviceId}>Cámara seleccionada</option>}
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>{device.label || `Cámara ${index + 1}`}</option>
        ))}
      </select>
    </label>
    <div className="video-box intro-camera">
      {cameraOn && <CameraPreview mode="Mostrar" />}
    </div>
    <p role="status">{message}</p>
    {state?.calibrating ? <progress aria-label="Calibración" max={1} value={state.cal_progress} />
      : state?.calibrated ? <button className="btn primary" onClick={onContinue}>Continuar</button>
      : state?.cam_error ? <button className="btn primary" onClick={() => onDevice(deviceId)}>Reintentar</button>
      : <button className="btn primary" disabled={!cameraOn || !state?.present} onClick={onCalibrate}>Calibrar postura</button>}
    {!state?.calibrated && <button className="btn" onClick={onSkip}>Configurar la cámara después</button>}
  </>;
}
