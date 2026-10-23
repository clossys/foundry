import { Skeleton } from "@clossys/designer/atoms";

function LoadingPromptCard() {
  return (
    <div className="flex flex-col gap-sm">
      <Skeleton shape="circle" className="h-10 w-10" aria-label="Loading prompt" />
      <Skeleton shape="text" />
      <Skeleton shape="block" className="h-24" />
    </div>
  );
}

export default LoadingPromptCard;
