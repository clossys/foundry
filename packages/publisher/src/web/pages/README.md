# Scroll admin page records

Import the builders from `@clossys/publisher/web/registered-route`. The six
canonical routes use `composition.binding`; existing complete-route exports
remain compatibility APIs. New routes never import the retired bodies.

`createAdminPageRegistry({ publication, copy, manifests, sources?, itemL0?, itemTitles? })`
returns `{ registry, pages, manifests }`. `publication` is the consumer's selected
`PublicationBinding`, including `context.consumer`, frame, layout and mainSlot.
Mount its Designer frame once. `pages.designer`, `pages.writer` and
`pages.publisher` each contain `list`, `item`, `manifest`, `itemManifest` and
`query`. The individual factories are `createDesignerPageRecords`,
`createWriterPageRecords` and `createPublisherPageRecords`.

`copy(alias, args?)` resolves and formats W1's `strings.admin.*` aliases in the
consumer locale. `args` is a readonly string/number record; the synchronous
stat helper passes `{count}` to W1's plural message and uses the complete result.
Each skeleton is `{ l0: [{ id, label, count, estimate, partition?, l1:
[{ id, label, count, estimate, l2: [{ id, label, count, estimate }] }] }] }`.
Labels must come from W1; counts, estimates, records and formatted dates belong
to the consumer. `partition: "l1"` chunks large layers per band.

Provide `adminPageStaticContent(kind, skeleton, copy)` synchronously through the
runtime's content resolver before requesting any chunk. It supplies native L0
headers, stats, table columns and the outline label; the cold page can render its
outline while bands remain unloaded. `adminPageRef(kind, name, type?)` constructs
`{ kind: type ?? "records", ref: "admin.<kind>/<name>" }`.

The `chunk({l0,l1?})` loader returns current, hashed `RuntimeContent` rows:

- `<l0>/<l1>/band` is a records ref with one `{ id: l1, references }` row.
  Its references replace `admin.<kind>/band.heading` (copy containing `{text,id}`),
  `admin.<kind>/band.stats` (records), and `admin.<kind>/cards` (records).
- Each cards row is `{ id: l2, references }`. References replace
  `admin.<kind>/card.header` (copy), `card.rows` (records), and
  `card.pagination` (region). Selection is the existing host callback; the
  optional selection content is absent until selected.
- A card header carries `{heading, level:4, id:"<l0>--<l1>--<l2>", count}`.
  Pagination carries W1-resolved `showAll`, `label`, `previous`, `next`, `summary`
  and `noResults`. The existing table owns collapse at ten and pages of 100.
  For example, format Show all with
  `copy("strings.admin.action.showAll", {count: rows.length})`.
- An empty L0 requests `<l0>/empty` (copy with W1-resolved heading/description).
  Its frame and L0 heading remain in place.

All refs returned by loaders are static `{kind,ref}` refs, with
`hash: runtimeHash(value)`. Consumer rows provide primary item `href`, status
`{label,tone}`, relative/absolute dates and preview ids. Supply Designer's
`renderPreview` through the existing data-table Section host. Row selection uses
the page session's chat port; search uses `query` and the persistent frame's
command dispatcher.

For `/agents/<kind>/[l0]/[id]`, set `itemL0[kind]` to the concrete parameter when
building records and use `pages[kind].itemManifest`. For real adoption also
supply the resolved item name as `itemTitles[kind]` (or `itemTitle` to an
individual factory). It ends the frame trail, names the
record, and labels the selected outline entry. Omitting it preserves the page
title for compatibility. The `item(l0,id)` loader
returns `{record,content}` or `undefined` for the frame's not-found state. Its
content supplies `item/heading` (copy `{text,id}`), `item/stats`, `item/fields`,
`item/status` (copy), and `item/context`; each table (`preview`, `locales`,
`sections`, `releases`, as applicable) supplies `item/<table>/{header,columns,
rows,pagination}` with the same types as list tables. The inspector
context changes while the publication's shared `sections.chat` remains mounted.

Register the consumer's actual entry/source/runtime modules through `sources`.
The default module identities are examples, not installed consumer files or
source qualification evidence. The consumer's existing runtime still supplies
its selected library, manifests, CSS, source closure and frame adapter.

The page builder does not waive runtime coverage or content gates. In the D1
preview contract, native empty chat/rows, empty-state members, flow support for
band/header, and extended card header anatomy still need their actual Designer
contract/runtime support. Fixture declarations in the Publisher tests isolate
the page binder and do not claim real-catalog qualification for these gaps.
