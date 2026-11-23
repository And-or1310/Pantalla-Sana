import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { engine } from "./core/engine";
import { account } from "./core/account";
import "./styles/styles.css";
import "./styles/web.css";

engine.setPaused(true);
account.start();
engine.start();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
