import type {
  CompositionCapabilitySupply,
  CompositionDeclaration,
  CompositionEvaluation,
  CompositionEvaluationInput,
  CompositionException,
  CompositionPolicyDeclaration,
} from "./index.js";

declare const input: CompositionEvaluationInput;
declare const policy: CompositionPolicyDeclaration;
declare const exception: CompositionException;
declare const output: CompositionEvaluation;

policy satisfies CompositionDeclaration;
exception.targetDeclarationIds satisfies readonly string[];
output.resolutions satisfies readonly unknown[];

// @ts-expect-error The contract is immutable to consumers.
input.declarations.push(policy);
// @ts-expect-error Supply state and values are a closed discriminated union.
const supply: CompositionCapabilitySupply = { state: "available" };
// @ts-expect-error Selected values are output-only and immutable.
output.resolutions[0]!.selectedValue = "replacement";
