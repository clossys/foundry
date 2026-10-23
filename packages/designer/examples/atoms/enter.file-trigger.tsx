const handleFiles = (_files: FileList | null): void => {};

import { FileTrigger, Button } from "@clossys/designer/atoms";

function AttachmentPicker() {
  return (
    <FileTrigger acceptedFileTypes={["image/png", "image/jpeg"]} onSelect={(files) => handleFiles(files)}>
      <Button variant="secondary">Choose photo</Button>
    </FileTrigger>
  );
}

export default AttachmentPicker;
