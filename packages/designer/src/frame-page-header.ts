import type { ReactNode } from "react";
export interface FramePageHeaderDestination { id: string; label: string; href: string }
export interface FramePageHeaderNav { label: string; items: readonly FramePageHeaderDestination[]; activeId: string }
export interface FramePageHeaderActions { render: (options: { compact: boolean }) => ReactNode }
export interface FramePageHeader { title: string; nav?: FramePageHeaderNav; actions?: FramePageHeaderActions }
