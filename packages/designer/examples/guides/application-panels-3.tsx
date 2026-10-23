import { ResizablePane } from "@clossys/designer/blocks";

export function Inspector({ width, onWidthChange }: { width: number; onWidthChange: (width: number) => void }) {
  return (
    <ResizablePane min={240} max={560} defaultValue={320} value={width}
      onChange={onWidthChange} label="Inspector" handleLabel="Resize inspector">
      <p>Selection details</p>
    </ResizablePane>
  );
}

export default Inspector;
export const smokeProps = { width: 320, onWidthChange: (_width: number): void => {} } satisfies React.ComponentProps<typeof Inspector>;
