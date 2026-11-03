import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { engine } from "./local/engine";
import "./styles.css";
import "./web.css";

engine.start();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
