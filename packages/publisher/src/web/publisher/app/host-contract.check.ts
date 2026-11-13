import type { AppInventoryProjection, AppPageBindingInput, AppSubrowBindingInput, AppPipelineMessages } from "../../index.js";
import type { PublisherPageProps } from "../PublisherPage.js";

type Assert<T extends true> = T;
/** Public app host types remain compatible with the internal page inputs. */
export type AppHostContract = [
  Assert<AppInventoryProjection["schemaVersion"] extends 2 ? true : false>,
  Assert<readonly AppPageBindingInput[] extends NonNullable<PublisherPageProps["appPageBindings"]> ? true : false>,
  Assert<readonly AppSubrowBindingInput[] extends NonNullable<PublisherPageProps["appSubrowBindings"]> ? true : false>,
  Assert<Partial<AppPipelineMessages> extends NonNullable<PublisherPageProps["appPipelineMessages"]> ? true : false>,
];
