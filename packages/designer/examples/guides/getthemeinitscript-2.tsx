import { getStoredThemeInitScript, ThemeProvider } from "@clossys/designer/theme";
const children: React.ReactNode = <p>Page content.</p>;

export default function Example() { return <>
<script dangerouslySetInnerHTML={{
  __html: getStoredThemeInitScript({ defaultTheme: "light" }),
}} />
{/* Wrap the body content with the matching fallback. */}
<ThemeProvider defaultPreference="light">{children}</ThemeProvider>
</>; }
