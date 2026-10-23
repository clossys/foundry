import { AppFrameSpecimen } from "@clossys/publisher/web/client";

export default function Example() {
  return (<>
<AppFrameSpecimen
  commandTriggerLabel="Find a destination"
  completeTaskLabel="Mark example task complete"
  taskCompletedMessage="The example task is complete."
  routeOpenedLabel="selected"
/>
</>);
}
