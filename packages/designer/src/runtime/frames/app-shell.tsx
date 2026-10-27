/**
 * frames.app-shell runtime renderer. Renders the real AppFrame from the selected fill:
 * JSON content per host-node contract slot (skip-link, sidebar, command, inspector), the
 * selected layout/stage/theme members, the leased page header, and the host interaction
 * port for behaviour (guarded navigation, actions, icons, theme, panels, toasts).
 */
import { Children, type ReactNode } from "react";
import type { AccountMenuSection } from "../../blocks/account-menu-types.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { AppFrame } from "../../frames/AppFrame.js";
import type { AppFrameProps } from "../../frames/app-frame-types.js";
import { PageHeaderModule } from "../../shell/FrameSlots.js";
import { runtimeMember, runtimeRecord, runtimeText, type SurfaceRendererEntry } from "../contract.js";
import { frameContent, guardedNavigate, type FrameHost as Host, type FrameJson as Json } from "./frame-content.js";

export { guardedNavigate } from "./frame-content.js";
const { text, required, record: runtimeRecordOf, records, number, only, navigationTree, commandGroups } = frameContent("frames.app-shell");

function accountSections(rows: readonly Json[], host: Host): AccountMenuSection[] {
  return rows.map((section, index) => {
    const id = required(section.id, `account.sections[${index}].id`), label = text(section.label);
    const entries = records(section.entries).map((entry, at) => {
      const entryId = required(entry.id, `account.sections[${index}].entries[${at}].id`), entryLabel = required(entry.label, `account.sections[${index}].entries[${at}].label`);
      const common = { id: entryId, label: entryLabel, ...(entry.isDisabled === true ? { isDisabled: true } : {}) };
      if (entry.kind === "link") return { ...common, kind: "link" as const, href: required(entry.href, `account entry ${entryId} href`) };
      if (entry.kind === "preference") return { ...common, kind: "preference" as const, checked: entry.checked === true, onCheckedChange: (checked: boolean) => host?.onAccountPreference?.(entryId, checked) };
      if (entry.kind === "action" || entry.kind === "destructive") return { ...common, kind: entry.kind, onAction: () => host?.onAccountAction?.(entryId) };
      throw new TypeError(`frames.app-shell: account entry ${entryId} has an unknown kind`);
    });
    return (section.kind === "preferences" ? { id, label: required(section.label, `account section ${id} label`), kind: "preferences", entries } : { id, ...(label ? { label } : {}), entries }) as AccountMenuSection;
  });
}
/** JSON content plus host port to AppFrame props; throws on content a fill cannot honour. */
export function appShellProps(input: Pick<RuntimeRenderInput<ReactNode>, "content" | "selection" | "slots" | "host">): AppFrameProps {
  only(input, ["skip-link", "sidebar", "command", "inspector"]);
  const host = input.host, sidebar = runtimeRecord(input, "sidebar"), command = runtimeRecord(input, "command"), inspector = runtimeRecord(input, "inspector");
  if (!sidebar) throw new TypeError("frames.app-shell: sidebar content is required");
  if (!command) throw new TypeError("frames.app-shell: command content is required");
  const brand = runtimeRecordOf(sidebar.brand), account = runtimeRecordOf(sidebar.account);
  if (!brand || !account) throw new TypeError("frames.app-shell: sidebar brand and account are required");
  const actor = runtimeRecordOf(account.actor), name = text(brand.name);
  const theme = runtimeMember(input, "theme", "system");
  const panel = host?.panels?.inspector;
  return {
    brand: { markSrc: required(brand.markSrc, "sidebar.brand.markSrc"), ...(name ? { navigationMark: { label: name } } : {}) },
    navigation: { tree: navigationTree(records(sidebar.tree), host, "sidebar.tree"), ...(text(sidebar.label) ? { label: text(sidebar.label) } : {}), ...(text(sidebar.activeId) ? { activeId: text(sidebar.activeId) } : {}) },
    account: {
      ...(actor ? { actor: { name: required(actor.name, "account.actor.name"), ...(text(actor.secondaryText) ? { secondaryText: text(actor.secondaryText) } : {}) } } : {}),
      signedOutLabel: required(account.signedOutLabel, "account.signedOutLabel"), sections: accountSections(records(account.sections), host),
      ...(text(account.contextLabel) ? { contextLabel: text(account.contextLabel) } : {}), ...(text(account.triggerLabel) ? { triggerLabel: text(account.triggerLabel) } : {}),
      ...(account.avatar === "mark" || account.avatar === "initials" ? { avatar: account.avatar } : {}),
    },
    commands: {
      triggerLabel: required(command.triggerLabel, "command.triggerLabel"), heading: required(command.heading, "command.heading"), searchLabel: required(command.searchLabel, "command.searchLabel"),
      closeLabel: required(command.closeLabel, "command.closeLabel"), emptyMessage: required(command.emptyMessage, "command.emptyMessage"), groups: commandGroups(records(command.groups), host, "command.groups"),
      ...(command.shortcutEnabled === false ? { shortcutEnabled: false } : {}),
      ...(host?.commandFilter ? { filter: (item: { id: string; label: string; description?: string }, query: string) => host.commandFilter!({ id: item.id, label: item.label, ...(item.description ? { description: item.description } : {}) }, query) } : {}),
    },
    ...(sidebar.footerLayout === "stacked" || sidebar.footerLayout === "inline" ? { footerLayout: sidebar.footerLayout } : {}),
    layout: runtimeMember(input, "layout", "standard"),
    stage: runtimeMember(input, "stage", "contained"),
    theme: { defaultPreference: theme, ...(host?.theme ?? {}) },
    ...(host && "themeControl" in host ? { themeControl: host.themeControl } : {}),
    ...(runtimeText(input, "skip-link") ? { skipLabel: runtimeText(input, "skip-link") } : {}),
    ...(host?.panels?.header !== undefined ? { context: host.panels.header } : {}),
    ...(inspector && panel !== undefined ? { rightPanel: {
      children: panel, label: required(inspector.label, "inspector.label"), handleLabel: required(inspector.handleLabel, "inspector.handleLabel"),
      min: number(inspector.min, "inspector.min"), max: number(inspector.max, "inspector.max"), defaultValue: number(inspector.defaultValue, "inspector.defaultValue"),
      ...(typeof inspector.step === "number" ? { step: inspector.step } : {}), ...(inspector.defaultCollapsed === true ? { defaultCollapsed: true } : {}),
      ...(text(inspector.openLabel) ? { openLabel: text(inspector.openLabel) } : {}), ...(text(inspector.closeLabel) ? { closeLabel: text(inspector.closeLabel) } : {}),
    } } : {}),
    ...(host?.toasts !== undefined ? { toasts: host.toasts } : {}),
    ...(host?.notices ? { notices: host.notices.map(notice => ({ ...notice, action: notice.action && { ...notice.action } })) } : {}),
    onNavigate: guardedNavigate(host),
    children: Children.toArray(input.slots.main),
  } as AppFrameProps;
}

export function renderAppShell(input: RuntimeRenderInput<ReactNode>): ReactNode {
  const props = appShellProps(input), header = input.pageHeader;
  // The leased page header is the only header source: PageHeaderModule registers it with this frame.
  const lease = header && <PageHeaderModule id={header.id} header={{ ...header.data, ...(header.actions ? { actions: { render: header.actions.render } } : {}) }} />;
  return <AppFrame {...props}>{lease}{props.children}</AppFrame>;
}

/** Designer preview content for this leaf, from the shared synthetic dataset. */
function sample(dataset: Parameters<SurfaceRendererEntry["sample"]>[0]): Json {
  const person = dataset.people[0];
  return {
    "skip-link": "Skip to content",
    sidebar: {
      label: dataset.navigation.label, brand: { markSrc: dataset.assets.mark.src, name: dataset.assets.mark.name }, activeId: dataset.navigation.items[0].id,
      tree: dataset.navigation.items.map(item => ({ id: item.id, label: item.label, href: item.href })),
      account: { actor: { name: person.name }, signedOutLabel: "Sign in", sections: [{ id: "account", entries: [{ id: "profile", kind: "link", label: "Profile", href: "#profile" }, { id: "sign-out", kind: "action", label: "Sign out" }] }] },
    },
    command: { triggerLabel: "Search commands", heading: "Commands", searchLabel: "Search commands", closeLabel: "Close", emptyMessage: "No matching commands", groups: [{ id: "pages", label: "Pages", items: dataset.navigation.items.map(item => ({ id: item.id, label: item.label, href: item.href })) }],
      // Specimen content draws on Studio boards, which own the keyboard: the global shortcut stays off here.
      shortcutEnabled: false },
  };
}

export const appShellRenderer: SurfaceRendererEntry = { leaf: "frames.app-shell", render: renderAppShell, sample };
