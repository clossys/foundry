# components.icon (shadcn@aria, rule derive:icon@1)

`components/icon/icon.tsx` is authored by Foundry under the MIT licence. It renders an
icon the way stock shadcn renders Lucide icons: a 24px viewBox, a 2px `currentColor`
stroke and a `size-4` class by default. A lucide-react icon component passed as the
glyph renders as itself (lucide-react, ISC licence, https://lucide.dev/license).

It ships no glyph data. The consumer's selected assets supply each glyph through the
generated `components/icon/index.ts` adapter. Lucide glyph data is published under the
ISC licence (https://lucide.dev/license).
