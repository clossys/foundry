import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Matrix } from "./Matrix.js";
import { matrixRows, matrixSources } from "./matrix-model.js";
import { emptyChanges } from "./model.js";
import { labels, smallCatalog, emptyLibrary } from "./__fixtures__/studio.js";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("uses accessible radios without promoting candidates by focus and keeps reference-less cells unavailable", async () => {
 const library=emptyLibrary(); const changes=emptyChanges(library); const rows=matrixRows({catalog:smallCatalog,library,working:library,changes,expanded:new Set()}); const onUse=vi.fn(), onFocusCell=vi.fn();
 render(<Matrix rows={rows} sources={matrixSources({catalog:smallCatalog,library})} working={library} changes={changes} labels={labels} groupChoices={{}} expanded={new Set()} onExpand={()=>{}} onUse={onUse} onFocusCell={onFocusCell}/>);
 const radio=screen.getByRole("radio",{name:labels.useSource("foundry","tokens.surface-color")}); radio.focus(); expect(onUse).not.toHaveBeenCalled(); expect(onFocusCell).toHaveBeenCalled(); await userEvent.setup().click(radio); expect(onUse.mock.calls[0]?.[1]).toBe("foundry");
 expect(screen.getByRole("radio",{name:labels.useSource("example","tokens.surface-color")})).toBeDisabled();
});

it("keeps every native choice and keyboard adoption without reading browser form validity on mount", async () => {
  const library = emptyLibrary();
  const changes = emptyChanges(library);
  const rows = matrixRows({ catalog: smallCatalog, library, working: library, changes, expanded: new Set() });
  const sources = matrixSources({ catalog: smallCatalog, library });
  const validity = vi.spyOn(HTMLInputElement.prototype, "validity", "get");
  const onUse = vi.fn();
  const view = render(<Matrix rows={rows} sources={sources} working={library} changes={changes} labels={labels}
    groupChoices={{}} expanded={new Set()} onExpand={() => {}} onUse={onUse} onFocusCell={() => {}} />);

  // Studio choices are immediate actions, not fields in a submitted form. Native
  // validity snapshots scan unrelated radio groups in the document on every commit.
  expect(validity).not.toHaveBeenCalled();
  // Pin this real fixture's candidate inventory, then check each row/source cell.
  // Evaluated missing candidates have no radio; reference-less candidates keep
  // their disabled native radio rather than becoming a fabricated choice.
  expect(rows.flatMap(row => row.candidates)).toHaveLength(24);
  expect(view.container.querySelectorAll('input[type="radio"]')).toHaveLength(24);
  let missing = 0, referenceLess = 0;
  for (const row of rows) {
    const group = within(screen.getByRole("radiogroup", { name: `${labels.useGroup} ${row.label}` }));
    expect(group.queryAllByRole("radio").map(radio => radio.getAttribute("aria-label"))).toEqual(
      row.candidates.map(candidate => labels.useSource(candidate.source, row.target)));
    for (const source of sources) {
      const candidate = row.candidates.find(candidate => candidate.source === source);
      const radio = group.queryByRole("radio", { name: labels.useSource(source, row.target) });
      if (!candidate) { missing++; expect(radio).toBeNull(); continue; }
      expect(radio).toBeInTheDocument();
      expect(radio).toHaveProperty("disabled", !candidate.usable);
      if (candidate.members.length === 0) { referenceLess++; expect(radio).toBeDisabled(); }
    }
  }
  expect(missing).toBeGreaterThan(0);
  expect(referenceLess).toBeGreaterThan(0);
  expect(view.container.querySelectorAll('[role="radiogroup"]')).toHaveLength(rows.length);
  const row = rows.find(row => row.scope === "slot" && row.candidates.some(candidate => candidate.usable))!;
  expect(row).toBeDefined();
  const group = within(screen.getByRole("radiogroup", { name: `${labels.useGroup} ${row.label}` }));
  const choices = sources.filter(source => row.candidates.some(candidate => candidate.source === source && candidate.usable));
  const first = group.getByRole("radio", { name: labels.useSource(choices[0]!, row.target) });
  await act(async () => first.focus());
  expect(onUse).not.toHaveBeenCalled();
  await userEvent.setup().keyboard(" ");
  expect(first).toHaveFocus();
  expect(onUse).toHaveBeenLastCalledWith(row, choices[0]);
  expect(group.getByRole("radio", { name: labels.useSource(library.source.id, row.target) })).toBeDisabled();
});
