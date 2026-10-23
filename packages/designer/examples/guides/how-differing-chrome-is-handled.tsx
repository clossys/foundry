import { Shell } from "@clossys/designer/shell";
const children: React.ReactNode = <p>Page content.</p>;
const MarketingNav = () => <nav aria-label="Marketing">Marketing</nav>;
const MemberAccountControl = () => <button>Account</button>;
const MemberNav = () => <nav aria-label="Member">Member</nav>;
const StaffToolbar = () => <header>Staff actions</header>;
const StaffNav = () => <nav aria-label="Staff">Staff</nav>;
const AuditLog = () => <aside>Audit log</aside>;

// app/(marketing)/layout.tsx
export default function Example() { return <>
<Shell>
  <Shell.Header><MarketingNav /></Shell.Header>
  <Shell.Main>{children}</Shell.Main>
</Shell>

{/* app/(member)/layout.tsx */}
<Shell>
  <Shell.Header><MemberAccountControl /></Shell.Header>
  <Shell.SideNav><MemberNav /></Shell.SideNav>
  <Shell.Main>{children}</Shell.Main>
</Shell>

{/* app/(staff)/layout.tsx */}
<Shell>
  <Shell.Header><StaffToolbar /></Shell.Header>
  <Shell.SideNav><StaffNav /></Shell.SideNav>
  <Shell.Main>{children}</Shell.Main>
  <Shell.Rail><AuditLog /></Shell.Rail>
</Shell>
</>; }
