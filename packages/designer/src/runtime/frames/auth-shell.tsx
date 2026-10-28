import { Children, type ReactNode } from "react";
import { AuthFrame } from "../../frames/AuthFrame.js";
import { runtimeValue, type SurfaceRendererEntry } from "../contract.js";
import { frameContent } from "./frame-content.js";

const LEAF = "frames.auth-shell";
const read = frameContent(LEAF);

export const authShellRenderer: SurfaceRendererEntry = {
  leaf: LEAF,
  sample: dataset => ({ "skip-link": dataset.frames.app.skipLabel }),
  render(input) {
    if (input.fill.leaf !== LEAF || input.selection.leaf !== LEAF) read.fail("renderer received a different leaf");
    read.only(input, ["skip-link"]);
    if (input.selection.members.length) read.fail("no configuration members are supported");
    for (const slot of Object.keys(input.slots)) if (slot !== "main") read.fail(`${slot} slot has no mapped prop`);
    const children = Children.toArray(input.slots.main);
    if (!children.length) read.fail("main slot is required");
    return <AuthFrame locale={input.locale} skipLabel={read.required(runtimeValue(input, "skip-link"), "skip-link")}>{children}</AuthFrame>;
  },
};
