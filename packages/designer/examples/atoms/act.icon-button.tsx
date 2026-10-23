import { IconButton } from "@clossys/designer/atoms";
import { ChevronRight } from "@clossys/designer/icons";

function NextSlide({ onNext }: { onNext: () => void }) {
  return <IconButton icon={ChevronRight} label="Next slide" onPress={onNext} />;
}

export default NextSlide;
export const smokeProps = { onNext: (): void => {} } satisfies React.ComponentProps<typeof NextSlide>;
