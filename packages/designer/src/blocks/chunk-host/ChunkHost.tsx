"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from "react";

/** Prefetch distance is observer policy, not a design token or a CSS utility. */
export const CHUNK_ROOT_MARGIN = "600px 0px";
export interface ScrollChunk {
  readonly id: string;
  readonly anchors?: readonly string[];
  /** Consumer-supplied measured estimate; does not enter the token registry. */
  readonly estimate: number;
  readonly load: () => Promise<ReactNode>;
}
export interface ChunkHostHandle { navigate(anchor: string): Promise<void> }
export interface ChunkHostProps {
  readonly chunks: readonly ScrollChunk[];
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly onError?: (error: unknown, chunkId: string) => void;
}

function focusHeading(target: HTMLElement): void {
  const heading = target.matches("h1,h2,h3,h4,h5,h6") ? target : target.querySelector<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? target;
  heading.tabIndex = -1; target.scrollIntoView?.(); heading.focus({ preventScroll: true });
}

/** Frame main-region behaviour. Sections provide all loaded content; this block creates no catalog leaf. */
export const ChunkHost = forwardRef<ChunkHostHandle, ChunkHostProps>(function ChunkHost({ chunks, className, style, onError }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<ReadonlyMap<string, ReactNode>>(() => new Map());
  const promises = useRef(new Map<string, Promise<void>>());
  const pendingTarget = useRef<string | undefined>(undefined);
  const chunksRef = useRef(chunks); chunksRef.current = chunks;
  const errors = useRef(onError); errors.current = onError;
  const ids = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk.id || /[\s#]/.test(chunk.id) || ids.has(chunk.id) || !Number.isFinite(chunk.estimate) || chunk.estimate < 0) throw new TypeError("ChunkHost: unique anchor ids and finite nonnegative estimates are required");
    ids.add(chunk.id);
  }
  const load = useCallback((chunk: ScrollChunk): Promise<void> => {
    const existing = promises.current.get(chunk.id);
    if (existing) return existing;
    const promise = Promise.resolve().then(chunk.load).then(node => {
      setLoaded(previous => new Map(previous).set(chunk.id, node));
    }).catch(error => { errors.current?.(error, chunk.id); throw error; });
    promises.current.set(chunk.id, promise);
    return promise;
  }, []);
  const navigate = useCallback(async (anchor: string) => {
    const id = decodeURIComponent(anchor.replace(/^#/, ""));
    const chunk = chunksRef.current.find(candidate => candidate.id === id || candidate.anchors?.includes(id));
    if (!chunk) throw new TypeError(`ChunkHost: unknown anchor ${id}`);
    pendingTarget.current = id;
    await load(chunk);
    // Already loaded chunks do not cause another commit.
    const target = document.getElementById(id);
    if (target && !target.hasAttribute("data-chunk-placeholder")) {
      focusHeading(target); pendingTarget.current = undefined;
    }
  }, [load]);
  useImperativeHandle(ref, () => ({ navigate }), [navigate]);
  useEffect(() => {
    const id = pendingTarget.current;
    if (!id) return;
    const target = document.getElementById(id);
    if (target && !target.hasAttribute("data-chunk-placeholder")) {
      focusHeading(target); pendingTarget.current = undefined;
    }
  }, [loaded]);
  const key = chunks.map(chunk => chunk.id).join("\n");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        const chunk = chunksRef.current.find(candidate => candidate.id === entry.target.id);
        if (chunk) { observer.unobserve?.(entry.target); void load(chunk).catch(() => {}); }
      }
    }, { rootMargin: CHUNK_ROOT_MARGIN });
    root.current?.querySelectorAll("[data-chunk-placeholder]").forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [key, load]);
  useEffect(() => {
    const onHash = () => { if (window.location.hash) void navigate(window.location.hash).catch(() => {}); };
    onHash(); window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [navigate]);
  return <div ref={root} className={className} style={{ ...style, overflowAnchor: "auto" }}>
    {chunks.map(chunk => loaded.has(chunk.id)
      ? <div key={chunk.id} data-chunk={chunk.id}>{loaded.get(chunk.id)}</div>
      : <div key={chunk.id} id={chunk.id} data-chunk-placeholder="" style={{ minHeight: chunk.estimate, overflowAnchor: "none" }} />)}
  </div>;
});
