import { ThemeProvider } from "@clossys/designer/theme";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
export const smokeProps = { children: <p>Page content.</p> } satisfies React.ComponentProps<typeof RootLayout>;
