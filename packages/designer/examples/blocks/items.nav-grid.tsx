const openInviteDialog = (): void => {};

import { NavGrid } from "@clossys/designer/blocks";

function SettingsHub() {
  return (
    <NavGrid
      heading="Settings"
      items={[
        { id: "billing", title: "Billing", description: "Plan and invoices.", href: "/settings/billing" },
        { id: "invite", title: "Invite teammates", onSelect: () => openInviteDialog() },
      ]}
    />
  );
}

export default SettingsHub;
