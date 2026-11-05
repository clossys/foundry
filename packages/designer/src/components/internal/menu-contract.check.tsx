/** Compile-time Menu.Section naming contract; never imported by runtime entry points. */
import { Menu } from "../Menu.js";

const children = <Menu.Item>Help</Menu.Item>;

export const headingOnly = <Menu.Section heading="Account">{children}</Menu.Section>;
export const labelOnly = <Menu.Section aria-label="Account">{children}</Menu.Section>;
export const headingAndLabel = (
  <Menu.Section heading="Account" aria-label="Account">{children}</Menu.Section>
);

// @ts-expect-error a section needs a heading or an aria-label
export const unnamed = <Menu.Section>{children}</Menu.Section>;
