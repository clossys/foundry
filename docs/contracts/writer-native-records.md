# Writer native records

`parseWriterSlotBody(body, locales)` is available from `@clossys/writer/slot-body`
and the root export. It accepts the native candidate body directly:

````ts
import { parseWriterSlotBody } from "@clossys/writer/slot-body";

const rows = parseWriterSlotBody(`## en
### example.hero.title
<!-- {"id":"title-1","bindings":["hero.title"],"limits":{"maxChars":60}} -->
Choose your next step

`, ["en"]);
// [{ locale: "en", record: { id: "title-1", context: "example.hero.title",
//    limits: { maxChars: 60 }, text: "Choose your next step" },
//    bindings: ["hero.title"] }]
````

The result is an array in source order. Each row contains `locale`, `record`
(string `id`, heading `context`, optional `text`, and unknown metadata), and
`bindings`. Bindings preserve both nonempty string paths and opaque JSON objects,
including their fields and order; omitted bindings become an empty array.
Locale sections must match the supplied unique locale tags in order. Record ids
must be unique within each locale; contexts need not be unique.

Record metadata is one JSON object in a one-line `<!-- {...} -->` comment directly
after `### context`. It needs a nonempty string `id` and cannot contain `context`
or `text`. Text uses LF line breaks (CRLF input is normalized). A final line
terminator is removed, then exactly one trailing separator blank line per text
record is removed. Other blank lines and spaces are retained. Prefix lines
starting with `#`, `<!--`, a backslash, or an opening JSON fence
with a backslash; parsing removes one leading backslash from each escaped line.
Unescaped structural text is rejected.

A textless record instead uses a fenced JSON object: three backticks followed
by `json` to open, and three backticks to close. Its `id` and `context`
must match metadata and heading, and it cannot have `text`. Metadata fields and
payload fields are both retained; overlapping fields must have equal JSON values.
If the payload itself has `bindings`, that field is retained in `record` and must
agree with the row's metadata bindings (or an empty array when omitted).

Malformed structures throw `WriterSlotBodyParseError` with a 1-based body `line`;
the parser never returns partial records. It does not read files or validate
candidate frontmatter, slot schemas, binding targets, approval, activation,
pins, hashes, selection, or source authority. Those checks belong to callers.
The legacy `parseWriterCell` contract is unchanged.

Native alias and section declarations are authored separately in
`declarations.json` at the native Writer root. This is control metadata, with
no copy records or inferred mappings:

```json
{
  "schema": "clossys.writer-declarations/1",
  "locales": {
    "en": {
      "aliases": { "example.title": "title-1" },
      "sections": [{
        "sectionId": "sections.hero",
        "configId": "ground.base",
        "passageAlias": "ps.example.hero",
        "fields": [{
          "key": "header.heading",
          "locale": "en",
          "source": "writer",
          "ref": { "id": "title-1" }
        }]
      }]
    }
  }
}
```

```ts
import { parseWriterDeclarations, projectWriterDeclarations } from "@clossys/writer/declarations";

const declarations = parseWriterDeclarations(declarationsJsonText);
const selected = projectWriterDeclarations(declarations, "en", {
  completeRecords: nativeRows, // optional; caller asserts this is the complete selected set
});
// selected.aliases and selected.sections can accompany the actual native records.
```

Both functions and their types are also root exports. Parsing requires the
schema tag and at least one explicit locale, each with an `aliases` object and
`sections` array. Missing source, locale, or maps raise
`WriterDeclarationsParseError` with a JSON Pointer `path`; authored empty
`aliases: {}` and `sections: []` are valid. No fallback locale is chosen.
Duplicate JSON keys, repeated sectionId/configId pairs, and repeated field keys
are rejected. Alias and metadata keys such as `__proto__`, `constructor`, and
`prototype` remain own data properties; projection does not assign them into
object prototypes.

Aliases explicitly map nonempty names to record ids. Each section explicitly
names `sectionId`, `configId`, and `fields` (including empty arrays). Fields
require `key` and `ref.id`. Optional `field.locale` must equal its containing
locale. `source` and `passageAlias` are opaque nonempty strings when present;
the parser does not infer links from either. Unknown JSON metadata at every
level is retained, including section/field/ref extras, with array order intact.
Pass the parsed document to projection, rather than an arbitrary JavaScript
object. Projection returns a fresh copy of the selected locale declaration,
preserving parsed values and array order through structured cloning.

Without `completeRecords`, external alias and field target ids are preserved
without asserting they resolve. With it, projection rejects missing target ids
and conflicting record identities within the selected locale. Row bindings are
opaque and are never turned into section mappings; record contexts never
generate aliases. Top-level metadata remains available on the parsed document.

The caller reads this file and owns native selection, pins, hashes, source
authority, approval, and activation. A format-valid declaration does not prove
those properties. The public fixtures establish the declaration shape; they do
not provide a consumer's native declarations. Keep legacy declarations until
the actual authored native file and selected records are available and checked.
