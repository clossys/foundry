/** Browser forms use immutable package defaults, not consumer approval records. */
import { resolveFrontDoorCopy } from "@clossys/writer/front-door";
import { createSignInForm } from "./views/internal/createSignInForm.js";
import { createActivateForm } from "./views/internal/createActivateForm.js";
import { createResetForm } from "./views/internal/createResetForm.js";
export const SignInForm = createSignInForm(resolveFrontDoorCopy);
export type { SignInFailure, SignInResult, SignInFormProps } from "./views/internal/createSignInForm.js";
export const ActivateForm = createActivateForm(resolveFrontDoorCopy);
export type { ActivateFailure, ActivateResult, ActivateDetails, ActivateFormProps } from "./views/internal/createActivateForm.js";
export const ResetForm = createResetForm(resolveFrontDoorCopy);
export type { ResetFailure, ResetResult, ResetDetails, ResetFormProps } from "./views/internal/createResetForm.js";
export { AuthView } from "./views/AuthView.js";
export type { AuthViewProps } from "./views/AuthView.js";
export { BoundaryView } from "./views/BoundaryView.js";
export type { BoundaryViewProps } from "./views/BoundaryView.js";
export { StatusView } from "./views/StatusView.js";
export type { StatusViewProps } from "./views/StatusView.js";
export { PageView } from "./views/PageView.js";
export type { PageViewProps } from "./views/PageView.js";

export { constructionStatusProps } from "./views/constructionStatus.js";
export type { ConstructionStatusInput } from "./views/constructionStatus.js";

export { ContactForm } from "./views/ContactForm.js";
export type { ContactFormCopy, ContactFormDevPreview, ContactFormProps, ContactFormTopic, ContactFormValues } from "./views/ContactForm.js";

export { AppFrame } from "./frame/AppFrame.js";
export type { AppFrameProps, AppFrameBrand, AppFrameAccount, AppFrameRightPanel } from "./frame/app-frame-types.js";
export { APP_FRAME_CONTRACT, APP_FRAME_CONFIG_SCHEMA } from "./frame/app-frame-contract.js";
export { AppFrameSpecimen } from "./frame/AppFrame.specimen.js";

export { IndexView } from "./views/IndexView.js";
export type { IndexViewCollection, IndexViewProps, IndexViewRowRoute, IndexViewTable } from "./views/IndexView.js";
export { DetailsView } from "./views/DetailsView.js";
export type { DetailsViewBlock, DetailsViewLayout, DetailsViewProps, DetailsViewRegion, DetailsViewSection, DetailsViewSectionState, DetailsViewTab } from "./views/DetailsView.js";
