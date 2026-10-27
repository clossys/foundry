import { useState } from "react";
import { Pagination } from "../../blocks/Pagination.js";
import { Button } from "../../components/Button.js";
import { Checkbox } from "../../components/Checkbox.js";
import { Link } from "../../components/Link.js";
import { SearchField } from "../../components/SearchField.js";
import { TextField } from "../../components/TextField.js";
import { Toolbar } from "../../components/Toolbar.js";

/**
 * The region and action content shared by the group-b renderers, each rendered through a component the
 * leaf's contract lets it compose, or through its declared `sections.pagination` part. Content stays JSON;
 * the part owns every callback. Until L9 provides a consumer component-index port these compose the
 * package's own registered components directly, so a consumer component swap does not reach them yet.
 */
export interface FieldRegionContent { readonly search: { readonly label: string; readonly placeholder?: string } }
export interface LinkRegionContent { readonly links: readonly { readonly id: string; readonly label: string; readonly href: string }[] }
export interface ToggleToolbarContent { readonly label: string; readonly toggles: readonly { readonly id: string; readonly label: string; readonly selected?: boolean }[] }
export interface PaginationRegionContent { readonly page: number; readonly pageCount: number; readonly totalItems?: number; readonly pageSize?: number }
export interface ActionContent { readonly id?: string; readonly label: string }

/** A search region: `search` composes SearchField, `text` composes TextField (whichever the leaf may compose). */
export function FieldRegion({ content, field }: { readonly content: FieldRegionContent; readonly field: "search" | "text" }) {
  return field === "search"
    ? <SearchField label={content.search.label} placeholder={content.search.placeholder} />
    : <TextField label={content.search.label} placeholder={content.search.placeholder} />;
}

export function LinkRegion({ content }: { readonly content: LinkRegionContent }) {
  return <>{content.links.map(link => <Link key={link.id} href={link.href} variant="muted">{link.label}</Link>)}</>;
}

export function ToggleToolbarRegion({ content }: { readonly content: ToggleToolbarContent }) {
  return <Toolbar aria-label={content.label} variant="bare">
    {content.toggles.map(toggle => <Checkbox key={toggle.id} defaultSelected={toggle.selected}>{toggle.label}</Checkbox>)}
  </Toolbar>;
}

export function PaginationRegion({ content, label }: { readonly content: PaginationRegionContent; readonly label: string }) {
  const [page, setPage] = useState(content.page);
  return <Pagination aria-label={label} page={page} pageCount={content.pageCount} totalItems={content.totalItems} pageSize={content.pageSize} onPageChange={setPage} />;
}

export function ActionPart({ content }: { readonly content: ActionContent }) {
  return <Button variant="secondary" size="md">{content.label}</Button>;
}
