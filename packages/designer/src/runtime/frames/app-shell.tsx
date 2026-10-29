/**
 * frames.app-shell runtime renderer. Renders the real AppFrame from the selected fill:
 * JSON content per host-node contract slot (skip-link, sidebar, command, inspector), the
 * selected layout/stage/theme members, the leased page header, and the host interaction
 * port for behaviour (guarded navigation, actions, icons, theme, panels, toasts).
 */
import { Children, type ReactNode } from "react";
import type { AccountMenuSection } from "../../blocks/account-menu-types.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { ProgressBar } from "../../selected-components/ProgressBar.js";
import { Skeleton } from "../../selected-components/Skeleton.js";
import { ErrorState } from "../../blocks/ErrorState.js";
import { appHeaderActions } from "./app-header.js";
import { AppFrame } from "../../frames/AppFrame.js";
import type { AppFrameProps } from "../../frames/app-frame-types.js";
import { PageHeaderModule } from "../../shell/FrameSlots.js";
import { runtimeMember, runtimeRecord, runtimeText, type SurfaceRendererEntry } from "../contract.js";
import { plainJson } from "../sections/dataset-json.js";
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
    }).filter(entry => entry.kind === "link" || (entry.kind === "preference" ? typeof host?.onAccountPreference === "function" : typeof host?.onAccountAction === "function"));
    return (section.kind === "preferences" ? { id, label: required(section.label, `account section ${id} label`), kind: "preferences", entries } : { id, ...(label ? { label } : {}), entries }) as AccountMenuSection;
  });
}
/** JSON content plus host port to AppFrame props; throws on content a fill cannot honour. */
export function appShellProps(input: Pick<RuntimeRenderInput<ReactNode>, "content" | "selection" | "slots" | "host" | "locale">): AppFrameProps {
  only(input, ["skip-link", "sidebar", "command", "inspector", "header", "page-module", "progress", "state"]);
  const host = input.host, sidebar = runtimeRecord(input, "sidebar"), command = runtimeRecord(input, "command"), inspector = runtimeRecord(input, "inspector");
  if (!sidebar) throw new TypeError("frames.app-shell: sidebar content is required");
  if (!command) throw new TypeError("frames.app-shell: command content is required");
  const brand = runtimeRecordOf(sidebar.brand), account = runtimeRecordOf(sidebar.account);
  if (!brand || !account) throw new TypeError("frames.app-shell: sidebar brand and account are required");
  const actor = runtimeRecordOf(account.actor), name = text(brand.name);
  const theme = runtimeMember(input, "theme", "system");
  const panel = input.slots.inspector?.length ? Children.toArray(input.slots.inspector) : host?.panels?.inspector;
  const moduleContent = runtimeRecord(input, "page-module");
  const pageModule = input.slots["page-module"]?.length ? Children.toArray(input.slots["page-module"]) : host?.panels?.["page-module"];
  const header = runtimeRecord(input, "header");
  const progressCopy = runtimeRecord(input, "progress");
  const stateCopy = runtimeRecord(input, "state");
  const stateViews: NonNullable<AppFrameProps["stateViews"]> = {};
  const state = host?.state;
  if (state && state.main !== "ready") {
    const copy = runtimeRecordOf(stateCopy?.[state.main]);
    if (!copy) throw new TypeError(`frames.app-shell: state.${state.main} copy is required`);
    const heading = required(copy.heading, `state.${state.main}.heading`);
    stateViews[state.main] = state.main === "loading"
      ? <Skeleton shape="block" aria-label={heading} />
      : <ErrorState kind={state.main === "error" ? "failure" : state.main} title={heading} description={text(copy.description)} code={text(copy.code)} />;
  }
  if (state?.navigating && !progressCopy) throw new TypeError("frames.app-shell: progress copy is required while navigating");
  return {
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    brand: { markSrc: required(brand.markSrc, "sidebar.brand.markSrc"), ...(brand.reversedMarkSrc === undefined ? {} : { reversedMarkSrc: required(brand.reversedMarkSrc, "sidebar.brand.reversedMarkSrc") }), ...(name ? { navigationMark: { label: name } } : {}) },
    navigation: { tree: navigationTree(records(sidebar.tree), host, "sidebar.tree"), ...(text(sidebar.label) ? { label: text(sidebar.label) } : {}), ...(text(sidebar.activeId) ? { activeId: text(sidebar.activeId) } : {}) },
    account: {
      ...(actor ? { actor: { name: required(actor.name, "account.actor.name"), ...(text(actor.secondaryText) ? { secondaryText: text(actor.secondaryText) } : {}) } } : {}),
      signedOutLabel: required(account.signedOutLabel, "account.signedOutLabel"), sections: accountSections(records(account.sections), host),
      ...(text(account.contextLabel) ? { contextLabel: text(account.contextLabel) } : {}), ...(text(account.triggerLabel) ? { triggerLabel: text(account.triggerLabel) } : {}),
      ...(account.avatar === "mark" || account.avatar === "initials" ? { avatar: account.avatar } : {}),
    },
    ...(state ? { state, stateViews } : {}),
    ...(progressCopy ? { progress: <ProgressBar label={null} aria-label={required(progressCopy.label, "progress.label")} isIndeterminate style={{ gap: 0 }} /> } : {}),
    ...(pageModule !== undefined ? { pageModule, pageModuleLabel: required(moduleContent?.label, "page-module.label") } : {}),
    ...(header ? { page: { title: required(header.title, "header.title") }, headerTrail: records(header.trail).map(row => ({ id: required(row.id, "header.trail.id"), label: required(row.label, "header.trail.label"), ...(text(row.href) ? { href: text(row.href)! } : {}) })), ...(header.actions !== undefined ? { headerActions: appHeaderActions(records(header.actions), host) } : {}) } : {}),
    commands: {
      onQueryChange: host?.onCommandQueryChange,
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
  const app = dataset.frames.app, { triggerLabel, heading, searchLabel, closeLabel, emptyMessage, groups } = app.commands;
  return {
    "skip-link": app.skipLabel,
    sidebar: {
      label: app.navigationLabel, brand: { markSrc: app.markSrc, name: app.workspace }, activeId: app.activeId, tree: plainJson(app.navigation),
      account: { actor: plainJson(app.actor), signedOutLabel: app.signedOutLabel, sections: [{ id: app.accountSectionId, label: app.accountSection, entries: plainJson([...app.accountEntries, app.signOut]) }] },
    },
    command: { triggerLabel, heading, searchLabel, closeLabel, emptyMessage, groups: plainJson(groups),
      // Specimen content draws on Studio boards, which own the keyboard: the global shortcut stays off here.
      shortcutEnabled: false },
  };
}

export const appShellRenderer: SurfaceRendererEntry = { leaf: "frames.app-shell", render: renderAppShell, sample };
