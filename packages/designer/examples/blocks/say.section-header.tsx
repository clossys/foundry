import { SectionHeader } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

function NotificationsSection() {
  return (
    <>
      <SectionHeader
        eyebrow="Beta"
        title="Notifications"
        description="Control how you're notified about activity."
        actions={<Button variant="secondary">Reset to defaults</Button>}
      />
      {/* section content */}
    </>
  );
}

export default NotificationsSection;
