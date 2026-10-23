import { Dialog } from "@clossys/designer/atoms";
import { Button } from "@clossys/designer/atoms";

function SettingsDialog() {
  return (
    <Dialog trigger={<Button variant="secondary">Settings</Button>}>
      <Dialog.Heading>Settings</Dialog.Heading>
      <p>Configure your workspace preferences here.</p>
    </Dialog>
  );
}

export default SettingsDialog;
