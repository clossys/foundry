import { Matrix, type MatrixSide } from "./Matrix.js";

const side: MatrixSide = { id: "left", label: "First", heading: "A shared view", points: ["One", "Two"] };
void <Matrix sides={[side, { ...side, id: "right" }]} featured="right" ground="inverse" headingLevel={4} />;
// @ts-expect-error Exactly two sides are required.
void <Matrix sides={[side]} />;
// @ts-expect-error Every side needs a stable id.
const missingId: MatrixSide = { label: "First", heading: "A shared view", points: ["One", "Two"] };
// @ts-expect-error Matrix side headings are required.
const missingHeading: MatrixSide = { id: "left", label: "First", points: ["One", "Two"] };
// A side may omit the label; its required heading supplies the semantic heading.
const unlabeled: MatrixSide = { id: "left", heading: "A shared view", points: ["One", "Two"] };
void <Matrix sides={[unlabeled, { ...unlabeled, id: "right" }]} headingLevel={4} />;
const visual: MatrixSide = { id: "left", heading: "A shared view", visual: <svg aria-label="Sample view" /> };
void <Matrix sides={[visual, { ...visual, id: "right" }]} />;
// @ts-expect-error A description is a lead, never a standalone Matrix body.
const descriptionOnly: MatrixSide = { id: "left", heading: "A shared view", description: "Supporting lead." };
// @ts-expect-error Matrix points and visual cannot be combined.
const mixedForms: MatrixSide = { id: "left", heading: "A shared view", points: ["One", "Two"], visual: <svg aria-label="Sample view" /> };
// @ts-expect-error A third side is outside the current contract.
void <Matrix sides={[side, side, side]} />;
// @ts-expect-error Grounds are closed.
void <Matrix sides={[side, side]} ground="other" />;
// @ts-expect-error The side label is below the page heading.
void <Matrix sides={[side, side]} headingLevel={1} />;
void missingId;
void missingHeading;
void unlabeled;
void descriptionOnly;
void mixedForms;

type GridProps = Extract<import("./Matrix.js").MatrixProps, { arrangement: "grid" }>;
const grid: GridProps = {
  arrangement: "grid",
  columns: [{ id: "copy", label: "Record" }, { id: "figure", label: "Count" }, { id: "status", label: "State" }],
  rows: [
    { id: "one", label: "First", cells: { copy: { type: "text", text: "Authored copy" }, figure: { type: "figure", value: 12, delta: "+2", trend: "up" }, status: { type: "status", tone: "success", label: "Reviewed" } } },
    { id: "two", label: "Second", description: "Supporting copy.", cells: { copy: { type: "empty" }, figure: { type: "figure", value: 0 }, status: { type: "status", tone: "neutral", label: "Pending" } } },
  ],
  emptyLabel: "No authored value", featured: { column: "figure" }, featuredLabel: "Selected",
};
void <Matrix {...grid} aria-label="Comparison" ground="inverse" headingLevel={6} />;
void <Matrix arrangement="sides" sides={[side, { ...side, id: "right" }]} />;
// @ts-expect-error A grid requires its rows.
void <Matrix arrangement="grid" columns={grid.columns} />;
// @ts-expect-error Grid and sides cannot be combined.
void <Matrix {...grid} sides={[side, side]} />;
// @ts-expect-error One featured axis is selected at a time.
void <Matrix {...grid} featured={{ row: "one", column: "copy" }} />;
// @ts-expect-error The grid has no unsupported arrangement.
void <Matrix {...grid} arrangement="other" />;
// @ts-expect-error A figure cell requires its authored value.
const incompleteFigure: GridProps["rows"][number]["cells"][string] = { type: "figure", delta: "+2" };
// @ts-expect-error A status cell requires a supported tone.
const unknownStatus: GridProps["rows"][number]["cells"][string] = { type: "status", tone: "other", label: "State" };
void incompleteFigure;
void unknownStatus;
