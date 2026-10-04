import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, themeStore } from "./session";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/grove.css";

applyTheme(themeStore.get());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
