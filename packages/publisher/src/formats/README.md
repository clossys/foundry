# Construct rendering

`prepareConstructRendering` from `@clossys/publisher/web` consumes the existing
`ContentMapConstructs` contract: slot names map to ordered `SectionFill[]`.
A construct remains its Section leaf, configuration, members and content refs.
Its stable placement key is the tuple `[slot, index]`; it introduces no leaf or
independent construct registry. Consumer page configurations can supply these
same fills when building their registered page selections.

Pass the current native `RuntimeAssemblyInput<ReactNode>` with exactly those
selections. Library adoption, manifest, source, configuration, content hashes,
required slots, CSS, breakpoints and cells still pass Designer's existing
`prepareRuntimeAssembly` gates. The adapter pins the manifest to the actual
Designer package registry and installs package callbacks itself. Caller renderer
callbacks cannot replace a Section. The prepared result records both the source
construct hash and the native runtime snapshot hash.

The library-owned format table currently supports text-only
`sections.section-header`: heading, optional eyebrow and description, copy refs,
native heading configuration, alignment and density members. Web returns the
native Designer Section nodes; `deck.16x9` produces one real SVG slide per
construct through Publisher's existing `renderSlidesDeck`. Both consume the same
native-resolved Writer reference values. Deck typography and inks resolve from
the selected consumer's emitted token properties, including the native tablet
breakpoint for display density. Array order is retained.
The existing Slides engine permits brand overrides, and retains fixed structural
typography. A selected structural typography value differing from that engine's
shipped value is refused rather than silently replaced.

Actions, stats, other Section leaves, children, repeats, lazy refs and span inputs
have no cross-format adapter yet and are refused. Missing or stale refs, foreign
cells, mismatched selections and unsupported formats also refuse. The source
data is snapshotted and output metadata is immutable.

This is a Section rendering capability. It does not admit a deck page-shell
instance or prove any delivery exporter. The existing format inventory and
`checkFormatBinding` retain their current concept and exporter status.
