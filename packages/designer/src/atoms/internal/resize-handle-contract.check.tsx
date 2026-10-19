import { ResizeHandle } from "../ResizeHandle.js";

const dimensions = { value: 180, min: 100, max: 300, resetValue: 180, onChange: (_value: number) => {} };
export const named = <ResizeHandle {...dimensions} label="Resize tools" orientation="vertical" dir="rtl" />;
// @ts-expect-error An interactive separator requires its authored accessible name.
export const unnamed = <ResizeHandle {...dimensions} />;
// @ts-expect-error The separator semantics cannot be replaced with another role.
export const wrongRole = <ResizeHandle {...dimensions} label="Resize tools" role="button" />;
// @ts-expect-error A separator's orientation is bounded, independently of its resize direction.
export const wrongAxis = <ResizeHandle {...dimensions} label="Resize tools" orientation="inline" />;
// @ts-expect-error Value changes must be observed by the owner of this controlled Atom.
export const noOwner = <ResizeHandle value={180} min={100} max={300} resetValue={180} label="Resize tools" />;
