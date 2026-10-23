import { ConsentBanner } from "@clossys/designer/blocks";
import { Link } from "@clossys/designer/atoms";

function PageConsent({ onAccept, onReject, status }: { onAccept: () => void; onReject: () => void; status?: string }) {
  return (
    <ConsentBanner
      title="Banner title"
      body="Banner body text."
      acceptLabel="Accept label"
      rejectLabel="Reject label"
      onAccept={onAccept}
      onReject={onReject}
      privacyLink={<Link href="/privacy">Privacy link</Link>}
      status={status}
    />
  );
}

export default PageConsent;
export const smokeProps = { onAccept: (): void => {}, onReject: (): void => {}, status: "Your preference is saved." } satisfies React.ComponentProps<typeof PageConsent>;
