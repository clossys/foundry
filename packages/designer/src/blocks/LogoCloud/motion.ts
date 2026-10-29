import * as React from "react";
import animationFill from "../../catalog/fills/foundry/tokens.animation.json" with { type: "json" };

/** Start static on the server and whenever the preference cannot be read. */
export function useReducedProofMotion() {
  const [reduced, setReduced] = React.useState(true);
  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Motion timing comes from the selected animation token, with the Foundry fill as its default. */
export function proofAnimationTiming(node: Element, member: "marquee" | "count") {
  const value = getComputedStyle(node).getPropertyValue(`--animate-${member}`).trim() || animationFill.tokens.animation[member].$value;
  const time = /(?:^|\s)(\d+(?:\.\d+)?)(ms|s)(?:\s|$)/.exec(value);
  if (!time) throw new TypeError("Proof animation requires a duration token");
  return { duration: Number(time[1]) * (time[2] === "s" ? 1000 : 1), easing: /cubic-bezier\([^)]*\)|linear|ease(?:-in-out|-in|-out)?/.exec(value)?.[0] ?? "linear" };
}
