import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { readInitialThemeMode } from "./lib/appStatePersistence";
import { ensureThemeStylesheet } from "./lib/themeStyles";
import "katex/dist/katex.min.css";
import "./styles.css";

ensureThemeStylesheet(readInitialThemeMode());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>,
);
