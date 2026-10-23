import { ThemeProvider, useTheme } from "@clossys/designer/theme";

function CurrentThemeLabel() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  return (
    <button onClick={() => setPreference("dark")}>
      {preference} (showing {resolvedTheme})
    </button>
  );
}

export default function Example() { return <ThemeProvider><CurrentThemeLabel /></ThemeProvider>; }
