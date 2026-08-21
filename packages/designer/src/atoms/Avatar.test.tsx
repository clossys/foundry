import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar.js";

describe("Avatar", () => {
  it("renders an <img> with the given alt text when src is provided", () => {
    render(<Avatar src="https://example.com/pic.png" alt="Ada Lovelace" />);
    const img = screen.getByRole("img", { name: "Ada Lovelace" });
    expect(img.tagName).toBe("IMG");
    expect(img).toHaveAttribute("src", "https://example.com/pic.png");
  });

  it("renders initials derived from alt when no src is given", () => {
    render(<Avatar alt="Ada Lovelace" />);
    const fallback = screen.getByRole("img", { name: "Ada Lovelace" });
    expect(fallback.tagName).not.toBe("IMG");
    expect(fallback).toHaveTextContent("AL");
  });

  it("derives a single initial from a one-word name", () => {
    render(<Avatar alt="Cher" />);
    expect(screen.getByRole("img", { name: "Cher" })).toHaveTextContent("C");
  });

  it("falls back to initials when the image fails to load", () => {
    render(<Avatar src="https://example.com/broken.png" alt="Ada Lovelace" />);
    const img = screen.getByRole("img", { name: "Ada Lovelace" }) as HTMLImageElement;
    fireEvent.error(img);
    const fallback = screen.getByRole("img", { name: "Ada Lovelace" });
    expect(fallback.tagName).not.toBe("IMG");
    expect(fallback).toHaveTextContent("AL");
  });

  it("forwards className, and the consumer's conflicting class wins the merge", () => {
    render(<Avatar alt="Ada Lovelace" className="rounded-default" />);
    const avatar = screen.getByRole("img", { name: "Ada Lovelace" });
    expect(avatar.className).toContain("rounded-default");
    expect(avatar.className).not.toContain("rounded-pill");
  });

  it("supports all three sizes without throwing and applies distinct classes", () => {
    const { rerender } = render(<Avatar alt="Ada Lovelace" size="sm" />);
    const smClass = screen.getByRole("img", { name: "Ada Lovelace" }).className;
    rerender(<Avatar alt="Ada Lovelace" size="md" />);
    const mdClass = screen.getByRole("img", { name: "Ada Lovelace" }).className;
    rerender(<Avatar alt="Ada Lovelace" size="lg" />);
    const lgClass = screen.getByRole("img", { name: "Ada Lovelace" }).className;
    expect(new Set([smClass, mdClass, lgClass]).size).toBe(3);
  });
});
