// Compile-only public API checks; consent is explicit and closed.
import {createExistingDeclarationAdoptions, planApplyBundle} from "./index.js";
import type {AdvisorPlan} from "./plan-contract.js";
import type {RepositoryObservation} from "./plan-bundle.js";
declare const observation: RepositoryObservation;
declare const plan: AdvisorPlan;
const rows=createExistingDeclarationAdoptions(observation,plan,["@clossys/writer"],"adopt-existing-declaration");
// @ts-expect-error no implied consent
createExistingDeclarationAdoptions(observation,plan,["@clossys/writer"]);
// @ts-expect-error arbitrary approval claims are not adoption consent
createExistingDeclarationAdoptions(observation,plan,["@clossys/writer"],"approved");
void rows; void planApplyBundle;
