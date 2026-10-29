import { type ComponentProps } from "react";
import { buttonVariants } from "./button-variants.js";
import { cx } from "../internal/cx.js";
type Props = Omit<ComponentProps<"button">, "type" | "role" | "dangerouslySetInnerHTML"> & { type: "button" | "submit" | "reset"; role?: never; dangerouslySetInnerHTML?: never };
export function NativeAction({ type, className, ...props }: Props) {
 if (type !== "button" && type !== "submit" && type !== "reset") throw new TypeError("NativeAction requires an explicit native button type");
 for (const name of ["role", "dangerouslySetInnerHTML", "as", "href", "onPress", "isDisabled", "isPending", "variant", "size", "ground", "render"]) if ((props as Record<string, unknown>)[name] !== undefined) throw new TypeError(`NativeAction does not accept ${name}`);
 if (typeof props.children === "function" || typeof className === "function" || typeof props.style === "function") throw new TypeError("NativeAction does not accept render functions");
 return <button {...props} type={type} className={cx(buttonVariants({ className }))} />;
}
