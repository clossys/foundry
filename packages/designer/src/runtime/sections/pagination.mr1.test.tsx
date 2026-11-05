// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderPagination, paginationInputs } from "./pagination.js";
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import { PAGINATION_COPY_REFS } from "../../blocks/Pagination.js";
import type { RuntimeJson, RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import type { ReactNode } from "react";
afterEach(cleanup);
function input(page: RuntimeJson, total?: RuntimeJson): RuntimeRenderInput<ReactNode> {
  return {fill:{leaf:"sections.pagination",...paginationInputs},selection:{leaf:"sections.pagination",members:["mode.pages"]},content:{page:{value:page},...(total===undefined?{}:{total:{value:total}})}} as RuntimeRenderInput<ReactNode>;
}
describe("MR-1 registered pagination copy",()=>{
 it("delivers resolved passage fields to the real pagination block",()=>{
   render(<>{renderPagination(input({page:2,pageCount:4,label:"Records navigation",previousLabel:"Earlier records",nextLabel:"Later records",pageText:"Second of four",noResultsLabel:"Empty collection",pageSizeLabel:"Record count"}))}</>);
   expect(screen.getByRole("navigation",{name:"Records navigation"})).toBeInTheDocument();
   expect(screen.getByRole("button",{name:"Earlier records"})).toBeEnabled();
   expect(screen.getByRole("button",{name:"Later records"})).toBeEnabled();
   expect(screen.getByText("Second of four")).toBeInTheDocument();
 });
 it("resolves omitted fields through the existing Writer CopyRefs with live numeric values",()=>{
   const requests:{id:string,values?:Readonly<Record<string,string|number|boolean>>}[]=[];
   render(<ShellCopyProvider resolver={ref=>{requests.push(ref);return {ref,text:`Copy ${ref.id}`};}}>{renderPagination(input({page:2,pageCount:4,pageSize:10},42))}</ShellCopyProvider>);
   expect(requests).toContainEqual(expect.objectContaining({id:PAGINATION_COPY_REFS.rangeSummaryMessage.id,values:{start:11,end:20,total:42}}));
   expect(screen.getByRole("navigation")).toHaveAttribute("aria-label",`Copy ${PAGINATION_COPY_REFS["aria-label"].id}`);
 });
});
