# Writer complete route

Generate the server entry with `emitCompleteRoutePage({ kind: "writer", file,
loader })`. The loader returns `{ serverData, initialSession }`, using the same
Designer session and selected `frames.app-shell` data as the other complete
routes. Extend that data with `writer: { copy: getAdminCopy() }`, where `copy` is
the admin's loaded store from `@clossys/writer/admin-copy`. An optional
`selectedRecordId` opens that record initially. Server data must be serializable;
callbacks and non-English envelopes are refused.

The host's manifest and selected profile must include `sections.data-table`,
`sections.record-detail`, and `sections.notices`. The list and coverage notices
remain in the Frame's vertically scrolling body. A selected record leases its
detail Section into the Frame's `right-panel`; no selection creates no lease.
When the host supplies no inspector configuration, the adapter uses Designer's
public `APP_FRAME_RIGHT_PANEL_CONFIG` preset. The Frame owns panel geometry and
its responsive presentation.

This is read-only English draft review. Copy uses the loaded store's CopyRefs;
missing copy throws an explicit Need and never reads shipped fallback wording.
The proposed-binding total counts the envelopes' declared binding rows. Empty
consumer lists do not prove that a record has no runtime users. Draft display
does not approve, activate, authenticate or publish anything.

Body labels and record text carry `data-copy-ref`, locale and status stamps;
technical IDs and serialized binding values carry `data-copy-value="technical"`.
The Frame's heading API accepts only a string, so its resolved Writer ID is
recorded as `data-writer-header-copy-ref` on the hidden route metadata marker. A conventional stamp
on the actual heading, and provenance for Frame-owned string-only controls,
remain integration Needs.
