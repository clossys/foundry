"use client";

import { useId, useState, type MouseEvent } from "react";
import { Button } from "@clossys/designer/atoms";
import type { AccountMenuSection, AppNavigationNode } from "@clossys/designer/blocks";
import { AppFrame } from "./AppFrame.js";
import { APP_FRAME_SPECIMEN_COMMAND_IDS } from "./app-frame-layout.js";
import type { AppFrameProps } from "./app-frame-types.js";

const EXAMPLE_MARK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath fill='currentColor' d='M4 4h24v6H10v3h15v6H10v3h18v6H4z'/%3E%3C/svg%3E";
const PAGES = {
  overview: { title: "Overview", description: "A shared place to review projects, open tasks and recent activity." },
  projects: { title: "Projects", description: "Plan the next milestone and keep the work moving." },
  tasks: { title: "Tasks", description: "Review the next steps for the example project." },
  profile: { title: "Profile", description: "This example account is local to this specimen." },
  preferences: { title: "Preferences", description: "Choose how this example workspace presents your work." },
  "signed-out": { title: "Signed out", description: "The example account has been removed from this local demo. Use the guest account menu to return." },
} as const;
type Page = keyof typeof PAGES;
type PageCopy = Record<Page, { title: string; description: string }>;
type Activity = { kind: "initial" | "complete" | "reopen" } | { kind: "route"; page: Page };

export interface AppFrameSpecimenProps {
  /** Titles and descriptions for all six local destinations. @default The generic Example page copy declared in this module. */
  pages?: PageCopy;
  /** Visible brand wordmark. @default "Example" */
  wordmark?: string;
  /** Brand, account context and content eyebrow. Must contain wordmark. @default "Example workspace" */
  workspaceLabel?: string;
  /** Navigation accessible name. @default "Example navigation" */
  navigationLabel?: string;
  /** Local actor and profile heading. @default "Example member" */
  accountName?: string;
  /** Local actor supporting text. @default "Local demonstration account" */
  accountDescription?: string;
  /** Signed-out account trigger. @default "Guest account" */
  guestLabel?: string;
  /** Account destination section heading. @default "Account" */
  accountSectionLabel?: string;
  /** Local sign-out action. @default "Sign out" */
  signOutLabel?: string;
  /** Local account restoration action. @default "Use example account" */
  signInLabel?: string;
  /** Command opener. @default "Search Example commands" */
  commandTriggerLabel?: string;
  /** Command dialog heading. @default "Example commands" */
  commandHeading?: string;
  /** Command input accessible name. @default "Find a command" */
  commandSearchLabel?: string;
  /** Command close control. @default "Close commands" */
  commandCloseLabel?: string;
  /** Empty command results. @default "No matching commands. Try overview, projects or tasks." */
  commandEmptyMessage?: string;
  /** Command group heading. @default "Go to" */
  commandGroupLabel?: string;
  /** Overview command. @default "Open overview" */
  openOverviewLabel?: string;
  /** Projects command. @default "Open projects" */
  openProjectsLabel?: string;
  /** Tasks command. @default "Open tasks" */
  openTasksLabel?: string;
  /** Host command index. @default Generic Example destination links using the documented command labels. */
  commands?: AppFrameProps["commands"];
  /** Context pane accessible name. @default "Example context" */
  contextLabel?: string;
  /** Resize handle accessible name. @default "Resize example context" */
  resizeContextLabel?: string;
  /** Context pane heading. @default "Context" */
  contextHeading?: string;
  /** Prefix before the current destination title, including spacing. @default "Current destination: " */
  currentDestinationPrefix?: string;
  /** Context and activity text after completion. @default "Example task completed." */
  taskCompletedMessage?: string;
  /** Context text while the task is open. @default "One example task is ready for review." */
  taskReadyMessage?: string;
  /** Preferences content heading. @default "Workspace appearance" */
  preferencesHeading?: string;
  /** Work content heading. @default "Next milestone" */
  milestoneHeading?: string;
  /** Profile content description. @default "Account information is supplied by this host. Sign out in the account menu to see the guest state." */
  profileDescription?: string;
  /** Preferences content description. @default "The frame's theme control cycles through System, Light and Dark for the entire workspace. Your choice is saved in this browser." */
  preferencesDescription?: string;
  /** Work content description. @default "Review the project outline before the next planning session." */
  milestoneDescription?: string;
  /** Signed-out content detail. @default "No account information is supplied to the frame." */
  noAccountMessage?: string;
  /** Completion action. @default "Complete example task" */
  completeTaskLabel?: string;
  /** Reopen action. @default "Reopen example task" */
  reopenTaskLabel?: string;
  /** Initial activity message. @default "Example workspace opened." */
  initialActivityMessage?: string;
  /** Activity message after reopening the task. @default "Example task reopened." */
  taskReopenedMessage?: string;
  /** Separate route activity label. @default "opened" */
  routeOpenedLabel?: string;
}

/**
 * Interactive, product-neutral whole-frame catalog specimen.
 * Routing, account changes and task actions are explicit host-owned local state.
 * Mount directly: the AppFrame owns the only main landmark.
 */
export function AppFrameSpecimen({
  pages = PAGES, wordmark = "Example", workspaceLabel = "Example workspace", navigationLabel = "Example navigation",
  accountName = "Example member", accountDescription = "Local demonstration account", guestLabel = "Guest account",
  accountSectionLabel = "Account", signOutLabel = "Sign out", signInLabel = "Use example account",
  commandTriggerLabel = "Search Example commands", commandHeading = "Example commands", commandSearchLabel = "Find a command",
  commandCloseLabel = "Close commands", commandEmptyMessage = "No matching commands. Try overview, projects or tasks.",
  commandGroupLabel = "Go to", openOverviewLabel = "Open overview", openProjectsLabel = "Open projects", openTasksLabel = "Open tasks",
  commands = {
    triggerLabel: commandTriggerLabel, heading: commandHeading, searchLabel: commandSearchLabel,
    closeLabel: commandCloseLabel, emptyMessage: commandEmptyMessage,
    groups: [{ id: APP_FRAME_SPECIMEN_COMMAND_IDS.group, label: commandGroupLabel, items: [
      { id: APP_FRAME_SPECIMEN_COMMAND_IDS.overview, label: openOverviewLabel, href: "#example-overview" },
      { id: APP_FRAME_SPECIMEN_COMMAND_IDS.projects, label: openProjectsLabel, href: "#example-projects" },
      { id: APP_FRAME_SPECIMEN_COMMAND_IDS.tasks, label: openTasksLabel, href: "#example-tasks" },
    ] }],
  },
  contextLabel = "Example context", resizeContextLabel = "Resize example context", contextHeading = "Context",
  currentDestinationPrefix = "Current destination: ", taskCompletedMessage = "Example task completed.",
  taskReadyMessage = "One example task is ready for review.", preferencesHeading = "Workspace appearance", milestoneHeading = "Next milestone",
  profileDescription = "Account information is supplied by this host. Sign out in the account menu to see the guest state.",
  preferencesDescription = "The frame's theme control cycles through System, Light and Dark for the entire workspace. Your choice is saved in this browser.",
  milestoneDescription = "Review the project outline before the next planning session.", noAccountMessage = "No account information is supplied to the frame.",
  completeTaskLabel = "Complete example task", reopenTaskLabel = "Reopen example task", initialActivityMessage = "Example workspace opened.",
  taskReopenedMessage = "Example task reopened.", routeOpenedLabel = "opened",
}: AppFrameSpecimenProps = {}) {
  const workHeadingId = useId();
  const [page, setPage] = useState<Page>("overview");
  const [signedIn, setSignedIn] = useState(true);
  const [taskComplete, setTaskComplete] = useState(false);
  const [activity, setActivity] = useState<Activity>({ kind: "initial" });
  const destination = pages[page];
  const navigation: readonly AppNavigationNode[] = [
    { id: "overview", label: pages.overview.title, href: "#example-overview" },
    { id: "projects", label: pages.projects.title, href: "#example-projects", children: [
      { id: "tasks", label: pages.tasks.title, href: "#example-tasks" },
    ] },
  ];
  const route = (next: Page) => {
    setPage(next);
    setActivity({ kind: "route", page: next });
  };
  const onHostLink = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href?.startsWith("#example-") || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const next = href.slice("#example-".length);
    if (Object.hasOwn(PAGES, next)) {
      event.preventDefault();
      route(next as Page);
    }
  };
  const accountSections: readonly AccountMenuSection[] = signedIn ? [
    { id: "destinations", label: accountSectionLabel, entries: [
      { id: "profile", kind: "link", label: pages.profile.title, href: "#example-profile" },
      { id: "preferences", kind: "link", label: pages.preferences.title, href: "#example-preferences" },
    ] },
    { id: "session", entries: [{ id: "sign-out", kind: "destructive", label: signOutLabel, onAction: () => {
      setSignedIn(false);
      route("signed-out");
    } }] },
  ] : [{ id: "session", entries: [{ id: "sign-in", kind: "action", label: signInLabel, onAction: () => {
    setSignedIn(true);
    route("overview");
  } }] }];
  return <div onClickCapture={onHostLink}>
    <AppFrame
      brand={{ markSrc: EXAMPLE_MARK, wordmark, label: workspaceLabel, href: "#example-overview" }}
      navigation={{ tree: navigation, activeId: page, navigationKey: page, label: navigationLabel }}
      account={{
        ...(signedIn ? { actor: { name: accountName, secondaryText: accountDescription } } : {}),
        signedOutLabel: guestLabel, contextLabel: workspaceLabel, sections: accountSections,
        onRoute: entry => {
          if (entry.id === "profile" || entry.id === "preferences") route(entry.id);
        },
      }}
      commands={commands}
      theme={{ storageKey: "example-app-theme", defaultPreference: "system" }}
      rightPanel={{ label: contextLabel, handleLabel: resizeContextLabel, min: 220, max: 420, defaultValue: 280,
        children: <div className="flex flex-col gap-md p-md">
          <h2 className="m-0 text-body font-semibold">{contextHeading}</h2>
          <p className="m-0 text-body-s text-ink-secondary">{currentDestinationPrefix}{destination.title}</p>
          {taskComplete && <p className="m-0 text-body-s text-ink-secondary">{taskCompletedMessage}</p>}
          {!taskComplete && <p className="m-0 text-body-s text-ink-secondary">{taskReadyMessage}</p>}
        </div>,
      }}
    >
      <div className="flex min-w-0 flex-col gap-lg p-lg">
        <div className="flex flex-col gap-sm">
          <p className="m-0 text-caption text-ink-muted">{workspaceLabel}</p>
          <h1 className="m-0 text-display-s text-ink-primary">{destination.title}</h1>
          <p className="m-0 text-body text-ink-secondary">{destination.description}</p>
        </div>
        {page === "signed-out" ? <p className="m-0 text-body text-ink-secondary">{noAccountMessage}</p> :
          <section aria-labelledby={workHeadingId} className="flex flex-col gap-md rounded-control border border-line-base bg-surface-raised p-md">
            {page === "profile" && <>
              <h2 id={workHeadingId} className="m-0 text-body font-semibold">{accountName}</h2>
              <p className="m-0 text-body-s text-ink-secondary">{profileDescription}</p>
            </>}
            {page === "preferences" && <>
              <h2 id={workHeadingId} className="m-0 text-body font-semibold">{preferencesHeading}</h2>
              <p className="m-0 text-body-s text-ink-secondary">{preferencesDescription}</p>
            </>}
            {page !== "profile" && page !== "preferences" && <>
              <h2 id={workHeadingId} className="m-0 text-body font-semibold">{milestoneHeading}</h2>
              <p className="m-0 text-body-s text-ink-secondary">{milestoneDescription}</p>
            </>}
            {(page === "overview" || page === "projects" || page === "tasks") && <div>
              <Button variant="secondary" onPress={() => {
                setTaskComplete(previous => !previous);
                setActivity({ kind: taskComplete ? "reopen" : "complete" });
              }}>{taskComplete && <>{reopenTaskLabel}</>}{!taskComplete && <>{completeTaskLabel}</>}</Button>
            </div>}
          </section>}
        <p role="status" aria-live="polite" className="m-0 text-body-s text-ink-muted">
          {activity.kind === "initial" && <>{initialActivityMessage}</>}
          {activity.kind === "route" && <><span>{destination.title}</span>{" "}<span>{routeOpenedLabel}</span></>}
          {activity.kind === "complete" && <>{taskCompletedMessage}</>}
          {activity.kind === "reopen" && <>{taskReopenedMessage}</>}
        </p>
      </div>
    </AppFrame>
  </div>;
}
