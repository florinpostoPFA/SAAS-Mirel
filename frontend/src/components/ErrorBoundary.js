import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReload = this.handleReload.bind(this);
    this.handleHome = this.handleHome.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (process.env.NODE_ENV !== "production") {
      console.error("ErrorBoundary caught:", error, info);
    }
  }

  handleReload() {
    window.location.reload();
  }

  handleHome() {
    window.location.href = "/";
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message =
      (this.state.error && this.state.error.message) ||
      "Unexpected rendering error.";

    return (
      <div className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
        <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">
            Something went wrong.
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            The page hit an unexpected error and could not finish rendering.
          </p>
          {process.env.NODE_ENV !== "production" && (
            <pre className="mt-4 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-700">
              {message}
            </pre>
          )}
          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.handleHome}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }
}
