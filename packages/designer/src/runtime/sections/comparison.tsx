/**
 * sections.comparison: the Matrix grid arrangement (the fill's literal config) with authored text and figure
 * cells. The library-board member needs live Studio previews and commands, which a static runtime render has no
 * port for, so it is refused here rather than drawn without them. Mark cells are refused too: Matrix needs mark
 * and key labels the contract has no slot for.
 */
import type { ReactNode } from "react";
import { Matrix, type MatrixCellData } from "../../blocks/Matrix.js";
import { list, memberValue, object, optionalText, readSectionContent, required, SectionContentError, text, type JsonObject, type SectionContent, type SectionRenderInput, type SectionRendererInputs } from "./group-a-content.js";
import type { RuntimeJson } from "../../catalog-core/runtime-ports.js";

export const comparisonInputs: SectionRendererInputs = { slots: ["columns", "controls", "highlight", "rows"], members: ["arrangement.library-board"] };

function cell(content: SectionContent, value: RuntimeJson | undefined, path: string): MatrixCellData {
  const data = object(content, value, path);
  const type = text(content, data.type, `${path}.type`);
  if (type === "text") return { type, text: text(content, data.text, `${path}.text`) };
  if (type === "figure") return { type, value: text(content, data.value, `${path}.value`), delta: optionalText(content, data.delta, `${path}.delta`) };
  if (type === "empty") return { type };
  throw new SectionContentError(content.leaf, `${path}.type ${type} has no contract slot for its labels`);
}

export function renderComparisonSection(input: SectionRenderInput): ReactNode {
  const content = readSectionContent(input, "sections.comparison", comparisonInputs);
  if (memberValue(content, "arrangement", ["library-board"] as const)) throw new SectionContentError(content.leaf, "arrangement.library-board needs the live Studio port (previews and commands); no static runtime render");
  if (content.values.controls !== undefined) throw new SectionContentError(content.leaf, "controls belong to the library-board arrangement");
  const columns = list(content, required(content, "columns"), "columns").map((row, index) => {
    const column = object(content, row, `columns.${index}`);
    return { id: text(content, column.id, `columns.${index}.id`), label: text(content, column.label, `columns.${index}.label`) };
  });
  const rows = list(content, required(content, "rows"), "rows").map((row, index) => {
    const entry = object(content, row, `rows.${index}`), cells = object(content, entry.cells, `rows.${index}.cells`);
    return {
      id: text(content, entry.id, `rows.${index}.id`),
      label: text(content, entry.label, `rows.${index}.label`),
      description: optionalText(content, entry.description, `rows.${index}.description`),
      cells: Object.fromEntries(columns.map(column => [column.id, cell(content, cells[column.id], `rows.${index}.cells.${column.id}`)])),
    };
  });
  const highlight: JsonObject | undefined = content.values.highlight === undefined ? undefined : object(content, content.values.highlight, "highlight");
  const featured = highlight === undefined ? undefined
    : highlight.column !== undefined ? { column: text(content, highlight.column, "highlight.column") }
    : { row: text(content, highlight.row, "highlight.row") };
  return (
    <Matrix
      arrangement="grid"
      columns={columns}
      rows={rows}
      featured={featured}
      featuredLabel={highlight === undefined ? undefined : optionalText(content, highlight.label, "highlight.label")}
    />
  );
}
