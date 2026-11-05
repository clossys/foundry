// Installed by Publisher (clossys publish --install --next). Reinstall rather than editing this file.
// Fixture: a hand-written root layout under a copied Publisher marker. route-parity reports it as
// route-drift (a fresh install writes other bytes) and routes-published as shell-unpublished.
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (<html lang="en"><body className="min-h-svh">{children}</body></html>);
}
