import type { ItemData } from "@clossys/designer/blocks/server";
import type { CopyResolver } from "@clossys/writer";
import type { LegalDocument } from "../../document/legal.js";
import type { SiteShellInput } from "@clossys/designer/frames";
import type { AssetResolver } from "../types.js";
import { StatusView, type StatusViewProps } from "./StatusView.js";
import { LegalView, type LegalViewLabels, type LegalViewProps } from "./LegalView.js";
import { GlobalErrorDocument, type GlobalErrorDocumentFramedProps, type GlobalErrorDocumentErrorViewProps } from "./GlobalErrorDocument.js";
import type { StatusViewProps as BarrelStatusProps, LegalViewProps as BarrelLegalProps, GlobalErrorDocumentFramedProps as BarrelFramedProps } from "../server.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
type Collection = { label: string; items: readonly (ItemData & { href: string })[] };
type StatusShape = Expect<Equal<Pick<StatusViewProps, "routes">, { routes?: Collection }>>;
type LegalShape = Expect<Equal<Pick<LegalViewProps, "related">, { related?: Collection }>>;
type FramedShape = Expect<Equal<Pick<GlobalErrorDocumentFramedProps, "routes">, { routes?: Collection }>>;
type FramedParity = Expect<Equal<GlobalErrorDocumentFramedProps["routes"], StatusViewProps["routes"]>>;
type LegacyRejection = Expect<Equal<Pick<GlobalErrorDocumentErrorViewProps, "routes">, { routes?: never }>>;
type StatusBarrelParity = Expect<Equal<BarrelStatusProps, StatusViewProps>>;
type LegalBarrelParity = Expect<Equal<BarrelLegalProps, LegalViewProps>>;
type FramedBarrelParity = Expect<Equal<BarrelFramedProps, GlobalErrorDocumentFramedProps>>;

const linkedItem = { id: "guide", heading: "Guide", href: "/guide" } satisfies ItemData & { href: string };
const readonlyItems: readonly (ItemData & { href: string })[] = Object.freeze([linkedItem]);
const collection = { label: "Useful destinations", items: readonlyItems } satisfies Collection;
const empty = { label: "Useful destinations", items: [] } satisfies Collection;

void <StatusView status="404" />;
void <StatusView status="404" routes={collection} />;
void <StatusView status="404" routes={empty} />;
// @ts-expect-error Collection labels are required caller-owned strings.
void <StatusView status="404" routes={{ items: readonlyItems }} />;
// @ts-expect-error JSX is not a collection label.
void <StatusView status="404" routes={{ label: <span>Next</span>, items: readonlyItems }} />;
// @ts-expect-error A route link requires href even though generic ItemData makes it optional.
void <StatusView status="404" routes={{ label: "Next", items: [{ id: "guide", heading: "Guide" }] }} />;

declare const document: LegalDocument;
declare const labels: LegalViewLabels;
declare const resolveCopy: CopyResolver;
const legal = { brand: "Example", document, labels, resolveCopyId: resolveCopy, locale: "en" };
void <LegalView {...legal} />;
void <LegalView {...legal} related={collection} />;
void <LegalView {...legal} related={empty} />;
// @ts-expect-error Related collections require their own label.
void <LegalView {...legal} related={{ items: readonlyItems }} />;
// @ts-expect-error Related labels are plain strings.
void <LegalView {...legal} related={{ label: <span>Related</span>, items: readonlyItems }} />;
// @ts-expect-error Every related item is a destination with required href.
void <LegalView {...legal} related={{ label: "Related", items: [{ id: "guide", heading: "Guide" }] }} />;

declare const shell: SiteShellInput;
declare const resolveAsset: AssetResolver;
const head = { lang: "en", localeManifest: { locales: [{ tag: "en", dir: "ltr" as const, state: "active" as const }] }, documentTitle: { page: "Something went wrong", brand: "Example Studio" }, icon: { href: "/icon.svg" } };
const frame = { shell, resolveCopy, resolveAsset, status: "500" };
void <GlobalErrorDocument {...head} {...frame} />;
void <GlobalErrorDocument {...head} {...frame} routes={collection} />;
void <GlobalErrorDocument {...head} {...frame} routes={empty} />;
// @ts-expect-error The framed API requires the same caller-owned collection label.
void <GlobalErrorDocument {...head} {...frame} routes={{ items: readonlyItems }} />;
// @ts-expect-error The framed API accepts a string collection label, not JSX.
void <GlobalErrorDocument {...head} {...frame} routes={{ label: <span>Next</span>, items: readonlyItems }} />;
// @ts-expect-error The framed API requires href on each destination.
void <GlobalErrorDocument {...head} {...frame} routes={{ label: "Next", items: [{ id: "guide", heading: "Guide" }] }} />;

void <GlobalErrorDocument {...head} status={500} title="Something went wrong" />;
// @ts-expect-error Routes belong only to the framed StatusView shape.
void <GlobalErrorDocument {...head} status={500} title="Something went wrong" routes={collection} />;
// Assignment through a variable also rejects legacy routes; this is not only an excess-property check.
const legacyWithRoutes = { ...head, status: 500, title: "Something went wrong", routes: collection };
// @ts-expect-error Legacy routes?: never rejects an existing object's collection.
const rejectedLegacy: GlobalErrorDocumentErrorViewProps = legacyWithRoutes;

export {};
