# Host-resolved shell copy

Wrap shell/runtime rendering in `ShellCopyProvider` from
`@clossys/designer/frames`, or pass `copyResolver` to `AppFrame`. Supply the
host-configured Writer `createCopyResolver` callback. Its CopyRef and resolution
shapes are accepted structurally; Designer has no Writer import, locale choice,
formatting engine or approval bypass. A nested AppFrame inherits the surrounding
resolver when its own prop is omitted.

The shell's default names, navigation disclosure, command result count, theme
names/announcement and dock controls request their permanent Writer record IDs.
Counts and names are CopyRef `values`; Writer formats them. Existing explicit host
labels and formatter props still take precedence. Missing, mismatched and blank
resolutions fail closed: there is no inline English fallback. A server-safe
Banner accepts the resolver explicitly as `copyResolver`, or an already resolved
`dismissLabel`; it does not load client context.

These bindings reference draft records; they do not approve or activate them.
The host must supply an authorized resolver and records according to Writer's
approval policy. Account identities, section/entry labels, command heading/search/
empty labels, navigation destinations, panel labels and document title/meta are
host-owned inputs. Their actual Writer references remain integration Needs; the
shell never invents records for them. React Aria's own clear/region announcements
also remain an engine/host locale audit Need. Runtime specimen/sample data and
marketing surfaces are not activated copy for the three admin pages.
