import type { ReactNode } from "react";
import { ShadcnAppShell } from "../../frames/shadcn-aria/AppShell.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { appShellProps, appShellRenderer } from "./app-shell.js";
import { PageHeaderModule } from "../../shell/FrameSlots.js";

/** The alternate candidate consumes exactly the existing checked JSON/frame host ports. */
export function renderShadcnAppShell(input: RuntimeRenderInput<ReactNode>): ReactNode {
  const props = appShellProps(input), header = input.pageHeader;
  return <ShadcnAppShell {...props}>{header && <PageHeaderModule id={header.id} header={{ ...header.data, ...(header.actions ? { actions: { render: header.actions.render } } : {}) }} />}{props.children}</ShadcnAppShell>;
}

export const shadcnAppShellRenderer = { ...appShellRenderer, render: renderShadcnAppShell };
