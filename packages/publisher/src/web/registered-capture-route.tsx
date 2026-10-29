"use client";

import { ConsentExperience } from "./consent/ConsentExperience.client.js";
import type { ConsentExperienceProps } from "./consent/ConsentExperience.client.js";
import { RegisteredRoutePage } from "./registered-route-pages.js";
import type { RegisteredRoutePageProps, RegisteredRouteRuntimeHook } from "./registered-route-binding.js";

export interface RegisteredCaptureRoutePageProps extends RegisteredRoutePageProps {
  /** Consumer-owned POST endpoint. Publisher supplies no submission handler. */
  readonly handlerUrl: string;
  /** The existing consent host, with consumer-resolved copy and lifecycle ports. */
  readonly consent: Omit<ConsentExperienceProps, "children">;
}

function requireHandlerUrl(value: string): void {
  const fail = (): never => { throw new TypeError("Capture route requires a root-relative or HTTPS consumer handlerUrl"); };
  if (typeof value !== "string" || !value || /[\s\\\u0000-\u001f\u007f]/u.test(value)) fail();
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("#")) return;
  if (!/^https:\/\//i.test(value)) fail();
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname && !url.username && !url.password && !url.hash) return;
  } catch { /* Refuse malformed consumer URLs below. */ }
  fail();
}

/** A native registered page with a consumer POST form and the real consent host. */
export function RegisteredCaptureRoutePage({ handlerUrl, consent, useRuntime, ...page }: RegisteredCaptureRoutePageProps) {
  requireHandlerUrl(handlerUrl);
  if (!consent || typeof consent !== "object" || typeof consent.createLifecycle !== "function" || !consent.copy) {
    throw new TypeError("Capture route requires a consent host with resolved copy and a lifecycle");
  }
  const useCaptureRuntime: RegisteredRouteRuntimeHook = route => {
    if (!Object.values(route.composition.binding.fills).some(fills => fills.some(fill => fill.section === "sections.form"))) {
      throw new TypeError("Capture route requires a registered sections.form in its page body");
    }
    const runtime = useRuntime(route);
    const sectionHosts = runtime.assembly.ports.sectionHosts;
    return {
      ...runtime,
      assembly: {
        ...runtime.assembly,
        ports: {
          ...runtime.assembly.ports,
          sectionHosts: {
            ...sectionHosts,
            "sections.form": { ...sectionHosts?.["sections.form"], capture: { handlerUrl } },
          },
        },
      },
    };
  };
  return <ConsentExperience {...consent}>
    <RegisteredRoutePage {...page} useRuntime={useCaptureRuntime} />
  </ConsentExperience>;
}
