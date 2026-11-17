import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ls } from "./core/store";
import { engine } from "./core/engine";
import "./styles/styles.css";
import "./styles/web.css";

if (!ls.get("ps.introDone", false)) engine.setPaused(true);
engine.start();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
