/** RAC MenuTrigger is an identified test host, not a selected public trigger alias. */
export const menuCaller = String.raw`
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MenuTrigger } from "react-aria-components";
import { LibraryProvider } from "../component-index.js";
import { Button } from "../components/button/index.js";
import { Menu, MenuGroup, MenuLabel, MenuItem } from "../components/menu/index.js";
declare global { interface Window { callerEvents: unknown[] } }
window.callerEvents = [];
function Caller() {
  const [keys, setKeys] = useState<Set<string | number>>(new Set(["one"]));
  const items = <MenuGroup><MenuLabel>Actions</MenuLabel><MenuItem id="one" textValue="First">First</MenuItem><MenuItem id={2} textValue="Second">Second</MenuItem></MenuGroup>;
  const change = (value: "all" | Set<string | number>) => { if (value !== "all") setKeys(value); window.callerEvents.push({ event: "selection", keys: value === "all" ? "all" : [...value] }); };
  return <LibraryProvider><main>
    <MenuTrigger onOpenChange={open => window.callerEvents.push({ event: "popup", open })}>
      <Button>Open actions</Button><Menu aria-label="Default popup">{items}</Menu>
    </MenuTrigger>
    <MenuTrigger><Button>Explicit popup</Button><Menu presentation="popup" aria-label="Explicit popup">{items}</Menu></MenuTrigger>
    <Menu presentation="inline" selection="multiple" selectedKeys={keys} onSelectionChange={change} aria-label="Inline actions">{items}</Menu>
  </main></LibraryProvider>;
}
createRoot(document.getElementById("root")!).render(<Caller />);
`;
