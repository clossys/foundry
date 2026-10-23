// Your Next.js app's root layout (the "layout.tsx" file in the App
// Router's "app" directory) — first thing in <head>
import { getThemeInitScript } from "@clossys/designer/theme";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
export const smokeProps = { children: <p>Page content.</p> } satisfies React.ComponentProps<typeof RootLayout>;
