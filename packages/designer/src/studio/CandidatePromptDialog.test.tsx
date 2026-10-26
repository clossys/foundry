import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../components/Button.js";
import { CandidatePromptDialog } from "./CandidatePromptDialog.js";
import { candidatePrompt, type CandidatePromptData } from "./candidate-prompt.js";
import { labels } from "./__fixtures__/studio.js";
import type { StudioCandidateWorkflow } from "./types.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const data: CandidatePromptData = { consumer: "sample", board: { id: "tokens/color", label: "Color" }, slot: { id: "tokens.surface-color", label: "Surface" }, variants: ["tokens.surface-color.base", "tokens.surface-color.raised"], tokens: [{ id: "tokens.space.base", value: "8px" }], siblings: [{ id: "tokens.text-color", source: "foundry" }], currentCandidate: { id: "custom-fill", source: "sample", variants: ["tokens.surface-color.base"] }, returnStep: "Return here and check new candidates." };
const open = async (workflow?: StudioCandidateWorkflow) => {
  const user = userEvent.setup();
  render(<CandidatePromptDialog trigger={<Button>Refresh custom</Button>} data={data} labels={labels} workflow={workflow} />);
  await user.click(screen.getByRole("button", { name: "Refresh custom" }));
  return user;
};
it("copies the exact refresh data prompt, includes real context and omits absent guidelines and routing", async () => {
  const user = await open(); const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const prompt = candidatePrompt(labels.board.promptInstruction, data);
  expect(screen.getByRole("dialog").querySelector("code")?.textContent).toBe(prompt);
  expect(prompt).toContain('"custom-fill"'); expect(prompt).toContain('"8px"'); expect(prompt).toContain(data.returnStep);
  expect(JSON.parse(prompt.slice(prompt.indexOf("\n\n") + 2))).not.toHaveProperty("guidelines"); expect(prompt).not.toContain("projectPath"); const localRoot = /\/[A-Z][a-z]+\//; expect("/Accounts/").toMatch(localRoot); expect(prompt).not.toMatch(localRoot);
  await user.click(screen.getByRole("button", { name: labels.board.copy }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith(prompt));
  expect(await screen.findByRole("status")).toHaveTextContent(labels.board.copied);
});
it("checks through the host callback and keeps results pending without an adoption control or stale success", async () => {
  const check = vi.fn<NonNullable<StudioCandidateWorkflow["checkCandidates"]>>().mockResolvedValueOnce({ status: "checked", candidates: [{ id: "new-fill", slot: data.slot.id, label: "New candidate", source: "sample", variants: data.variants }] }).mockRejectedValueOnce(new Error("offline"));
  const user = await open({ returnStep: data.returnStep, checkCandidates: check });
  await user.click(screen.getByRole("button", { name: labels.board.checkCandidates }));
  expect(check).toHaveBeenCalledWith(data.slot.id);
  expect(await screen.findByText(/New candidate/)).toBeVisible();
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent(labels.board.pendingSelection);
  await user.click(screen.getByRole("button", { name: labels.board.checkCandidates }));
  expect(await screen.findByRole("status")).toHaveTextContent(labels.board.candidatesFailed);
  expect(screen.queryByText(/New candidate/)).toBeNull();
});
it("reports an unavailable host check explicitly", async () => {
  const user = await open();
  await user.click(screen.getByRole("button", { name: labels.board.checkCandidates }));
  expect(await screen.findByRole("status")).toHaveTextContent(labels.board.candidatesUnavailable);
});
