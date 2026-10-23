import { ThemeProvider } from "@clossys/designer/theme";

import { useTheme } from "@clossys/designer/theme";

function CurrentThemeLabel() {
  const { preference, resolvedTheme } = useTheme();
  return <span>{preference} ({resolvedTheme})</span>;
}

export default function Example() { return <ThemeProvider><CurrentThemeLabel /></ThemeProvider>; }
