import { studioNavigation } from '../lib/studio-route-map';

export default function RootLayout({ children }: { children: unknown }) {
  return <html><body data-nav={studioNavigation.length}>{children as never}</body></html>;
}
