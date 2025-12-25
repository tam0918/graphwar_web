import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";

import "./global.css";

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("[RootErrorBoundary]", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="gw-app">
          <h1>Graphwar Web</h1>
          <div className="gw-panel gw-panelStrong gw-stack" style={{ maxWidth: 860 }}>
            <h2>Oops — UI crashed</h2>
            <div className="gw-muted" style={{ fontSize: 13, lineHeight: 1.4 }}>
              Mở DevTools → Console để xem lỗi chi tiết.
            </div>
            <pre className="gw-chatLog" style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
            <div className="gw-row">
              <button className="gw-btn gw-btnPrimary" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
