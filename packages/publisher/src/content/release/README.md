# Publication revision and release

This implementation is **unqualified WIP**. Default English single-registry
compilation, release storage and rollback have focused coverage, but the Writer
policy boundary below is incomplete. Passing local checks do not make this
release API ready for production use.

`@clossys/publisher/content/node` exports `compilePublication`,
`publicationLibraryPins`, `publicationLayoutPin`, `prepareContentRelease`,
`writeContentRelease`, `selectContentRelease` and `rollbackContentRelease`.
These are server operations; browser entry points do not import them.

Store a version-1 `PublicationSnapshot` in a candidate's
`typeSettings.publication`. The existing revision, owner approval, active
candidate selection and Review report own the complete map, route bindings,
consumer page config bytes, Writer pins and selected config identities.
Changing any of those bytes requires a new revision and invalidates the old
approval. There is no separate publication approval state machine.

`compilePublication(snapshot, library, writer)` projects routes, navigation,
commands, breadcrumbs, outline, sitemap and deck outline from `snapshot.map`.
The snapshot also supplies source bindings and exact consumer config bytes;
a config ID alone is insufficient. Native Section contracts validate selected
members and content slots. Writer production resolution requires current owner
approval and exact fingerprints. A consumer config's Writer ID cannot be
replaced by an unrelated approved pin. Structural projected labels also require
Writer pins, including command group labels and the publication ID fallback.

Designer config stability means exact current descriptor, config and source
pins under the selected library hash. A null config pin means the native base
selection without a named config; it never invents a `default` config. Designer exposes no config lifecycle
status; this check does not promote draft metadata. Publisher Layouts do expose
lifecycle: production region pages require `stable`, and their exact leaf and
effective config contract are pinned. **All executable Layouts on this base are
draft. Actual region-page production therefore refuses until that producer
readiness changes.** No producer status or copy approval is changed here.
Complete-route source metadata can compile without claiming renderer, runtime,
or deployment qualification. Legacy arbitrary assembly registrations refuse.

A target release must cover exactly the projected page routes through selected
active candidates on that target. The compiler's `snapshotDigest` identifies
its immutable content before a release number exists. The existing target
manifest digest includes that compilation. Every one of the seven build
products is stamped with this single final release digest. Deck outline is
metadata; it does not claim universal slide rendering or an exporter.

`writeContentRelease` completes synchronous owner, copy, config and projection
validation before its first await. Only plain validated artifacts cross the
store lock boundary. Numbering and final digest stamps are derived under the
lock; mutable producer callbacks are not invoked again. Existing immutable
manifest, build and pending handover files remain the historical authority.
Historical reads verify exact product schemas, projections, fingerprints and
canonical Writer approval evidence at the recorded compilation time.

`selectContentRelease(root, targetId, digest)` atomically points the local
release selection to the newest complete stored bundle. It records each
selected digest once. `rollbackContentRelease` can select only an earlier
previously selected digest, preserving all bundle and selection-history bytes.
Unknown, unselected, foreign, incomplete or tampered bundles refuse. Pointer
operations share the release lock and use the store's atomic replacement.
Pointers live outside the immutable bundle directory. The pointer selects an already gated immutable bundle; it does not reread current
Writer or library state. A new production release must run fresh
`writeContentRelease` preflight. Rollback deliberately uses historical approval
evidence. These operations never assert that a remote builder observed or
deployed the release.

Full integration qualification and the two independent landing reviews remain
separate from local compilation and release preparation.

## Unresolved Writer policy boundary

Compilation accepts a Writer manifest, multiple registries and locale fallback.
Historical validation reconstructs each resolved entry in a single-entry
registry without retaining that original immutable policy. A custom manifest or
fallback-dependent compilation is therefore not guaranteed to pass its own
historical read, even when compilation succeeded. This is a correctness blocker,
not an approval waiver or a proven supported capability.

The next bounded repair must either retain and validate the needed immutable
Writer policy or synchronously validate the complete compiled artifact through
`assertCompiledPublication` before any release bundle is written, refusing
unsupported policy combinations. Add meaningful custom-manifest and locale
fallback regression cases, including append/read/selection behavior. Existing
owner approval, fingerprints and strict production refusal remain required.
