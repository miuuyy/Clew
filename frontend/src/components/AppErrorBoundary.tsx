import { Component, type ReactNode } from "react";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <main className="launchLoading"><div className="launchError">
      <p role="alert">Clew could not open this view. {this.state.error.message}</p>
      <button className="uiButton" type="button" onClick={() => window.location.reload()}>Restart view</button>
    </div></main>;
    return this.props.children;
  }
}
