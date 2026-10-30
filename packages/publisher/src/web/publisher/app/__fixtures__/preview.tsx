import { publisherCopyFixtureResolver } from "../../__fixtures__/writer-copy.js";
import { createRoot } from "react-dom/client";
import { PublisherPage } from "../../PublisherPage.js";
import type { AppInventory } from "../inventory.js";
import { FIXTURE_BREAKPOINTS, FIXTURE_INSTANCE_LIBRARY, FIXTURE_INSTANCE_REGISTRIES, STANDARD_INSTANCE_FIXTURES } from "../../../instances/__fixtures__/standard-instances.js";
declare const __PUBLISHER_APP_INVENTORY__: AppInventory;
createRoot(document.getElementById("root")!).render(<main className="bg-surface-base p-lg text-ink-primary"><PublisherPage copyResolver={publisherCopyFixtureResolver} instances={STANDARD_INSTANCE_FIXTURES} library={FIXTURE_INSTANCE_LIBRARY} registries={FIXTURE_INSTANCE_REGISTRIES} breakpointValues={FIXTURE_BREAKPOINTS} designerHref="/designer" appInventory={__PUBLISHER_APP_INVENTORY__} fixtureLibrary /></main>);
