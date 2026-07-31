import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "@xyflow/react/dist/style.css";

import { App } from "./App";
import { api } from "./api";
import "./styles.css";

class CrashBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void api.reportClientCrash({
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
      ...(info.componentStack ? { componentStack: info.componentStack } : {}),
      url: window.location.href,
      userAgent: navigator.userAgent,
    }).catch(() => undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const text = `${this.state.error.name}: ${this.state.error.message}\n${this.state.error.stack ?? ""}`;
    return <main className="fatal">
      <h1>Tourguide crashed</h1>
      <p>The crash was saved to <code>.tourguide/diagnostics/latest.json</code>.</p>
      <pre>{text}</pre>
      <button onClick={() => navigator.clipboard.writeText(text)}>Copy crash details</button>
      <small>Run <code>tourguide diagnostics</code> in this repository for the complete report.</small>
    </main>;
  }
}

window.addEventListener("unhandledrejection", (event) => {
  const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
  void api.reportClientCrash({
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    url: window.location.href,
    userAgent: navigator.userAgent,
  }).catch(() => undefined);
});
window.addEventListener("error", (event) => {
  const error = event.error instanceof Error ? event.error : new Error(event.message || "Unknown browser error");
  void api.reportClientCrash({
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
    url: window.location.href,
    userAgent: navigator.userAgent,
  }).catch(() => undefined);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><CrashBoundary><App /></CrashBoundary></React.StrictMode>,
);
