import { ProgressBar } from "@clossys/designer/atoms";

function UploadProgress({ percentComplete }: { percentComplete: number }) {
  return <ProgressBar label="Uploading" value={percentComplete} />;
}

function ProcessingIndicator() {
  return <ProgressBar label="Processing" isIndeterminate />;
}

export default function Example() { return <><UploadProgress percentComplete={42} /><ProcessingIndicator /></>; }
