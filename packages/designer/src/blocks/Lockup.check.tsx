import type { LockupProps } from "./Lockup.js";

// The shell-only composition seam must never become a public Lockup prop.
const publicRootProp: "rootClassName" extends keyof LockupProps ? true : false = false;
void publicRootProp;
