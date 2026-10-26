import type { AppInventoryProjection, AppPageBindingInput, AppSubrowBindingInput, AppPipelineMessages, PublisherPageProps } from "../../index.js";

type Assert<T extends true> = T;
/** Public host types are reachable through the existing web entry point. */
export type AppHostContract = [
  Assert<AppInventoryProjection["schemaVersion"] extends 2 ? true : false>,
  Assert<readonly AppPageBindingInput[] extends NonNullable<PublisherPageProps["appPageBindings"]> ? true : false>,
  Assert<readonly AppSubrowBindingInput[] extends NonNullable<PublisherPageProps["appSubrowBindings"]> ? true : false>,
  Assert<Partial<AppPipelineMessages> extends NonNullable<PublisherPageProps["appPipelineMessages"]> ? true : false>,
];
