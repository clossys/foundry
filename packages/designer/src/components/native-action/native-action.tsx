import { type ComponentProps } from "react";
import { buttonVariants } from "./button-variants.js";
export function NativeAction({ className, ...props }: ComponentProps<"button">) {
 return <button {...props} className={buttonVariants({ variant: "default", size: "default", className })} />;
}
