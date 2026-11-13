import { existsSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as components from "./index.js";
import * as server from "./server.js";
import * as root from "../index.js";
import { Alert, AlertAction } from "./preview-runtime/components/banner/alert.js";
import { Avatar } from "./preview-runtime/components/avatar/avatar.js";
import { Badge } from "./preview-runtime/components/badge/badge.js";
import { Card } from "./preview-runtime/components/card/card.js";
import { Skeleton } from "./preview-runtime/components/skeleton/skeleton.js";
import { ALERT_TONE, BADGE_TONE, CARD_SURFACE, SKELETON_SHAPE } from "./surface-tones.js";

// R2F-29 D2 surface: card, badge, skeleton, avatar and banner are the stock shadcn@aria leaves.
describe("surface leaf sources", () => {
  it("exports the stock Card, Badge, Skeleton, Avatar and Alert from every barrel and no Foundry Banner", () => {
    for (const barrel of [components, server, root]) {
      expect([barrel.Card, barrel.Badge, barrel.Skeleton, barrel.Alert, barrel.AlertAction]).toEqual([Card, Badge, Skeleton, Alert, AlertAction]);
      expect("Banner" in barrel).toBe(false);
    }
    for (const barrel of [components, root]) expect(barrel.Avatar).toBe(Avatar);
    // The stock avatar module holds AvatarImage's load-state hook, so it stays out of the server-safe barrel.
    expect("Avatar" in server).toBe(false);
  });

  it("leaves no Foundry surface module behind", () => {
    for (const file of ["./Card.tsx", "./Badge.tsx", "./Skeleton.tsx", "./Avatar.tsx", "./Avatar.server.tsx", "./Banner.tsx", "./Banner.server.tsx"]) {
      expect(existsSync(new URL(file, import.meta.url)), file).toBe(false);
    }
  });
});

describe("surface caller data", () => {
  it("maps a badge tone to a stock variant, with a status token class where stock has none", () => {
    render(<>{(["neutral", "danger", "success"] as const).map(tone => <Badge key={tone} {...BADGE_TONE[tone]}>{tone}</Badge>)}</>);
    expect(screen.getByText("neutral")).toHaveAttribute("data-variant", "secondary");
    expect(screen.getByText("danger")).toHaveAttribute("data-variant", "destructive");
    expect(screen.getByText("success")).toHaveAttribute("data-variant", "outline");
    expect(screen.getByText("success")).toHaveClass("bg-status-success-tint", "text-status-success-text");
  });

  it("gives danger alerts an assertive alert role and every other tone a polite status", () => {
    render(<><Alert {...ALERT_TONE.danger}>Failed</Alert><Alert {...ALERT_TONE.info}>Saved</Alert></>);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("keeps raised as the stock card and draws outline and plate as token classes on it", () => {
    expect(CARD_SURFACE.raised).toBeUndefined();
    render(<><Card data-testid="outline" className={CARD_SURFACE.outline} /><Card data-testid="plate" className={CARD_SURFACE.plate} /></>);
    expect(screen.getByTestId("outline")).toHaveClass("border", "border-line-panel", "ring-0");
    expect(screen.getByTestId("plate")).toHaveClass("bg-surface-sunken", "ring-0");
  });

  it("sizes the stock skeleton from its shape", () => {
    render(<Skeleton role="status" aria-label="Loading" className={SKELETON_SHAPE.block} />);
    expect(screen.getByRole("status", { name: "Loading" })).toHaveClass("h-full", "w-full");
  });
});
