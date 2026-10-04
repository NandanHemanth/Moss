import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyMotion, applyTheme, motionStore, themeStore } from "./session";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/grove.css";

applyTheme(themeStore.get());
applyMotion(motionStore.get());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
