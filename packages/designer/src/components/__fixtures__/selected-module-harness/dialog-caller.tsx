export const dialogCaller = String.raw`
import { useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { LibraryProvider } from "../component-index.js";
import { Button } from "../components/button/index.js";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "../components/dialog/index.js";
declare global { interface Window { callerEvents: unknown[] } }
window.callerEvents = [];
function Caller() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  return <LibraryProvider><main><Button onPress={() => setOpen(true)}>Open command</Button>
    <Dialog isOpen={open} isDismissable showCloseButton={false} ref={ref}
      aria-describedby="command-description" onOpenChange={(value: boolean) => { setOpen(value); window.callerEvents.push({ event: "open", open: value }); }}>
      <DialogHeader><DialogTitle>Command</DialogTitle><DialogDescription id="command-description">Choose an action.</DialogDescription></DialogHeader>
      <Button slot="close">Dismiss command</Button>
    </Dialog>
  </main></LibraryProvider>;
}
createRoot(document.getElementById("root")!).render(<Caller />);
`;
