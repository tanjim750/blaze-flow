"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps a failure in the annotation layer (drawing, shapes, the list) inside that layer:
 * the player, comments and decisions stay usable, and "Try again" remounts the layer.
 */
export class AnnotationBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Annotation layer failed", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="rvp-annotation-error" role="alert">
        <span>{this.props.label ?? "Annotations couldn’t be shown."}</span>
        <button type="button" onClick={() => this.setState({ failed: false })}>Try again</button>
      </div>
    );
  }
}
