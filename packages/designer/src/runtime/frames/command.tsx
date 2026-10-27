/**
 * frames.command runtime renderer: the real CommandMenu from JSON `search` (search,
 * heading, close and trigger labels), `groups` and `empty` content. Open and query state are
 * owned here behind the package trigger; item actions, icons and filtering come from the host.
 */
import { useState, type ReactNode } from "react";
import { CommandMenu } from "../../blocks/CommandMenu.js";
import type { CommandMenuProps } from "../../blocks/command-menu-types.js";
import { Button } from "../../components/Button.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { runtimeText, runtimeValue, type SurfaceRendererEntry } from "../contract.js";
import { frameContent, type FrameInput, type FrameJson } from "./frame-content.js";

const read = frameContent("frames.command");
type CommandContent = Omit<CommandMenuProps, "isOpen" | "onOpenChange" | "query" | "onQueryChange"> & { triggerLabel: string };

export function commandProps(input: Pick<FrameInput, "content" | "selection" | "host">): CommandContent {
  read.only(input, ["search", "groups", "empty"]);
  const host = input.host, search = read.record(runtimeValue(input, "search")) ?? read.fail("search content is required");
  const groups = read.commandGroups(read.records(runtimeValue(input, "groups")), host, "groups");
  if (!groups.length) read.fail("groups must list at least one group");
  return {
    searchLabel: read.required(search.label, "search.label"), heading: read.required(search.heading, "search.heading"),
    closeLabel: read.required(search.closeLabel, "search.closeLabel"), triggerLabel: read.required(search.triggerLabel, "search.triggerLabel"),
    emptyMessage: runtimeText(input, "empty") ?? read.fail("empty content is required"), groups,
    ...(host?.commandFilter ? { filter: (item: { id: string; label: string; description?: string }, query: string) => host.commandFilter!({ id: item.id, label: item.label, ...(item.description ? { description: item.description } : {}) }, query) } : {}),
  };
}

function RuntimeCommand({ triggerLabel, ...menu }: CommandContent) {
  const [isOpen, setOpen] = useState(false), [query, setQuery] = useState("");
  return <>
    <Button variant="secondary" onPress={() => setOpen(true)}>{triggerLabel}</Button>
    <CommandMenu {...menu} isOpen={isOpen} onOpenChange={setOpen} query={query} onQueryChange={setQuery} />
  </>;
}

export function renderCommand(input: RuntimeRenderInput<ReactNode>): ReactNode {
  return <RuntimeCommand {...commandProps(input)} />;
}

function sample(dataset: Parameters<SurfaceRendererEntry["sample"]>[0]): FrameJson {
  return {
    search: { label: "Find a command", heading: "Commands", closeLabel: "Close commands", triggerLabel: "Open command menu" },
    groups: [
      { id: "go", label: "Go to", items: dataset.navigation.items.map(item => ({ id: item.id, label: item.label, href: item.href })) },
      { id: "actions", label: dataset.menu.label, items: dataset.menu.items.map(item => ({ id: item.id, label: item.label, action: `order.${item.id}` })) },
    ],
    empty: "No matching commands.",
  };
}

export const commandRenderer: SurfaceRendererEntry = { leaf: "frames.command", render: renderCommand, sample };
