import { ThemeProvider } from "@clossys/designer/theme";

import { ThemeToggle } from "@clossys/designer/theme";

function HeaderActions() {
  return <ThemeToggle />;
}

export default function Example() { return <ThemeProvider><HeaderActions /></ThemeProvider>; }
