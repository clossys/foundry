import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import * as strategist from "./index.js";

// Deliberately independent lists: additions and removals require a public API decision.
const runtimeExports = `
ENGAGEMENT_CONTEXT_FIELD_IDS audienceContextValue engagementContextFieldById readEngagementContext readEngagementContextFromBriefData
assessStrategyTraceabilityRate scanStrategyDirectory buildFactIndex isTracedSurfaceForm readFindings checkGrounding checkWontClaimDrift
loadCatalog validateCatalog openStrategy compileBrief validateBriefContract discoverBriefContracts
parseCell serializeCell parseRef formatRef parseSession parseFinding validateFinding validateRequest validateTree readStrategyRoot
checkCell checkCoherence completion strategyStatus validWatch blocks cellJudgeId
buildCitationIndex propose activate createRequest listRequests resolveRequest review
`.trim().split(/\s+/).sort();

const typeExports = `
ValidationIssue ValidationResult Validator
EngagementContextField EngagementContextFieldId EngagementContextRead EngagementContextSnapshot
StrategyTraceabilityRateAssessment StrategyTraceabilityRateFinding StrategyTraceabilityRateState ScanOptions ScannedFile FactIndex
FactsGateFinding FactsGateIgnored FactsGateOptions FactsGateResult FactsGateRule WontClaimFinding WontClaimResult WontClaimState
CatalogCell CatalogNode StrategyCatalog CatalogRule CatalogIssue CatalogValidationResult
Strategy StrategyInventoryReport Brief BriefCell BriefContract BriefContractDiscovery
CellId CellRef Ref Bullet Cell FormatIssue FormatResult StrategyTreeNode StrategyTree SessionLine Session Finding StrategyRequest StrategyRootIssue StrategyModel
Scope JudgeVerdict CheckOptions CheckContext CheckFinding CellFinding CoherenceFinding CellCompletion StorylineReport StatusReport CompletionReport
CitationEntry CitationIndex ScanInput ProposeOptions ActivateOptions NewRequest ReviewReport ReviewRequest
`.trim().split(/\s+/).sort();

it("pins the v2 runtime exports exactly", () => {
  expect(Object.keys(strategist).sort()).toEqual(runtimeExports);
});

it("pins the v2 type exports exactly and resolves each through the compiler", () => {
  const path = fileURLToPath(new URL("./index.ts", import.meta.url));
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const declared = source.statements.flatMap(statement =>
    ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.filter(entry => statement.isTypeOnly || entry.isTypeOnly).map(entry => entry.name.text)
      : []);
  expect(declared.sort()).toEqual(typeExports);
  const configPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, fileURLToPath(new URL("..", import.meta.url)));
  const program = ts.createProgram([path], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(program.getSourceFile(path)!);
  expect(module).toBeDefined();
  const symbols = new Map(checker.getExportsOfModule(module!).map(symbol => [symbol.name, symbol]));
  for (const name of typeExports) {
    const symbol = symbols.get(name);
    expect(symbol, name).toBeDefined();
    const target = symbol!.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol!) : symbol!;
    expect(Boolean(target.flags & ts.SymbolFlags.Type), name).toBe(true);
  }
});
