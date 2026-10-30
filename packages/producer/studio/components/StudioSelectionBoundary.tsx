'use client';

import { Component, type ReactNode } from 'react';

/** An unusable selected implementation stays an explicit NEED instead of silently changing fill. */
export class StudioSelectionBoundary extends Component<{ children: ReactNode }, { message?: string }> {
  state: { message?: string } = {};
  static getDerivedStateFromError(error: unknown) { return { message: error instanceof Error ? error.message : String(error) }; }
  componentDidCatch(error: unknown) {
    document.documentElement.dataset.studioState = 'selection-unavailable';
    console.error('Studio Designer selection render failed:', error instanceof Error ? error.message : String(error));
  }
  render() {
    return this.state.message !== undefined ? <>NEED: Designer selected implementation could not render. {this.state.message}</> : this.props.children;
  }
}
