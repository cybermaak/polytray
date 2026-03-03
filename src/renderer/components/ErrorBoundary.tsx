import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="error-boundary"
          style={{
            padding: "40px",
            textAlign: "center",
            color: "var(--text-primary)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            background: "var(--bg-base)",
          }}
        >
          <h1
            style={{
              marginBottom: "16px",
              color: "var(--accent-glow)",
              fontSize: "24px",
            }}
          >
            Something went wrong
          </h1>
          <p style={{ marginBottom: "24px", color: "var(--text-muted)" }}>
            An unexpected error occurred in the application rendering tree.
          </p>
          <pre
            style={{
              textAlign: "left",
              background: "var(--bg-elevated)",
              padding: "16px",
              borderRadius: "8px",
              overflow: "auto",
              maxWidth: "80%",
              marginBottom: "24px",
              fontSize: "12px",
              color: "var(--text-muted)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {this.state.error?.toString()}
          </pre>
          <button
            className="btn-primary"
            style={{ padding: "8px 16px" }}
            onClick={() => window.location.reload()}
          >
            Reload application
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
