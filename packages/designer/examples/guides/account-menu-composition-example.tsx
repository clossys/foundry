import { AccountMenu } from "@clossys/designer/blocks";

export function AccountControl() {
  return <AccountMenu actor={{ name: "Alex Morgan" }} contextLabel="Workspace"
    sections={[{ id: "account", label: "Account", entries: [
      { id: "settings", kind: "link", label: "Settings", href: "/settings" },
    ] }]} />;
}

export default AccountControl;
