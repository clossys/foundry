"use client";

import { useEffect, type HTMLAttributes } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { cx } from "./internal/cx.js";
import { richTextDocument, richTextExtensions, type RichTextValue } from "./rich-text/schema.js";
import { renderRichTextNode, RICH_TEXT_CLASSES } from "./rich-text/document.js";

export type { RichTextValue } from "./rich-text/schema.js";
export interface RichTextProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "onChange"> {
  value: RichTextValue;
  /** Studio always passes true. Read-only content renders during SSR. @default true */
  readOnly?: boolean;
  onChange?: (value: JSONContent) => void;
}

function EditableRichText({ value, onChange, "aria-label": label, "aria-labelledby": labelledBy }: RichTextProps) {
  const editor = useEditor({
    extensions: richTextExtensions,
    content: richTextDocument(value),
    immediatelyRender: false,
    editorProps: { attributes: { role: "textbox", "aria-multiline": "true", ...(label ? { "aria-label": label } : {}), ...(labelledBy ? { "aria-labelledby": labelledBy } : {}) } },
    onUpdate: ({ editor }) => onChange?.(editor.getJSON()),
  });
  useEffect(() => {
    const next = richTextDocument(value);
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);
  return <EditorContent editor={editor} />;
}

/**
 * Shared document surface, with no toolbar or editing affordance in read-only
 * mode. The per-component Aria gap is intentional: React Aria has no rich-text
 * editor; only MIT Tiptap/ProseMirror packages supply its document engine.
 */
export function RichText({ value, readOnly = true, onChange, className, ...rest }: RichTextProps) {
  return <div {...rest} data-ds-layer="components" data-ds-leaf="components.rich-text" data-ds-fill="shadcn@aria/components.rich-text" data-slot="rich-text" data-readonly={readOnly ? "true" : "false"} className={cx(RICH_TEXT_CLASSES, className)}>
    {readOnly ? renderRichTextNode(richTextDocument(value)) : <EditableRichText value={value} onChange={onChange} aria-label={rest["aria-label"]} aria-labelledby={rest["aria-labelledby"]} />}
  </div>;
}
