import { WRITER_LAYERS, isWriterLayer, type WriterLayer } from "../../catalog-core/ids.js";
import { createWriterIAReport, loadWriterCatalog, type WriterIAReport, type WriterNode } from "./index.js";

const USAGE = "Usage: writer-check ia [--layers lexicon,strings,patterns,passages,narratives] [--format text|json]";

function textReport(report: WriterIAReport): string {
  const lines = ["Writer IA — leaf membership only; proposed membership is not owner approval."];
  for (const layer of report.layers) {
    lines.push(`\n${layer.layer}: ${layer.count} leaves [${layer.freeze.status}]`);
    const visit = (nodes: WriterNode[], depth: number): void => {
      for (const node of nodes) {
        lines.push(`${"  ".repeat(depth)}${node.label}`);
        if ("children" in node) visit(node.children, depth + 1);
        else for (const id of node.leaves) lines.push(`${"  ".repeat(depth + 1)}${id} ${JSON.stringify(layer.contracts.find(slot => slot.id === id)?.contract ?? {})}`);
      }
    };
    visit(layer.tree, 1);
  }
  for (const finding of report.findings) lines.push(`${finding.code}: ${finding.message}`);
  return lines.join("\n");
}

/** Additive subcommand with the existing clean/finding/could-not-run exit contract. */
export function mainWriterIA(argv: string[], io: { stdout(value: string): void; stderr(value: string): void } = { stdout: console.log, stderr: console.error }, load = loadWriterCatalog): number {
  try {
    let layers: readonly WriterLayer[] = WRITER_LAYERS, format = "text";
    const seen = new Set<string>();
    for (let index = 0; index < argv.length; index++) {
      const flag = argv[index]!;
      if (flag === "--help" || flag === "-h") { io.stdout(USAGE); return 0; }
      if ((flag !== "--layers" && flag !== "--format") || seen.has(flag)) throw new Error(`unknown or duplicate option ${flag}`);
      seen.add(flag);
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
      if (flag === "--layers") {
        const requested = value.split(",");
        if (!requested.every(isWriterLayer) || new Set(requested).size !== requested.length) throw new Error("layers must be distinct Writer layer names");
        layers = requested;
      } else {
        if (value !== "text" && value !== "json") throw new Error("format must be text or json");
        format = value;
      }
    }
    const report = createWriterIAReport(load(), layers);
    io.stdout(format === "json" ? JSON.stringify(report, null, 2) : textReport(report));
    return report.findings.length ? 1 : 0;
  } catch (error) {
    io.stderr(`writer-check ia: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
