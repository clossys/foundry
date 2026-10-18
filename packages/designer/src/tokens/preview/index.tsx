import { version, type CSSProperties, type ReactNode } from "react";
import { TOKENS } from "../tokens.js";
import { TOKEN_GUIDANCE } from "../guidance.js";
import { assertPeerVersion } from "../../internal/peer-version.js";
import { REACT_DECLARED_RANGE } from "../../internal/declared-peer-ranges.js";

assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: version });

// Keep the live cascade first; use only this exact property's authored CSS as fallback.
function tokenReference(property: string): string {
  return `var(${property}, ${TOKENS[property]!.value})`;
}

// These are authored application signatures, never display-family heuristics.
const applications: Record<string, readonly string[]> = {
  surface: ["surface|background-color|color"],
  text: ["text|color|color", "text|font-size|length", "text|letter-spacing|length", "text|line-height|number"],
  border: ["border|border-color|color", "border|border-width|length"],
  control: ["control|background-color|color", "control|color|color"],
  status: ["status|background-color|color", "status|color|color"],
  chart: ["chart|fill|color", "chart|stroke|color"],
  font: ["font|font-family|font-family", "font|font-style|font-style", "font|font-weight|font-weight", "font|font-stretch|font-stretch", "font|transform|number"],
  space: ["space|gap|length", "space|padding|length", "space|padding-inline|length"],
  size: ["size|inline-size|length", "size|max-inline-size|length", "size|min-inline-size|length", "size|min-block-size|length"],
  icon: ["icon|inline-size|length", "icon|stroke-width|number"],
  brandmark: ["brandmark|block-size|length", "brandmark|gap|length"],
  radius: ["radius|border-radius|length"],
  shadow: ["shadow|box-shadow|shadow"],
  blur: ["blur|backdrop-filter|length"],
  ring: ["ring|box-shadow|shadow"],
  layer: ["layer|z-index|number"],
  opacity: ["opacity|opacity|number"],
};
const pending: Record<string, readonly string[]> = {
  motion: ["motion|transition-duration|duration", "motion|transition-timing-function|easing"],
  breakpoint: ["breakpoint|@media (min-width)|length"],
};
const inverse = new Set([
  "--color-ink-on-inverse", "--color-ink-on-inverse-muted", "--color-line-on-inverse",
  "--color-accent-on-inverse", "--color-control-tonal-inverse", "--color-control-tonal-inverse-hover",
  "--color-surface-glass-inverse", "--ui-ring-on-inverse",
]);
const translucent = new Set([
  "--color-surface-glass", "--color-surface-glass-inverse", "--color-accent-tint",
  "--color-control-tonal", "--color-control-tonal-hover", "--color-control-tonal-inverse", "--color-control-tonal-inverse-hover",
  "--color-status-success-tint", "--color-status-warning-tint", "--color-status-danger-tint", "--color-status-info-tint",
  "--color-line-on-inverse", "--color-overlay-scrim", "--ui-alpha-disabled",
]);
const checker = `repeating-conic-gradient(${tokenReference("--color-surface-base")} 0% 25%, ${tokenReference("--color-surface-inverse")} 0% 50%)`;
const panel: CSSProperties = { padding: 16, minBlockSize: 48, background: tokenReference("--color-surface-raised"), color: tokenReference("--color-ink-primary") };
const tile: CSSProperties = { inlineSize: 24, blockSize: 24, background: tokenReference("--color-accent") };

/** Static token tooling: the host supplies token/theme/brand CSS and preview cascade. */
export function TokenPreview({ property }: { property: string }) {
  const guidance = Object.hasOwn(TOKENS, property) && Object.hasOwn(TOKEN_GUIDANCE, property)
    ? TOKEN_GUIDANCE[property] : undefined;
  const kind = guidance?.specimen;
  const application = guidance?.application;
  const signature = `${kind}|${application?.cssProperty}|${application?.valueType}`;
  const supported = kind && Object.hasOwn(applications, kind) && applications[kind]?.includes(signature);
  const unavailable = kind && Object.hasOwn(pending, kind) && pending[kind]?.includes(signature);
  if (!kind || !application || !(supported || unavailable)) {
    return <output role="status" data-property={property} data-kind={kind}>Unsupported token application</output>;
  }
  if (unavailable) {
    return <output role="status" data-property={property} data-kind={kind}>{kind}: interactive support pending</output>;
  }
  const value = tokenReference(property);
  const cssProperty = application.cssProperty.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const style: CSSProperties = { [cssProperty]: value };
  if (application.cssProperty === "transform") style.transform = `scaleX(${value})`;
  if (application.cssProperty === "backdrop-filter") style.backdropFilter = `blur(${value})`;
  const backing = inverse.has(property) ? tokenReference("--color-surface-inverse")
    : property === "--color-ink-on-accent" ? tokenReference("--color-accent") : tokenReference("--color-surface-base");
  const foreground = inverse.has(property) || ["--color-surface-inverse", "--color-surface-inverse-raised"].includes(property)
    ? tokenReference("--color-ink-on-inverse") : tokenReference("--color-ink-primary");
  const plate: CSSProperties = {
    ...panel, color: foreground,
    background: inverse.has(property) ? tokenReference("--color-surface-inverse") : panel.background,
  };
  const icon = (
    <svg viewBox="0 0 24 24" style={{ inlineSize: 32, blockSize: 32, fill: "none", stroke: tokenReference("--color-ink-primary"), ...style }}>
      <path d="M4 12h16M12 4v16" />
    </svg>
  );
  const specimens: Record<string, ReactNode> = {
    surface: <div style={{ ...plate, ...style }}>Surface</div>,
    text: <p style={style}>Readable type specimen Aa 0123</p>,
    border: <div style={{ ...plate, border: `2px solid ${tokenReference("--color-line-strong")}`, ...style }}>Boundary</div>,
    control: <button type="button" style={{ ...plate, ...style }}>Control</button>,
    status: <span style={{ ...plate, ...style }}>Status indicator</span>,
    chart: <svg viewBox="0 0 120 60" style={{ inlineSize: 160, blockSize: 80 }}>
      {property === "--color-chart-axis-label" ? <text x="8" y="36" style={style}>Axis label</text> :
        <rect x="8" y="8" width="104" height="44" fill="none" strokeWidth="4" style={style} />}
    </svg>,
    font: <p style={{ transformOrigin: "left", ...style }}>Font specimen Aa 0123</p>,
    space: <div style={{ display: "flex", ...style }}><span style={tile} /><span style={tile} /></div>,
    size: <div style={{ ...plate, ...style }}>Sized region</div>,
    icon,
    brandmark: (
      <div style={{ display: "flex", alignItems: "center", ...style }}>
        <svg viewBox="0 0 24 24" style={{ blockSize: application.cssProperty === "gap" ? 24 : "100%", inlineSize: "auto", aspectRatio: "1", minBlockSize: 16 }}>
          <path fill="currentColor" d="M2 22L12 2l10 20z" />
        </svg>
        <span>Brand</span>
      </div>
    ),
    radius: <div style={{ ...plate, ...style }}>Rounded panel</div>,
    shadow: <div style={{ ...plate, ...style }}>Elevated panel</div>,
    blur: (
      <div style={{ background: `repeating-linear-gradient(45deg, ${tokenReference("--color-accent")} 0 8px, ${tokenReference("--color-surface-base")} 8px 16px)` }}>
        <div style={{ ...plate, background: tokenReference("--color-surface-glass"), ...style }}>Backdrop</div>
      </div>
    ),
    ring: <div style={{ ...plate, ...style }}>Focus outline</div>,
    layer: (
      <div style={{ position: "relative", isolation: "isolate", blockSize: 90 }}>
        <div style={{ ...plate, position: "absolute", inset: 0, zIndex: 1 }}>Reference layer 1</div>
        <div style={{ ...plate, position: "absolute", inset: 12, ...style }}>Token layer</div>
      </div>
    ),
    opacity: <div style={{ ...plate, ...style }}>Object opacity</div>,
  };
  return (
    <figure aria-label={property} data-kind={kind} style={{
      margin: 0, padding: 16, overflow: "auto", background: backing,
      backgroundImage: translucent.has(property) ? checker : undefined, backgroundSize: 16,
    }}>
      {specimens[kind]}
    </figure>
  );
}
