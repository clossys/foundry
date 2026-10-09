"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Link } from "@clossys/designer/atoms";
import { ConsentBanner } from "@clossys/designer/blocks";
import type { ResolvedConsentCopy } from "../../consent-copy/types.js";
import { bindTransport } from "./bind-transport.js";
import { ConsentContext } from "./context.js";
import type { ConsentContextValue } from "./context.js";
import { NO_DECISION_VIEW } from "./ports.js";
import type {
  AnalyticsPermissionPort,
  ConsentLifecycleInput,
  ConsentLifecyclePort,
  ConsentReviewValue,
  ConsentSnapshotView,
  ConsentStatusView,
} from "./ports.js";
import { normaliseReopenEvent, normaliseReopenFragment, useConsentReopen } from "./reopen.js";
import { buildSeamLifecycle, DEFAULT_REVIEW_PARAM, readReviewSeamValue } from "./review-seam.js";

export interface ConsentExperienceProps {
  /** Copy resolved on the server with `resolveConsentCopy`. */
  copy: ResolvedConsentCopy;
  /** Builds the lifecycle. Called on client mount only, and honours every field of its input. */
  createLifecycle: (input: ConsentLifecycleInput) => ConsentLifecyclePort;
  /** Bound synchronously to a non-simulated lifecycle while `required` is true. */
  transport?: AnalyticsPermissionPort;
  /** Whether this surface runs analytics at all. Defaults to `true`. */
  required?: boolean;
  /** The policy page, labelled by `copy.privacyLinkLabel`. */
  policyLink?: { href: string } | false;
  /** The fragment and the document event that reopen the notice; `false` disables one. */
  reopen?: { fragment?: string | false; eventName?: string | false };
  /** Called once per accept or reject press the lifecycle acts on. A report of a choice, never a permission signal. */
  onChange?: (choice: "granted" | "denied") => void;
  /** The loopback-only review seam. On by default; `false` disables it. */
  reviewSeam?: { param?: string } | false;
  children?: ReactNode;
}

/**
 * How the notice was last placed: `auto` follows the snapshot's
 * `promptAutomatically`, `open` was opened by reopen, `closed` follows a
 * choice, and `set-aside` follows Escape for this page view.
 */
type NoticeMode = "auto" | "open" | "closed" | "set-aside";

type StatusKey = keyof ResolvedConsentCopy["status"];

interface Mounted {
  lifecycle: ConsentLifecyclePort | null;
  seam: ConsentReviewValue | null;
  seamFailed: boolean;
}

const UNMOUNTED: Mounted = { lifecycle: null, seam: null, seamFailed: false };

const noopSubscribe = (): (() => void) => () => {};
const noDecision = (): ConsentSnapshotView => NO_DECISION_VIEW;
const inert = (): void => {};

function readGpcSignal(): boolean {
  try {
    const navigatorWithGpc = globalThis.navigator as (Navigator & { globalPrivacyControl?: unknown }) | undefined;
    return Boolean(navigatorWithGpc?.globalPrivacyControl);
  } catch {
    return false;
  }
}

/** One status at a time, the most urgent first. */
function statusFor(snapshot: ConsentSnapshotView): StatusKey | null {
  if (snapshot.withdrawal === "failed") return "withdrawalFailed";
  if (snapshot.gpcInForce) return "gpcInForce";
  if (snapshot.storage === "unreadable") return "storageUnavailable";
  if (snapshot.persistence === "memory") return "memoryOnly";
  if (snapshot.evidence === "unavailable") return "evidenceUnavailable";
  if (snapshot.evidence === "conflict") return "evidenceConflict";
  return null;
}

function actedOn(before: ConsentSnapshotView, after: ConsentSnapshotView): boolean {
  if (before === after) return false;
  const keys = Object.keys(NO_DECISION_VIEW) as (keyof ConsentSnapshotView)[];
  return keys.some((key) => before[key] !== after[key]);
}

function isFocusable(element: Element | null): element is HTMLElement {
  return element !== null && element !== globalThis.document.body && typeof (element as HTMLElement).focus === "function";
}

function returnFocus(opener: Element | null, wrapper: HTMLElement | null): void {
  const doc = globalThis.document;
  if (isFocusable(opener) && doc.contains(opener) && !(wrapper?.contains(opener) ?? false)) {
    opener.focus();
    return;
  }
  const main = doc.querySelector("main");
  if (main === null) return;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus();
}

/**
 * The consent notice assembly. It renders Designer's `ConsentBanner` with
 * server-resolved copy and drives it from the host's lifecycle, which it
 * creates on client mount and disposes on unmount.
 *
 * The server render and the first client render use the no-decision
 * snapshot, so nothing renders and analytics reads as not allowed until
 * mount. The notice opens by itself only when the lifecycle asks for an
 * automatic prompt or a withdrawal has failed, and otherwise only through
 * the reopen fragment or event. Escape sets it aside for the page view.
 */
export function ConsentExperience(props: ConsentExperienceProps): ReactNode {
  const { copy, transport, policyLink, reopen, reviewSeam, children } = props;
  const required = props.required ?? true;
  const seamParam = reviewSeam === false ? null : (reviewSeam?.param ?? DEFAULT_REVIEW_PARAM);
  const reopenFragment = normaliseReopenFragment(reopen?.fragment);
  const reopenEvent = normaliseReopenEvent(reopen?.eventName);

  const createLifecycleRef = useRef(props.createLifecycle);
  createLifecycleRef.current = props.createLifecycle;
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  const [mounted, setMounted] = useState<Mounted>(UNMOUNTED);
  const [mode, setMode] = useState<NoticeMode>("auto");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const focusOnOpenRef = useRef(false);
  const returnFocusRef = useRef(false);

  // The lifecycle is created in a mount effect and disposed in its cleanup,
  // so a development double mount leaves exactly one live lifecycle.
  useEffect(() => {
    const seam = seamParam === null ? null : readReviewSeamValue(seamParam);
    if (!required && seam === null) {
      setMounted(UNMOUNTED);
      return undefined;
    }
    let lifecycle: ConsentLifecyclePort;
    if (seam !== null) {
      const result = buildSeamLifecycle(createLifecycleRef.current, seam);
      if (!result.ok) {
        console.error(`ConsentExperience: the review seam was disabled because ${result.reason}.`);
        setMounted({ lifecycle: null, seam, seamFailed: true });
        setMode("auto");
        return undefined;
      }
      lifecycle = result.lifecycle;
    } else {
      lifecycle = createLifecycleRef.current({ signals: { gpc: readGpcSignal() } });
    }
    setMounted({ lifecycle, seam, seamFailed: false });
    setMode("auto");
    return () => {
      lifecycle.dispose();
    };
  }, [required, seamParam]);

  const { lifecycle, seam, seamFailed } = mounted;
  const seamActive = seam !== null;

  const subscribe = useMemo(
    () => (lifecycle === null ? noopSubscribe : (listener: () => void) => lifecycle.subscribe(listener)),
    [lifecycle],
  );
  const getSnapshot = useMemo(() => (lifecycle === null ? noDecision : () => lifecycle.getSnapshot()), [lifecycle]);
  const liveSnapshot = useSyncExternalStore(subscribe, getSnapshot, noDecision);
  const snapshot = seamFailed ? NO_DECISION_VIEW : liveSnapshot;

  // The transport is bound only while required, only to a non-simulated
  // lifecycle, and never under the review seam.
  useEffect(() => {
    if (!required || seamActive || lifecycle === null || transport === undefined) return undefined;
    if (lifecycle.getSnapshot().simulated !== false) return undefined;
    return bindTransport(lifecycle, transport);
  }, [required, seamActive, lifecycle, transport]);

  // Expiry is noticed without timers: a re-read when the page is shown again.
  useEffect(() => {
    if (lifecycle === null) return undefined;
    const onVisibility = (): void => {
      if (globalThis.document.visibilityState === "visible") lifecycle.refresh();
    };
    const onPageShow = (): void => {
      lifecycle.refresh();
    };
    globalThis.document.addEventListener("visibilitychange", onVisibility);
    globalThis.addEventListener("pageshow", onPageShow);
    return () => {
      globalThis.document.removeEventListener("visibilitychange", onVisibility);
      globalThis.removeEventListener("pageshow", onPageShow);
    };
  }, [lifecycle]);

  const active = (required || seamActive) && (lifecycle !== null || seamFailed);
  const visible =
    active &&
    (seamFailed
      ? mode !== "set-aside"
      : snapshot.withdrawal === "failed" || mode === "open" || (mode === "auto" && snapshot.promptAutomatically));

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const handleReopen = useCallback(() => {
    if (visibleRef.current) return;
    if (lifecycle !== null) lifecycle.refresh();
    openerRef.current = globalThis.document.activeElement;
    focusOnOpenRef.current = true;
    setMode("open");
  }, [lifecycle]);

  useConsentReopen({ enabled: active, fragment: reopenFragment, eventName: reopenEvent, onReopen: handleReopen });

  // Focus: an automatic open does not move focus; a reopen focuses the
  // region; a close by Escape or by a choice returns focus.
  useEffect(() => {
    if (visible) {
      if (!focusOnOpenRef.current) {
        openerRef.current = globalThis.document.activeElement;
        return;
      }
      focusOnOpenRef.current = false;
      const region = wrapperRef.current?.querySelector<HTMLElement>("[data-consent-banner]") ?? null;
      if (region !== null) {
        if (!region.hasAttribute("tabindex")) region.setAttribute("tabindex", "-1");
        region.focus();
      }
      return;
    }
    if (returnFocusRef.current) {
      returnFocusRef.current = false;
      returnFocus(openerRef.current, wrapperRef.current);
    }
  }, [visible]);

  const handleAccept = useCallback(() => {
    if (lifecycle === null) return;
    const before = lifecycle.getSnapshot();
    const after = lifecycle.grant();
    if (!actedOn(before, after)) return;
    returnFocusRef.current = true;
    setMode("closed");
    if (!seamActive) onChangeRef.current?.("granted");
  }, [lifecycle, seamActive]);

  const handleReject = useCallback(() => {
    if (lifecycle === null) return;
    const before = lifecycle.getSnapshot();
    const after = lifecycle.refuse();
    const acted = actedOn(before, after);
    if (after.withdrawal !== "failed") returnFocusRef.current = true;
    // A failed withdrawal stays visible through its own status, whatever the mode.
    setMode("closed");
    if (acted && !seamActive) onChangeRef.current?.("denied");
  }, [lifecycle, seamActive]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Escape") return;
      if (!seamFailed && snapshot.withdrawal === "failed") return;
      returnFocusRef.current = true;
      setMode("set-aside");
    },
    [seamFailed, snapshot.withdrawal],
  );

  const allowed = required && snapshot.allowed && !snapshot.simulated && !seamActive;
  const status: ConsentStatusView = useMemo(
    () => ({
      persistence: snapshot.persistence,
      storage: snapshot.storage,
      evidence: snapshot.evidence,
      withdrawal: snapshot.withdrawal,
      gpcInForce: snapshot.gpcInForce,
      simulated: seam ?? (snapshot.simulated ? "preview" : false),
    }),
    [snapshot, seam],
  );
  const contextValue: ConsentContextValue = useMemo(() => ({ allowed, status }), [allowed, status]);

  const statusKey = statusFor(snapshot);
  const lead = snapshot.regime === "notice" ? copy.noticeLead : copy.promptLead;

  return (
    <ConsentContext.Provider value={contextValue}>
      {children}
      {visible ? (
        <div ref={wrapperRef} data-consent-experience="" onKeyDown={handleKeyDown}>
          <ConsentBanner
            title={copy.title.text}
            body={lead.text}
            acceptLabel={copy.acceptLabel.text}
            rejectLabel={copy.rejectLabel.text}
            onAccept={seamFailed ? inert : handleAccept}
            onReject={seamFailed ? inert : handleReject}
            privacyLink={
              policyLink === undefined || policyLink === false ? undefined : (
                <Link href={policyLink.href}>{copy.privacyLinkLabel.text}</Link>
              )
            }
            status={statusKey === null ? undefined : copy.status[statusKey].text}
          />
        </div>
      ) : null}
    </ConsentContext.Provider>
  );
}
