import { isValidElement } from "react";
import { Icon } from "@clossys/designer/components/server";
import type { AppFrameProps } from "@clossys/designer/frames";
import { SHELL_COPY_REFS } from "@clossys/designer/frames";
import type { CopyRef, CopyResolver } from "@clossys/writer";

/** These are identifiers, destinations and Designer configuration, never audience copy. */
const structural = new Set(["id", "href", "src", "markSrc", "activeId", "icon", "kind", "action", "variant", "size", "layout", "stage", "fill", "dir", "locale", "avatar", "headerPosition", "headerSurface", "footerLayout", "storageKey", "preference", "defaultPreference", "mainId"]);
const geometry = new Set(["min", "max", "defaultValue", "step", "width", "height", "order", "columns", "rows", "span", "rank"]);

export class ContentCopyBindingError extends TypeError {
  constructor(readonly path: string, readonly rule: string) { super(`${path}: ${rule}`); }
}

/** Resolve host data, preserving identifiers and callbacks; no page-local nodes, styles or copy. */
export function bindContentCopy(value: unknown, locale: string, resolver: CopyResolver | undefined, path = "appFrame", key = ""): unknown {
  const fail = (rule: string): never => { throw new ContentCopyBindingError(path, rule); };
  if (isValidElement<{ decorative?: boolean; children?: unknown }>(value) && key === "icon" && value.type === Icon
    && value.props.decorative === true && value.props.children === undefined) return value;
  if (key === "className" || key === "style" || key === "children" || isValidElement(value)) return fail("designer-owned-layout");
  if (value === undefined || value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && geometry.has(key) ? value : fail("copy-ref-required");
  if (typeof value === "function") return /^on[A-Z]/.test(key) ? value : fail("host-callback");
  if (typeof value === "string") return structural.has(key) ? value : fail("copy-ref-required");
  if (Array.isArray(value)) return value.map((item, index) => bindContentCopy(item, locale, resolver, `${path}.${index}`, key));
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return fail("copy-binding-object");
  const row = value as Record<string, unknown>;
  if (typeof row.id === "string" && Object.keys(row).every(name => ["id", "locale", "values"].includes(name))) {
    if (!resolver) return fail("copy-resolver-required");
    if (row.locale !== undefined && row.locale !== locale) return fail("copy-binding-locale");
    const ref = { ...row, locale } as unknown as CopyRef;
    const result = resolver(ref);
    if (!result || result.ref.id !== ref.id || typeof result.text !== "string" || !result.text.trim()
      || (result.servedLocale ?? result.locale) !== locale) return fail("unresolved-native-copy");
    return result.text;
  }
  return Object.fromEntries(Object.entries(row).map(([name, item]) => [name, bindContentCopy(item, locale, resolver, `${path}.${name}`, name)]));
}

/** AppFrame's optional English defaults must never fill an authored shell's missing words. */
export function bindContentAppFrame(value: Readonly<Record<string, unknown>>, locale: string, resolver?: CopyResolver): Omit<AppFrameProps, "children"> {
  const frame = SHELL_COPY_REFS.frame;
  const input = { skipLabel: frame.skip, breadcrumbLabel: frame.breadcrumb, collapsedBreadcrumbLabel: frame.collapsedBreadcrumb,
    pageInfoLabel: frame.pageInfo, pageActionsLabel: frame.pageActions, ...value,
    navigation: { label: SHELL_COPY_REFS.navigation.label, emptyMessage: SHELL_COPY_REFS.navigation.empty,
      openLabel: frame.navigationOpen, closeLabel: frame.navigationClose, ...(value.navigation as object) } };
  const props = bindContentCopy(input, locale, resolver) as unknown as Omit<AppFrameProps, "children">;
  const labels = [props.skipLabel, props.navigation?.label, props.navigation?.openLabel, props.navigation?.closeLabel,
    props.navigation?.emptyMessage, props.account?.signedOutLabel, props.commands?.triggerLabel, props.commands?.heading,
    props.commands?.searchLabel, props.commands?.closeLabel, props.commands?.emptyMessage,
    props.breadcrumbLabel, props.collapsedBreadcrumbLabel, props.pageInfoLabel, props.pageActionsLabel];
  if (!props.brand?.markSrc || !Array.isArray(props.navigation?.tree) || !Array.isArray(props.account?.sections)
    || !Array.isArray(props.commands?.groups) || labels.some(label => typeof label !== "string" || !label.trim())) {
    throw new ContentCopyBindingError("appFrame", "complete-app-shell-copy-required");
  }
  if (props.themeControl !== null && (!props.theme?.toggleLabel || !props.theme.preferenceLabels?.system
    || !props.theme.preferenceLabels.light || !props.theme.preferenceLabels.dark)) {
    throw new ContentCopyBindingError("appFrame.theme", "theme-copy-required");
  }
  return { ...props, locale, copyResolver: resolver && (reference => {
    const resolved = resolver({ ...reference, locale });
    return resolved && (resolved.servedLocale ?? resolved.locale) === locale ? { ref: reference, text: resolved.text } : undefined;
  }) };
}
