import { Drawer } from "../Drawer.js";
import { Panel } from "../Panel.js";
import { ResizablePane } from "../ResizablePane.js";
import { Button } from "../../atoms/Button.js";

export const panel = <Panel header="Tools" footer="Supporting content">Content</Panel>;
export const drawer = <Drawer heading="Tools" closeLabel="Close tools" placement="end" trigger={<Button>Tools</Button>}>Content</Drawer>;
export const sheet = <Drawer heading="Tools" closeLabel="Close tools" placement="end" wide="sheet" trigger={<Button>Tools</Button>}>Content</Drawer>;
export const controlledPane = <ResizablePane min={100} max={300} defaultValue={180} value={240} onChange={(next: number) => void next} label="Tools" handleLabel="Resize tools">Content</ResizablePane>;
export const pane = <ResizablePane min={100} max={300} defaultValue={180} label="Tools" handleLabel="Resize tools">Content</ResizablePane>;
// @ts-expect-error The Material requires explicit bounds and a reset default.
export const missingBounds = <ResizablePane label="Tools" handleLabel="Resize tools">Content</ResizablePane>;
// @ts-expect-error Every interactive resize control requires its own accessible name.
export const unnamedHandle = <ResizablePane min={100} max={300} defaultValue={180} label="Tools">Content</ResizablePane>;
// @ts-expect-error Drawer placement has exactly three supported logical edges.
export const unsupportedEdge = <Drawer heading="Tools" closeLabel="Close tools" placement="left" trigger={<Button>Tools</Button>}>Content</Drawer>;
// @ts-expect-error Wide-layout behavior has exactly two supported modes.
export const unsupportedWide = <Drawer heading="Tools" closeLabel="Close tools" wide="inline" trigger={<Button>Tools</Button>}>Content</Drawer>;
// @ts-expect-error Dismissal cannot be disabled through this Material's contract.
export const disabledDismissal = <Drawer heading="Tools" closeLabel="Close tools" isDismissable={false} trigger={<Button>Tools</Button>}>Content</Drawer>;
