import { createElement } from "react";
export const render = leaf => createElement("div", null, leaf);
export async function shoot({ html, width, height }) {
  if (!html.startsWith("<!doctype html>") || !html.includes("<div>") || width < 1 || height < 1) throw new Error("Invalid specimen document");
  return new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);
}
