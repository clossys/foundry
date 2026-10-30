import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it } from "vitest";
import { SystemThumbnail } from "./SystemThumbnail.js";
import { thumbnailState } from "./thumbnail-index.js";
it("distinguishes missing, fresh and stale receipt digests", () => {
  const index = { version: 1 as const, libraryHash: "library", leaves: { "components.button": { fill: "hash", sha256: "image", width: 640, height: 400 } } };
  expect(thumbnailState(undefined, {}, "components.button")).toBe("missing");
  expect(thumbnailState(index, {}, "components.card")).toBe("missing");
  expect(thumbnailState(index, { "fills/components.button.json": "hash" }, "components.button")).toBe("fresh");
  expect(thumbnailState(index, { "fills/components.button.json": "new" }, "components.button")).toBe("stale");
});
it("shows Skeleton before load and on error, with a passive lazy image and stale Badge", () => {
  const view = render(<SystemThumbnail leaf="components.button" src="button.webp" state="stale" label="Button specimen" staleLabel="Stale" />);
  expect(screen.getByRole("status", { name: "Button specimen" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("status")).toHaveAttribute("data-slot", "skeleton");
  expect(screen.getByRole("status")).not.toHaveAttribute("shape");
  const image = screen.getByRole("img", { name: "Button specimen" });
  expect(image).toHaveAttribute("loading", "lazy"); expect(image).toHaveAttribute("decoding", "async");
  expect(screen.getByText("Stale")).toBeInTheDocument(); expect(screen.queryByRole("button")).toBeNull();
  fireEvent.load(image); expect(screen.queryByRole("status")).toBeNull();
  fireEvent.error(image); expect(screen.getByRole("status")).toBeInTheDocument();
  fireEvent.load(image); expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<SystemThumbnail leaf="components.button" src="new.webp" state="fresh" label="Button specimen" staleLabel="Stale" />);
  expect(screen.getByRole("status")).toBeInTheDocument(); expect(screen.queryByText("Stale")).toBeNull();
});
it("keeps a missing thumbnail as a Skeleton without a broken image", () => {
  render(<SystemThumbnail leaf="components.card" src="" state="missing" label="Card specimen" staleLabel="Stale" />);
  expect(screen.getByRole("status", { name: "Card specimen" })).toBeInTheDocument(); expect(screen.queryByRole("img")).toBeNull();
});
