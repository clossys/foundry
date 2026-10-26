import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar as ClientAvatar } from "./Avatar.js";
import { Avatar, avatarInitials } from "./Avatar.server.js";

describe("Avatar (server)", () => {
  it("renders an <img> carrying the name when src is given", () => {
    render(<Avatar src="https://example.com/pic.png" alt="Ada Lovelace" />);
    const img = screen.getByRole("img", { name: "Ada Lovelace" });
    expect(img.tagName).toBe("IMG");
  });

  it("renders initials with role='img' and the name as its label when src is omitted", () => {
    render(<Avatar alt="Ada Lovelace" size="sm" />);
    const fallback = screen.getByRole("img", { name: "Ada Lovelace" });
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback).toHaveTextContent("AL");
    expect(fallback.className).toContain("h-6");
  });

  it("produces the same markup as the client Avatar for the same props", () => {
    for (const props of [{ alt: "Grace Hopper" }, { alt: "Grace Hopper", src: "https://example.com/g.png", size: "lg" as const }]) {
      expect(renderToStaticMarkup(<Avatar {...props} />)).toBe(renderToStaticMarkup(<ClientAvatar {...props} />));
    }
  });

  it("derives initials from the first and last word only", () => {
    expect(avatarInitials("ada king lovelace")).toBe("AL");
    expect(avatarInitials("  Ada ")).toBe("A");
    expect(avatarInitials("")).toBe("");
  });
});
