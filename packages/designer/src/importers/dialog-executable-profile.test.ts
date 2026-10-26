// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { dialogExecutableSource, dialogExecutableMembers } from "./dialog-executable-profile.js";
import { normalizeSelectedSource } from "./normalize-selected-source.js";
const raw = JSON.parse(readFileSync(resolve(import.meta.dirname,"__fixtures__/shadcn-aria/dialog.json"),"utf8")).files[0] as {path:string;content:string};
describe("selected Dialog executable source",()=>{
  it("routes naming, description and React19 ref to the inner dialog while retaining one overlay state owner",()=>{
    const adapted=dialogExecutableSource(raw),code=normalizeSelectedSource({...adapted,path:"components/dialog/dialog.tsx"}).content;
    const parsed=ts.createSourceFile("dialog.tsx",code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    expect((parsed as unknown as {parseDiagnostics:unknown[]}).parseDiagnostics).toEqual([]);
    const declaration=parsed.statements.find(row=>ts.isFunctionDeclaration(row)&&row.name?.text==="Dialog")!;
    const tags:ts.JsxOpeningElement[]=[];
    const visit=(node:ts.Node)=>{if(ts.isJsxOpeningElement(node))tags.push(node);ts.forEachChild(node,visit);};visit(declaration);
    const inner=tags.filter(tag=>tag.tagName.getText(parsed)==="DialogPrimitive");expect(inner).toHaveLength(1);
    for(const prop of ["aria-label={ariaLabel}","aria-labelledby={ariaLabelledby}","aria-describedby={ariaDescribedby}","ref={ref}"])expect(inner[0]!.getText(parsed)).toContain(prop);
    expect(tags.filter(tag=>tag.tagName.getText(parsed)==="DialogOverlay")).toHaveLength(1);
    expect(tags.find(tag=>tag.tagName.getText(parsed)==="DialogOverlay")!.getText(parsed)).toBe("<DialogOverlay isDismissable={isDismissable} {...props}>");
    expect(code).toContain('children: DialogPrimitiveProps["children"]');
    expect(code).toContain("composeRenderProps(children");
    expect(code).toContain("showCloseButton = true");
    expect(code).toContain('<span className="sr-only">Close</span>');
    expect(code).not.toContain("React.");
    expect(dialogExecutableMembers).toEqual({"role.modal":"Dialog",dismissable:"Dialog"});
  });
  it("refuses changed upstream bytes rather than guessing a compatible Dialog",()=>{
    expect(()=>dialogExecutableSource({...raw,content:raw.content+" "})).toThrow(/receipt differs/);
  });
});
