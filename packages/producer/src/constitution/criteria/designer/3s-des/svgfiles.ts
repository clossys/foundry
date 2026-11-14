/**
 * asset.svg-files: the drawing files of a glyph or logo candidate (every `.svg` in its registry
 * files) each pass the core SVG criteria: a valid viewBox (square at `params.size` when set), paints
 * that follow light and dark, legibility at the smallest use and no raster.
 */
import { isRecord } from "../../core/lib.js";
import { noRaster, smallSize, svgModes, svgViewbox } from "../../core/svg.js";
import type { Criterion, Params } from "../../core/types.js";
import { filesOf } from "./lib.js";

const sub = (params: Params, key: string): Params => isRecord(params[key]) ? params[key] as Params : {};

/**
 * asset.svg-files: at least one `.svg` file; each passes svg.viewbox (`params.viewbox`), svg.modes
 * (`params.modes`), render.small-size (`params.smallSize`, skipped when false) and svg.no-raster.
 */
export const assetSvgFiles: Criterion = (subject, params) => {
  const files = filesOf(subject).filter(file => file.path.toLowerCase().endsWith(".svg"));
  if (!files.length) return ["no .svg drawing among the candidate's files"];
  const failures: string[] = [];
  for (const file of files) {
    const svg = { kind: subject.kind, text: file.content };
    const found = [
      ...svgViewbox(svg, sub(params, "viewbox")),
      ...svgModes(svg, sub(params, "modes")),
      ...(params.smallSize === false ? [] : smallSize(svg, sub(params, "smallSize"))),
      ...noRaster(svg, {}),
    ];
    failures.push(...found.map(message => `${file.path}: ${message}`));
  }
  return failures;
};
