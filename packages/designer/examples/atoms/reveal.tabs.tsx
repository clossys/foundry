import { Tabs } from "@clossys/designer/atoms";

function PromptSections() {
  return (
    <Tabs>
      <Tabs.List aria-label="Prompt sections">
        <Tabs.Tab id="details">Details</Tabs.Tab>
        <Tabs.Tab id="history">History</Tabs.Tab>
        <Tabs.Tab id="settings" isDisabled>
          Settings
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel id="details">Details content.</Tabs.Panel>
      <Tabs.Panel id="history">History content.</Tabs.Panel>
      <Tabs.Panel id="settings">Settings content.</Tabs.Panel>
    </Tabs>
  );
}

export default PromptSections;
