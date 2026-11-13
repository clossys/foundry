import type { ReactNode } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { Writable } from "node:stream";
import { readFileSync, readdirSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { computeCopyFingerprint, createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { SiteFrame } from "./SiteFrame.js";
import { resolveShell } from "./internal/resolveShell.js";
import { SITE_FRAME_CONTRACT } from "./site-frame-contract.js";
import type { SiteShellInput } from "./types.js";
import { ConsumerComponentProvider } from "../../../dist/runtime/component-leaf.client.js";
import { fixtureConsumerComponents } from "../../../dist/catalog-core/__fixtures__/surface-consumer-components.js";
import { componentDescriptorHash, type ComponentCandidate } from "../../catalog-core/resolve-components.js";
import { importShadcnAriaComponents, materializeShadcnComponent } from "../../importers/shadcn-aria-components.js";
import { selectedRuntime } from "../../importers/__fixtures__/selected-runtime.js";

function selectedFooterComponents() {
  const directory = resolvePath(import.meta.dirname, "../../importers/__fixtures__/shadcn-aria");
  const read = (name: string) => readFileSync(resolvePath(directory, name), "utf8");
  const imported = importShadcnAriaComponents({
    items: readdirSync(directory).filter(name => name.endsWith(".json")).map(name => JSON.parse(read(name))).filter(item => item.type === "registry:ui"),
    styles: { path: "apps/v4/registry/styles/style-nova.css", content: read("style-nova.css") },
    notice: { path: "LICENSE.md", content: read("LICENSE.md") },
  });
  const descriptor = imported.fills.find(row => row.components.button)!.components.button as ComponentCandidate;
  if (descriptor.impl.kind !== "source" || !descriptor.secondaryExports?.some(row => row.name === "LinkButton"))
    throw new Error("NEED authenticated native Button.LinkButton");
  const files = materializeShadcnComponent(imported, "button");
  const selection = fixtureConsumerComponents(), profile = selection.profile.components;
  const hash = componentDescriptorHash(descriptor);
  const origin = { kind: "adopted" as const, source: "shadcn@aria", fill: "shadcn@aria/components.button", pin: descriptor.pin, license: descriptor.license, sha256: hash, adoptedAt: "2026-01-01" };
  return { ...selection, selectionHash: hash, profile: { components: { ...profile, selectionHash: hash,
    files: [...profile.files.filter(file => !files.some(next => next.path === file.path)), ...files], components: {
      ...profile.components, "components.button": { ...profile.components["components.button"]!, originKind: "adopted" as const,
        origin, impl: descriptor.impl, propMap: descriptor.propMap, descriptor },
    } } }, descriptors: { ...selection.descriptors, "components.button": hash },
    modules: { ...selection.modules, [descriptor.impl.entry]: selectedRuntime(files).load(descriptor.impl.entry) } };
}
const selection = selectedFooterComponents();

/** Wait for the selected-component boundary and reject errors instead of accepting a fallback. */
function renderSelected(node: ReactNode): Promise<string> {
  return new Promise((resolve, reject) => {
    let html = "";
    const destination = new Writable({ write(chunk, _encoding, done) { html += chunk.toString(); done(); } });
    destination.on("finish", () => resolve(html));
    destination.on("error", reject);
    const stream = renderToPipeableStream(node, { onAllReady() { stream.pipe(destination); }, onError: reject });
  });
}

const registry: CopyRegistry = {
  id: "example-footer", locale: "en", revision: "1",
  source: { kind: "consumer", reference: "example-footer" },
  entries: [
    ["example.home", "Example home"], ["example.skip", "Skip to content"],
    ["example.entity", "Example Company"], ["example.privacy", "Privacy"],
    ["example.choices", "Privacy choices"], ["example.navigation", "Navigation"],
  ].map(([id, text]) => ({ id, text, context: "Example footer fixture", status: "approved",
    approval: { approvedBy: "owner", approvedAt: "2026-01-01T00:00:00Z",
      textFingerprint: computeCopyFingerprint(text), fingerprintAlgorithm: "sha256" } })),
};
const resolveCopy = createCopyResolver(registry, { target: "production" });
const resolveAsset = () => ({ type: "image", src: "/mark.svg", width: 32, height: 32, alt: "Example" });
const shell: SiteShellInput = {
  brand: { assetId: "mark", label: { id: "example.home" }, variant: "mark", size: "md" },
  skipLink: { id: "example.skip" },
  footer: {
    legal: { entity: { id: "example.entity" }, linksLabel: { id: "example.navigation" }, links: [{ href: "/privacy", label: { id: "example.privacy" } }] },
    privacyChoices: { label: { id: "example.choices" } },
  },
};
const resolve = (input = shell) => resolveShell(input, resolveCopy, resolveAsset);
const frame = (input = shell, copy = resolveCopy) => <ConsumerComponentProvider value={selection}><SiteFrame shell={input} resolveCopy={copy} resolveAsset={resolveAsset}><h1>Example page</h1></SiteFrame></ConsumerComponentProvider>;
afterEach(() => window.history.replaceState(null, "", "/"));

describe("explicit footer privacy choices control", () => {
  it("resolves approved Writer copy and renders one fixed same-document link after legal links", async () => {
    const input = { ...shell, origin: "https://example.com" };
    expect(resolve(input).footer?.privacyChoices).toEqual({ href: "#privacy-choices", label: "Privacy choices" });
    const node = document.createElement("div");
    node.innerHTML = await renderSelected(frame(input));
    const navigation = within(node.querySelector("footer")!).getByRole("navigation", { name: "Navigation" });
    expect(Array.from(navigation.querySelectorAll("a"), link => link.getAttribute("href"))).toEqual(["https://example.com/privacy", "#privacy-choices"]);
    expect(within(navigation).getAllByRole("link", { name: "Privacy choices" })).toHaveLength(1);
    expect(within(navigation).getByRole("link", { name: "Privacy choices" })).toHaveAttribute("data-slot", "button");
    expect(SITE_FRAME_CONTRACT.constituents.Footer.content).toContain("privacyChoices");
  });

  it("is opt-in and counts toward the five-link flat row", async () => {
    const { privacyChoices: _control, ...footer } = shell.footer!;
    expect(resolve({ ...shell, footer }).footer).not.toHaveProperty("privacyChoices");
    for (const count of [4, 5]) {
      const input = { ...shell, footer: { ...shell.footer!, legal: { ...shell.footer!.legal,
        links: Array.from({ length: count }, (_, index) => ({ href: `/legal-${index}`, label: { id: "example.privacy" } })) } } };
      if (count === 4) {
        const node = document.createElement("div");
        node.innerHTML = await renderSelected(frame(input));
        const navigation = within(node.querySelector("footer")!).getByRole("navigation", { name: "Navigation" });
        expect(within(navigation).getAllByRole("link")).toHaveLength(5);
      } else await expect(renderSelected(frame(input))).rejects.toThrow(expect.objectContaining({ code: "footer-link-limit" }));
    }
  });

  it.each(["draft", "stale"])("refuses %s control copy through the actual Writer", async change => {
    const altered = structuredClone(registry);
    const entry = altered.entries.find(entry => entry.id === "example.choices")!;
    if (change === "draft") { entry.status = "draft"; delete entry.approval; }
    else entry.text += " changed";
    const copy = createCopyResolver(altered, { target: "production" });
    expect(copy({ id: "example.choices" })).toBeUndefined();
    await expect(renderSelected(frame(shell, copy))).rejects.toThrow("shell.footer.privacyChoices.label did not resolve to copy.");
  });

  it.each(["#privacy-choices", "#%70rivacy-choices", "https://example.com/privacy#PRIVACY-CHOICES"])("retains the generic footer fragment guard for %s", href => {
    const link = { href, label: { id: "example.choices" } };
    const inputs: SiteShellInput[] = [
      { ...shell, footer: { ...shell.footer!, links: [link] } },
      { ...shell, footer: { ...shell.footer!, columns: [{ heading: { id: "example.navigation" }, links: [link] }] } },
      { ...shell, footer: { ...shell.footer!, legal: { ...shell.footer!.legal, links: [link] } } },
      { ...shell, footer: { ...shell.footer!, social: { links: [{ ...link, assetId: "mark" }] } } },
    ];
    for (const input of inputs) expect(() => resolve(input)).toThrow(expect.objectContaining({ code: "footer-privacy-choices" }));
  });

  it("refuses arbitrary control URLs and callbacks and retains duplicate-navigation guards", () => {
    for (const field of [{ href: "javascript:alert(1)" }, { onClick: () => {} }]) {
      const input = { ...shell, footer: { ...shell.footer!, privacyChoices: { label: { id: "example.choices" }, ...field } } };
      expect(() => resolve(input)).toThrow("shell.footer.privacyChoices has an unsupported field");
    }
    for (const href of ["/privacy", "#privacy-choices"]) {
      expect(() => resolve({ ...shell, nav: { label: { id: "example.navigation" }, links: [{ href, label: { id: "example.privacy" } }] } }))
        .toThrow(expect.objectContaining({ code: "footer-duplicate-link" }));
    }
  });

  it("lets the host handle repeated same-page hash activations without changing consent storage", async () => {
    window.history.replaceState(null, "", "/example?locale=en");
    const before = { local: { ...window.localStorage }, session: { ...window.sessionStorage } };
    let activations = 0;
    const onHash = () => {
      if (window.location.hash !== "#privacy-choices") return;
      activations++;
      window.history.replaceState(null, "", "/example?locale=en");
    };
    window.addEventListener("hashchange", onHash);
    try {
      const view = render(frame({ ...shell, origin: "https://example.com" }));
      const control = within(await view.findByRole("contentinfo")).getByRole("link", { name: "Privacy choices" });
      expect(control).toHaveAttribute("data-slot", "button");
      for (const count of [1, 2]) {
        fireEvent.click(control);
        await waitFor(() => expect(activations).toBe(count));
        expect(window.location.pathname + window.location.search + window.location.hash).toBe("/example?locale=en");
      }
      expect({ local: { ...window.localStorage }, session: { ...window.sessionStorage } }).toEqual(before);
    } finally { window.removeEventListener("hashchange", onHash); }
  });
});
