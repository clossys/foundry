/** Copied verbatim as the host entry; imports deliberately target emitted leaf facades. */
export const calendarCaller = String.raw`
import { useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { LibraryProvider } from "../component-index.js";
import { Calendar } from "../components/calendar/index.js";
import { Select } from "../components/select/index.js";
import { SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "../components/select/index.js";
declare global { interface Window { callerEvents: unknown[] } }
window.callerEvents = [];
function Caller() {
  const [selectedKey, setSelectedKey] = useState<string | number>(1);
  const ref = useRef<HTMLDivElement>(null);
  return <LibraryProvider><main>
    <Select aria-label="Month" selectedKey={selectedKey} disabledKeys={[3]} ref={ref}
      onSelectionChange={(key: string | number | null) => { if (key !== null) setSelectedKey(key); window.callerEvents.push({ event: "selection", key, keyType: typeof key }); }}
      onOpenChange={(open: boolean) => window.callerEvents.push({ event: "open", open })}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup aria-label="Months">
        <SelectItem id={1} textValue="January">January</SelectItem>
        <SelectItem id="2" textValue="February">February</SelectItem>
        <SelectItem id={3} textValue="March">March</SelectItem>
      </SelectGroup></SelectContent>
    </Select>
    <section aria-label="Single calendar"><Calendar selection="single" aria-label="Date" /></section>
    <section aria-label="Range calendar"><Calendar selection="range" aria-label="Range" /></section>
  </main></LibraryProvider>;
}
createRoot(document.getElementById("root")!).render(<Caller />);
`;
