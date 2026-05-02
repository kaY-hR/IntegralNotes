import React from "react";
import ReactDOM from "react-dom/client";

import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import "flexlayout-react/style/light.css";
import { App } from "./App";
import "./styles.css";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function logRendererDiagnostic(
  event: string,
  details: Record<string, boolean | null | number | string | undefined>
): void {
  try {
    void window.integralNotes
      .logRendererEvent({
        details,
        event,
        source: "renderer"
      })
      .catch(() => {});
  } catch {
    // Diagnostics must not affect app startup.
  }
}

window.addEventListener("error", (event) => {
  logRendererDiagnostic("window-error", {
    colno: event.colno,
    filename: event.filename,
    lineno: event.lineno,
    message: event.message
  });
});

window.addEventListener("unhandledrejection", (event) => {
  logRendererDiagnostic("unhandled-rejection", {
    message: toErrorMessage(event.reason)
  });
});

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);


