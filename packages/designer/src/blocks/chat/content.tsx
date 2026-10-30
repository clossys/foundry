import { Fragment, useState, type ReactNode } from "react";
import { Button } from "../../components/Button.js";
import { Link } from "../../components/Link.js";
import type { ChatLabels } from "./types.js";

interface InlinePart { text: string; isCode: boolean }

/** Index each possible ending once, so malformed starts never rescan a suffix. */
function inlineParts(text: string): InlinePart[] {
  const length = text.length;
  const bracket = new Uint32Array(length + 1);
  const tick = new Uint32Array(length + 1);
  const urlBoundary = new Uint32Array(length + 1);
  let nextBracket = length, nextTick = length, nextBoundary = length;
  bracket[length] = tick[length] = urlBoundary[length] = length;
  for (let index = length - 1; index >= 0; index--) {
    const character = text[index]!;
    if (character === "\n") nextBracket = nextTick = length;
    else {
      if (character === "]") nextBracket = index;
      if (character === "`") nextTick = index;
    }
    if (character === ")" || /\s/.test(character)) nextBoundary = index;
    bracket[index] = nextBracket;
    tick[index] = nextTick;
    urlBoundary[index] = nextBoundary;
  }
  const parts: InlinePart[] = [];
  let plainStart = 0, index = 0;
  while (index < length) {
    let end = index;
    if (text[index] === "`") {
      const close = tick[index + 1]!;
      if (close > index + 1 && close < length) end = close + 1;
    } else if (text[index] === "[") {
      const close = bracket[index + 1]!;
      if (close > index + 1 && close < length && text[close + 1] === "(") {
        const urlStart = close + 2;
        const boundary = urlBoundary[urlStart]!;
        if (boundary > urlStart && text[boundary] === ")") end = boundary + 1;
      }
    }
    if (end > index) {
      parts.push({ text: text.slice(plainStart, index), isCode: false }, { text: text.slice(index, end), isCode: text[index] === "`" });
      plainStart = index = end;
    } else index++;
  }
  parts.push({ text: text.slice(plainStart), isCode: false });
  return parts;
}

/** Deliberately small text syntax; HTML stays React-escaped text. */
function inline(text: string): ReactNode[] {
  return inlineParts(text).map(({ text: part, isCode }, index) => {
    if (isCode) {
      return <code key={index} className="rounded-subtle bg-surface-sunken px-xs font-mono text-body-s">{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    if (link && !/[\\\u0000-\u0020\u007f]/.test(link[2]!) && /^(?:https?:\/\/|mailto:|\/(?!\/)|#)/i.test(link[2]!)) {
      return <Link key={index} href={link[2]} rel="noopener noreferrer">{link[1]}</Link>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

interface CodeBlockProps extends ChatLabels { code: string }

function CodeBlock({
  code,
  /** @default "Copy code" */
  copyCodeLabel = "Copy code",
  /** @default "Copied" */
  copiedLabel = "Copied",
  /** @default "Copy unavailable" */
  copyUnavailableLabel = "Copy unavailable",
}: CodeBlockProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  return (
    <div className="min-w-0 rounded-control bg-surface-sunken p-sm">
      <div className="flex flex-wrap items-center justify-end gap-xs">
        <Button variant="ghost" size="sm" onPress={() => { void copy(); }}>{copyCodeLabel}</Button>
        <span role="status" className="text-caption text-ink-secondary">
          {copyState === "copied" ? <span>{copiedLabel}</span> : null}
          {copyState === "error" ? <span>{copyUnavailableLabel}</span> : null}
        </span>
      </div>
      <pre className="max-w-full overflow-x-auto font-mono text-code-block"><code>{code}</code></pre>
    </div>
  );
}

export function defaultContent(content: string, labels?: ChatLabels): ReactNode {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { index++; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!)) code.push(lines[index++]!);
      if (index < lines.length) index++;
      blocks.push(<CodeBlock key={blocks.length} code={code.join("\n")} {...labels} />);
      continue;
    }
    const ordered = /^\d+\.\s+/.test(line);
    if (ordered || /^[-*]\s+/.test(line)) {
      const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/;
      const items: ReactNode[] = [];
      while (index < lines.length && pattern.test(lines[index]!)) {
        items.push(<li key={items.length}>{inline(lines[index++]!.replace(pattern, ""))}</li>);
      }
      blocks.push(ordered
        ? <ol key={blocks.length} className="list-decimal ps-lg">{items}</ol>
        : <ul key={blocks.length} className="list-disc ps-lg">{items}</ul>);
      continue;
    }
    const paragraph: string[] = [line];
    index++;
    while (index < lines.length && lines[index]!.trim() && !/^(?:```|[-*]\s+|\d+\.\s+)/.test(lines[index]!)) paragraph.push(lines[index++]!);
    blocks.push(<p key={blocks.length} className="whitespace-pre-wrap">{inline(paragraph.join("\n"))}</p>);
  }
  return <div className="flex min-w-0 flex-col gap-sm">{blocks}</div>;
}
