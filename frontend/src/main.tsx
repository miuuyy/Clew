import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { LaunchError } from "./components/AppErrorBoundary";
import { getAppCopy, readAppLocale, readBrowserLocale } from "./lib/appLocale";
import { readInitialThemeMode } from "./lib/appStatePersistence";
import { ensureThemeStylesheet } from "./lib/themeStyles";
import "katex/dist/katex.min.css";
import "./styles.css";

ensureThemeStylesheet(readInitialThemeMode());

const root = ReactDOM.createRoot(document.getElementById("root")!);
void readAppLocale().then(
  (locale) => root.render(<React.StrictMode><App initialLocale={locale} /></React.StrictMode>),
  (error: unknown) => {
    const locale = readBrowserLocale();
    document.documentElement.lang = locale;
    root.render(<LaunchError copy={getAppCopy(locale).launch} detail={String(error)} />);
  },
);
