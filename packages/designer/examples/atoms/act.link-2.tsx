import { Link } from "@clossys/designer/atoms";
function RouterLink({ to, children }: (React.ComponentProps<"a"> | React.ComponentProps<"span">) & { to: string }) { return <a href={to}>{children}</a>; }

export default function Example() { return <>
<Link href="/prompts" render={(props) => <RouterLink {...props} to="/prompts" />}>
  Prompts
</Link>
</>; }
