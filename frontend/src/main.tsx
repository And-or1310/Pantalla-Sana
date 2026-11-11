import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { engine } from "./core/engine";
import "./styles/styles.css";
import "./styles/web.css";

engine.start();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
