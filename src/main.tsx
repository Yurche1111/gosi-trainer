import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./App.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("App crashed:", error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  hardReset = () => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, maxWidth: 720, margin: "0 auto", fontFamily: "Inter, sans-serif" }}>
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>Что-то сломалось 😕</h1>
          <p style={{ color: "#667085", marginBottom: 16, lineHeight: 1.55 }}>
            Тренажёр упал на этом действии. Это бывает редко — обычно из-за конфликта старого
            прогресса с новой версией. Попробуй один из вариантов ниже.
          </p>
          <pre style={{
            background: "#fee7e2",
            color: "#b42318",
            padding: 12,
            borderRadius: 10,
            overflowX: "auto",
            fontSize: 12,
            marginBottom: 16,
          }}>
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <div style={{ display: "grid", gap: 8 }}>
            <button
              type="button"
              onClick={this.reset}
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid #2457d6",
                background: "#2457d6",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Попробовать снова
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid #2457d6",
                background: "#fff",
                color: "#2457d6",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Перезагрузить страницу
            </button>
            <button
              type="button"
              onClick={this.hardReset}
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid #ee9d94",
                background: "#fee7e2",
                color: "#b42318",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Сбросить весь прогресс и перезагрузить
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
