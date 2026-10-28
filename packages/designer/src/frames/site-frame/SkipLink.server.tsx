import { SkipLink } from "../../shell/SkipLink.js";

/** Initial skip markup; focus handling and ground observation belong to the client island. */
export function SiteSkipLink({ targetId, label }: { readonly targetId: string; readonly label: string; readonly followHeaderGround?: boolean }) {
  return <SkipLink targetId={targetId}>{label}</SkipLink>;
}
