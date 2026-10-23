import { Panel, Drawer, ResizablePane } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

export function WorkspaceTools() {
  return (
    <Panel header="Workspace" footer="Supporting information">
      <Drawer heading="Tools" closeLabel="Close tools" trigger={<Button>Tools</Button>}>
        <ResizablePane min={120} max={480} defaultValue={240}
          label="Tool details" handleLabel="Resize tool details">
          <p>Selected tool details</p>
        </ResizablePane>
      </Drawer>
    </Panel>
  );
}

export default WorkspaceTools;
