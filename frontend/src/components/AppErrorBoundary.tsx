import { Component, type ReactNode } from "react";
import type { AppCopy } from "../lib/appCopy";

export function LaunchError({ copy, detail }: { copy: AppCopy["launch"]; detail: string }) {
  return <main className="launchLoading"><div className="launchError">
    <p role="alert">{copy.viewError} {detail}</p>
    <button className="uiButton" type="button" onClick={() => window.location.reload()}>{copy.restart}</button>
  </div></main>;
}

export class AppErrorBoundary extends Component<{ children: ReactNode; copy: AppCopy["launch"] }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return <LaunchError copy={this.props.copy} detail={this.state.error.message} />;
    return this.props.children;
  }
}
