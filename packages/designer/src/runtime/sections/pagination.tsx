import { Pagination } from "../../blocks/Pagination.js";
import { memberOf, noop, numberField, refuseUnmapped, requireSlot, slotValue, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.pagination";

/**
 * page -> Pagination.page, pageCount and pageSize; total -> Pagination.totalItems; mode.pages is the only
 * Pagination mode. Load-more and cursor modes have no Pagination API.
 */
export const paginationInputs: SectionInputs = { slots: ["page", "total"], members: ["mode.pages"], unmapped: { members: ["mode.load-more", "mode.cursor"] } };

export const renderPagination: SectionRenderer = input => {
  refuseUnmapped(input, paginationInputs);
  memberOf(input, "mode");
  const page = requireSlot(input, LEAF, "page");
  const current = numberField(page, "page"), pageCount = numberField(page, "pageCount");
  if (current === undefined || pageCount === undefined) throw new TypeError(`${LEAF}: page needs a page number and a pageCount`);
  const total = slotValue(input, "total");
  const totalItems = total === undefined ? undefined : typeof total === "number" ? total : numberField(total, "total");
  if (total !== undefined && totalItems === undefined) throw new TypeError(`${LEAF}: total needs a number`);
  return <Pagination page={current} pageCount={pageCount} pageSize={numberField(page, "pageSize")} totalItems={totalItems} onPageChange={noop} />;
};
