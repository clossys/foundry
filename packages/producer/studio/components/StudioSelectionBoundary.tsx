'use client';

import { Component, type ReactNode } from 'react';

/** An unusable selected implementation stays an explicit NEED instead of silently changing fill. */
export class StudioSelectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { document.documentElement.dataset.studioState = 'selection-unavailable'; }
  render() {
    return this.state.failed ? <>NEED: Designer selected implementation could not render. Repair the active Designer fill.</> : this.props.children;
  }
}
