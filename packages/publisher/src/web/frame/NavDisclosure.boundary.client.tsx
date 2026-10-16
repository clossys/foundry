"use client";

// RSC bundlers retain this client boundary. Its browser build selects the
// interactive implementation; raw react-server imports select the SSR shape.
export { SiteNavDisclosure } from "#publisher-frame-navigation";
