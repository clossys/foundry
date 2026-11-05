import { createRoot } from "react-dom/client";
import { PublisherInstancesView } from "../PublisherInstancesView.js";
import { FIXTURE_BREAKPOINTS, FIXTURE_INSTANCE_LIBRARY, FIXTURE_INSTANCE_REGISTRIES, STANDARD_INSTANCE_FIXTURES } from "./standard-instances.js";

createRoot(document.getElementById("root")!).render(<div className="bg-surface-base p-lg text-ink-primary">
  <header className="mb-lg"><h1>Publisher · Instances first look</h1><p>Fixture-only v2 assemblies from the Standard inventory. Frame/section registration unavailable; empty fixture library. No consumer adoption, real pages, or publication readiness claimed.</p></header>
  <PublisherInstancesView instances={STANDARD_INSTANCE_FIXTURES} library={FIXTURE_INSTANCE_LIBRARY} registries={FIXTURE_INSTANCE_REGISTRIES}
    breakpointValues={FIXTURE_BREAKPOINTS} designerHref="https://github.com/clossys/foundry/tree/main/packages/designer" packLabels={{ "pack.standard-website": "Standard website" }} />
</div>);
