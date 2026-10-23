import { Banner } from "@clossys/designer/atoms";

function TrialEndingBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Banner variant="warning" onDismiss={onDismiss}>
      Your trial ends in 3 days.
    </Banner>
  );
}

export default TrialEndingBanner;
export const smokeProps = { onDismiss: (): void => {} } satisfies React.ComponentProps<typeof TrialEndingBanner>;
