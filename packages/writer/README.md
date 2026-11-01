# @clossys/writer
Voice, copy, glossary, claims, and language-validation contracts.

Install: `npm install @clossys/writer --registry=https://registry.npmjs.org` (no authentication).
[Documentation](https://clossys.com/docs/writer) · [Changelog](https://github.com/clossys/foundry/blob/main/docs/changelogs/writer.md) · [License](./LICENSE)

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
