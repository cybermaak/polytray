import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

const root = createRoot(document.getElementById("app")!);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
