# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.13.0 - 2026-10-16

- Use SectionedView for the Standard website home under Designer SiteFrame. Retire Landing executable callers and prop exports; native overlay scenes compose the registered Designer Hero.

- Regenerate the shipped preview stylesheet for Designer frame controls.
- Fill canonical content media with consumer-owned images or captioned videos through asset ids, with checked dimensions, aspect ratios, MIME formats and accessibility intent, plus declared loading applied by the shared renderer.
- SiteFrame can place its footer over a hero that fits one viewport, with an opaque backing and the existing legal links. The default flow placement keeps its rendered markup.
- Add optional frame action emphasis, brand and navigation tone, hero appearance controls and a transparent footer top rule while preserving default rendering.
- Document the package and host responsibilities for SiteFrame brand, CSS, page content and configuration.
- SectionedView and LandingView render `status-list` as catalog Items topics with localized badges, replacing definition lists and the readiness legend and requiring 3–8 flat entries or 2–4 groups of 2–4 entries with at most eight entries overall.
- Updated dependency @clossys/designer to ^0.12.0
- Updated templates/site dependency @clossys/designer to ^0.12.0
- Updated templates/site dependency @clossys/publisher to ^0.13.0

## 0.12.0 - 2026-10-16

- Site navigation can collapse into a mobile disclosure with an inline fallback when scripting is unavailable, and header action links can show a text label without an icon.
- The package includes a type-check proof for the published FAQ item fields and section layout.
- Render SiteFrame primary navigation with Designer NavDisclosure and text actions with SiteHeader.ActionLink, intentionally changing default navigation and action markup. Add a copy reference for the mobile toggle and an independent footer ground that defaults to the shell ground.
- Allow frame headers to overlay a hero with a selected ink tone, and standalone landing heroes to flex into their page frame.
- Updated dependency @clossys/designer to ^0.11.0
- Updated templates/site dependency @clossys/designer to ^0.11.0
- Updated templates/site dependency @clossys/publisher to ^0.12.0

## 0.11.0 - 2026-10-14

- SiteHeader takes `placement="overlay"` to sit fixed over the first block, transparent at the top of the page and a blurred glass plate once the page scrolls, with `tone` for the ink a light or dark ground needs and `menuOpen` to hold the glass while a menu is open.
Add the brandable `--color-surface-glass`, `--color-surface-glass-inverse` and `--blur-glass` tokens, all three required brand slots; the brand template lists the two glass colours in every theme block and the blur in the light block.
Upgrading has four visible effects on an existing site: `designer-brand-check` and `publisher-preview` exit 1 on a brand file until it declares all three new slots, `designer-contrast-check` exits 2 (`unresolvable-token`) on a consumer `tokens.css` that does not declare the two glass colours, and the contrast gate now fails a brand whose `ink-primary` or `ink-on-inverse` is translucent, reporting that the foreground "must be opaque".
The contrast gate checks primary and on-inverse ink over each glass composited on white and on black, taking the lower of a linear-light blend and the gamma-encoded sRGB blend browsers paint; a pair's `compositeOver` may now be a literal opaque colour, and a translucent or malformed literal is reported unchecked.
Inside an overlay header, focus indicators (the `--ui-ring-focus` ring and every `:focus-visible` outline) take the tone's ink instead of `--color-accent`, which falls below 3:1 on the glass, and the gate checks that ring on each glass at 3:1 over both backdrops; it checks no child ink other than the tone's own on the glass.
Publisher's preview stylesheet carries the overlay header rule.
- Render the framed LegalView on the shared page layout: the document title, an optional `summary` subtitle, one card holding both dates and the document body, and the related references as the notes region below it, with every section id and heading kept. The framed page renders no draft or status text and does not resolve the draft heading or facts to confirm, so `labels.draftHeading` is optional there (`LegalViewFramedLabels`). The self-chromed LegalView is unchanged.

Add an explicit `indexing` option (`"index"` or `"noindex"`, legal pages only) to `buildSiteMetadata`. It decides the robots value by itself and makes no counsel-review claim; without it the `status` rule is unchanged. A non-legal page, an unknown value, or `"index"` on a page whose `status` is `"draft"` is refused with the new `invalid-indexing` reason.
- Updated dependency @clossys/designer to ^0.10.0
- Updated templates/site dependency @clossys/designer to ^0.10.0
- Updated templates/site dependency @clossys/publisher to ^0.11.0

## 0.10.0 - 2026-10-13

- Consumers can validate static art declarations with Designer's typed slot contract and render checked photos or token-painted vectors into Publisher backdrop and media seams.
- Adds `./web/consent` (the client-only `ConsentExperience` notice assembly, `bindTransport`, `useAnalyticsAllowed` and `useConsentStatus`), `./web/consent/preview` (a fixed-clock `createConsentPreview` resolved under the `development` condition) and `./consent-copy` (server-only `resolveConsentCopy`), each of which throws at import under the condition it refuses.
- Add `constructionStatusProps` to compose `StatusView` from caller-owned Writer CopyRefs, with validated onward links and guidance for construction routes.
- Add ContactForm for CaptureView's form slot inside SiteFrame, with caller-approved copy, topic and contact fields, a configurable honeypot, client validation and ContactResult states.
Native contact submissions use POST to keep contact fields out of URL query parameters.
Deprecate ContactView in favor of CaptureView plus ContactForm while retaining its compatibility page API.
- Add a contact surface and contact-form rule to the front-door test kit, requiring one main containing one form with a POST method.
Use the contact surface in the framed ContactForm conformance test and document its rules.
- `StatusView` and framed `GlobalErrorDocument` accept an optional caller-labelled `reference` that renders after the subtitle with an escaped, selectable code value.
- Simplify FAQ band prop forwarding after landing-page fragment spacing is resolved.
- Compose invitation-only sign-in with optional no-account and request-access copy and a restricted access selector for neutral identifier-failure and lockout notices.
- Render LegalView inside SiteFrame with the shared validated legal body, effective and last-updated dates, draft callout and canonical related links.

Update the page-layer contract to stop deferring framed LegalView or the deprecated ContactView.
- Add prose as a new canonical content block type for ordered paragraphs and inline links with Writer copy provenance, sanctioned destinations, and matching ordinary and server markup. Paragraphs use readable measures and spacing, with at most 24 spans, six links and 1,200 Unicode characters each. Consumers with exhaustive block-type switches must handle `prose`.
- Share card routes can omit alt to derive alternative text from the card's visible text.
Derived alternative text joins parts with a single space instead of ". " after a part ending in ".", "!", "?", ":", ";", "…", "。", "！", "？" or "；", optionally followed by closing quotes or brackets (`"`, `'`, `”`, `’`, `)`, `]`, `»`, `」`, `』`, `）`, `】`).
- Add copy-reference-backed icon actions, social profile links and ungrouped footer links to SiteFrame.
Validate the new slots as closed data using the existing link and SVG shape allowlists, omit empty lists, and map them only to the public site surface.
- Consumers can compose status lists with Index rows and per-item badges using the topics recipe, with a Publisher preview example and configuration guidance.
- Updated dependency @clossys/writer to ^0.6.0
- Updated dependency @clossys/designer to ^0.9.0
- Updated templates/site dependency @clossys/designer to ^0.9.0
- Updated templates/site dependency @clossys/publisher to ^0.10.0
- Updated templates/site dependency @clossys/writer to ^0.6.0

## 0.9.0 - 2026-10-12

- Give connected item geometry, panel aliases and catalog styling explicit token fallbacks while preserving live theme overrides. Document how source-checkout generators relate to installed packages, and check required labels and supported split media layouts through compiled type assertions.
- Canonical content frames use standard or display sizes and stacked, split-start or split-end layouts. Only stacked statement bands centre; split bands keep start alignment. Items use scale: item or statement. Connected steps support columns or stacks and two actor lanes across three to five steps, including four. Link-index renders linked plates. Matrix labels appear on both sides or neither; each side has matched points or a specimen panel, with description as optional lead copy. Specimen keys sit at the end of stacked bands or below split panels.
- Keep chart palette fallbacks in sync with the token registry and preserve scene labelling and status-mark styling. Correct styling-data lint classification and catalog test setup.
- `publisher-preview` writes `content-catalog.html`, a function index linking nine catalog pages: Overview, Introduce, Show, Explain, Index, Sequence, Compare, Frame and Parts. Examples, configuration references and recipe links render against the supplied brand CSS. Preview pages, including nested catalog pages, load `publisher-preview.css`, generated from `styles/preview.css` with preflight and the classes used by Designer components and Publisher views. Designer ships a copy cookbook covering block choice, slots, word budgets and page-variety rules, linked from its skill.
- Exclude source *.test.json snapshots and `__fixtures__` directories from Designer and Publisher package contents. Artifact-safety checks also reject *.spec.json and complete `__fixtures__` directory segments alongside existing source test-file checks. Runtime JSON, shipped examples and partial fixture-like names remain permitted.
- Use one action size per frame: large for display hero and closing groups, medium for compact heroes and body groups. Emphasis selects the button variant while keeping responsive pair widths, quiet text actions and authored-order defaults.
- Add tertiary and quiet body action emphasis with defaults derived from band weight: secondary then quiet on A, tertiary on B and frame C, and quiet on other C bands. Hero and closing action lists resolve to primary then secondary, validate effective primary counts, put the primary first in focus order and stack large button pairs on mobile. LandingView closing bands accept resolved action lists and footnotes alongside the existing action slot.
- Structured hero and closing pairs stretch the enclosing intro action row so mobile large buttons fill the prose column. Closing action labels and footnotes accept visible composed ReactNode collections, with copy and target validation. Closing bands also support a single action or a caller-owned action slot.
- `AuthView`'s `internalNote` prop is deprecated: it is still accepted with its `{ label, message }` shape for one release and renders nothing, inside a `SiteFrame` or on the legacy page, so remove it from call sites and report a missing sign-in provider setting in the server log instead.
- `BoundaryView` now renders a page header (`status` as the `<h1>`, `title` as an `<h2>`, then `description`), `action` inside a card and `notes` below it, and no longer renders `ErrorView`, so `className`, `style` and other HTML attributes land on its outer element.
- Render canonical `content-section` bands in `SectionedView` and `LandingView` through Designer ContentSection, Items and Matrix, with resolved metadata, grouping, numbered and connected order, disclosures, and specimen, record and Scene media. Render item-title links and action buttons, support header-only splits, and render published split FAQs with the header beside the rows. Refuse invalid or executable resolved data with a path-bearing RenderError. Compact heroes use the canonical size field in both web views.
- Add `content-section` bands with canonical Frame sizes and split directions, recipe-based Items and two-sided Matrix blocks, and one specimen, record or Scene visual. Validate closed options and counts, preserve CopyRef provenance, and resolve item icons and eyebrows (up to 32 characters). Items support badges, grouping, linked collections, order and disclosure; specimen parts support badges, meter history and status-row mobile limits. Linked collections link every item or none, at most six, with distinct destinations. Stacked bands with a block or media take no section actions; header-only actions exclude a footnote. Published section kinds retain their own contracts, and the published `faq` kind gains optional `layout: "split"`.
- Keep Scene text limits local to media, give inverse scenes opaque base grounding, namespace reusable record instances, and align canonical landing fragments with their frame geometry.
- Derive advisory page weights and variety from canonical Items axes, Matrix sides and media types. Equivalent raw blocks and recipes share warnings, grouped links retain flat source paths, and existing action weight ceilings and page-length limits remain intact.
- `@clossys/publisher/web` exports `StatusView`, a whole-page status on a new card-free page layout (the shared title and subtitle header, then an optional call to action and optional notes with no card, and no header, footer or `<main>` of its own), where `status` is the page's one `<h1>` and `subtitle`, `action` and `notes` are optional, so one view serves error, not-found, boundary and placeholder pages; `buildSiteMetadata` accepts a `construction` page kind whose robots value is `noindex, nofollow`.
- Content previews use canonical collection and media shapes, preserve source copy and highlighted Matrix sides, and namespace Scene and anatomy identities by section instance. Ordered and disclosed collections use entry-specific controls; standalone preview disclosures work without hydration. Continuation copy stays available to assistive technology, and Matrix presentation identities are encoded without changing authored data.
- Render published `faq` sections through the Index function's Items disclosure recipe, preserving question and answer copy provenance and enforcing its four-to-six-row budget. This narrows the published FAQ contract: sections require four to six rows.
- The `form-measure` rule of `checkFrontDoor` now also accepts the form measure on the view's content root directly inside `<main>`, so a sign-in, activation or reset view rendered inside `SiteFrame` passes it.
- Catalog caption advice follows the effective connected order of Items blocks, including steps recipes. Visual cards retain their caption-free contract.
- Canonical content-section actions support primary, secondary, tertiary and quiet emphasis, with omitted emphasis derived from band weight. Groups hold at most two actions and one primary and render medium buttons. A footnote holds text and at most one link, or a link alone, with validated copy and destinations. Stacked bands with a block or media have no section actions; header-only actions exclude a footnote. checkSectionVariety advises on repeated primary-action bands.
- Designer Items selects collection scale with item or statement. Publisher renders link-index recipes as plate rows while retaining raw linked columns. Authored canonical content-section grounds are inverse or omitted; omission delegates base/sunken cadence to the view. LandingView and SectionedView plan automatic body grounds while preserving explicit inverse anchors. LandingView planning also accounts for trailing documents and its optional closing call to action.
- Validate dense content arrays and bounded counts, and share frozen recipe constraints between runtime resolution and types. Disclosure items require descriptions. Previous meter markers stay within their scale. Matrix descriptions can accompany matched point lists or specimen panels, with the same primary form on both sides.
- Validate content arrays as dense own data before inspecting their items. Canonical row groups retain two to four item references, and lane refusals identify invalid declarations.
- `renderStructuredDocument` also returns `sectionBodies`: each top-level section's blocks, keyed by section id, without the section wrapper or heading. A view that draws section headings itself (a `LandingView` band's header group) can place a structured document's prose, lists and links in that band's module slot.
- `DocumentView` now renders its content only, with no header, footer or `<main>`, for use inside a `SiteFrame`; `brand` and `footerSecondary` are optional deprecated props that select the legacy page, and `action` renders as the notes line below the card.
- `DocumentView`'s column width follows the `--ui-width-prose-max` token and is unconstrained when a host does not define it, where it previously fell back to `48rem`.
- `CaptureView` omits the `secondaryAction` wrapper when it is `null`, an empty string or an empty list.
- `ErrorView` and `BoundaryView` are marked deprecated in favour of `StatusView` for a title, a subtitle and one action, and `AuthView` for a state whose content needs a card, and the README documents how to move a mirrored or self-chromed front-door page onto `SiteFrame` and the published views.
- `ErrorView`, and `AuthView`, `CaptureView`, `BoundaryView` and `DocumentView` when rendered without chrome props inside a `SiteFrame`, now throw when their content root is given a landmark `role` (`main`, `banner`, `contentinfo` or `navigation`) or the `SiteFrame` main `id`, because the frame owns the page's landmarks and its main `id`.
- Add `header`, `footer` and `mainId` to `AuthView`, `CaptureView` and `BoundaryView` for hosts not yet on `SiteFrame`: `header` and `footer` replace Designer's `SiteHeader` and `SiteFooter`, and a non-empty `mainId` gives the view's `<main>` that `id` and `tabIndex={-1}` as a skip-link target; `AuthView` and `CaptureView` also take `nav`, `headerAction`, `headerSecondaryAction` and `ground`, which pass through to the header and footer as they already did on `BoundaryView`.
- `SignInForm` disables its fields and back control while `unavailable` and moves focus to the field that shows an inline error, and to the cleared code field after a resend; `ResetForm` moves focus to the identifier field when the account is not found.
- `AuthView`, `CaptureView` and `BoundaryView` take a `notes` prop that renders below the card and is left out when it is empty, and `AuthView`'s `secondaryAction` is now a deprecated alias of `notes` (passing both throws).
- Organize content previews into a function index and nine pages: Overview, Introduce, Show, Explain, Index, Sequence, Compare, Frame and Parts. Provide axis references, compatible recipe links and a complete composition. Retain published-kind gallery links and shared styles for nested pages. Keep Matrix headings in reading order without naming a generic container.
- `GlobalErrorDocument` now takes `shell`, `resolveCopy` and `resolveAsset` with the `StatusView` props (`status`, `subtitle`, `action`, `notes`) and renders `SiteFrame` around a `StatusView` inside the frame's one `<main>`, while its earlier `ErrorView` props, typed `GlobalErrorDocumentErrorViewProps`, are deprecated and still render the frameless `ErrorView` body for one release.
- Add compact hero headings for pages that lead into task content. A compact LandingView hero omits viewport fill and scroll cues and has no media; display heroes retain their opening presentation.
- LandingView closing bands can reuse the opening hero's heading and description with `copy: "hero"`, retain their own action, and override either copy field. A valid nonempty document without an opening hero is refused with `missing-hero-copy` when reuse is requested.
- LandingView renders document sections as full-width body bands with responsive frame spacing and a larger inverse closing call to action. Hero and closing headers share Designer SectionIntro anatomy. Structured hero actions render as button links, defaulting in authored order to primary then secondary; groups have at most one primary, and large pairs stack on mobile. Omit actions for a message-only opening.
- LandingView's peek cue is a real link to the first body band, or to the call-to-action band when no body band exists. It uses a circular icon button on the target ground, fixed near the viewport bottom, and fades as the page scrolls. cueLabel names the link and defaults to "Scroll to next section"; provide nonblank copy. With no target, no cue renders. Smooth scrolling applies only when motion is allowed. Compact heroes omit the cue; display heroes retain it. Preview CSS includes the cue and motion styles.
- Render canonical Matrix sides and specimen panel badges, mobile row limits, and previous meter markers through the shared blocks. Preserve authored identities, visible copy, and resolution provenance, with an explicit capability error for unsupported Matrix side IDs.
- The preview gallery renderer and the generated site template now import `readBrandCss` from `@clossys/designer/tokens/server`, Designer's Node-only tokens entry.
- Name the action-weight warning consistently, compare normalized primary destinations, and exempt short pages from the opening set-piece requirement. Make structural weight mappings exhaustive and pin readable catalog findings and breather bounds.
- Add opt-in page-flow warnings and structural section-weight derivation for hero-led documents.
- `CaptureView`, `DocumentView` and `AuthView` share one page layout: the page title as the one `<h1>` with an optional subtitle, the body inside a card, and an optional notes line under the card, centered in one column.
- Preview CSS includes Designer tone shapes and panel utilities, including rounded-panel, border-line-panel and fill-status colors. Preview brand coverage requires the four panel identity slots and the other brandable tokens.
- The published single-screen LandingView is now HeroView, with HeroViewProps, HeroViewGround and HeroViewFooter; change the import and element name to keep that page. LandingView now composes a sectioned landing page: an opening hero with optional peek and backdrop, document body bands in a centred column, afterSection slots and an optional inverse closing call to action. It renders page content inside a caller-provided SiteFrame.
- Add `SiteFrame`, the page frame that renders the skip link, the banner, the page's single `<main>` (id `SITE_MAIN_ID`) and, when the shell has a footer, the contentinfo footer, mounting Designer's chrome from a `shell` of plain data; `SiteFrame` throws on unknown fields, unresolved copy, a brand asset that does not resolve to an image, unsafe icon data and disallowed links or origins.
- Add `SITE_PAGE_LAYERS`, the page-assembly contract as frozen data that names each layer's owner, implementation scope and deferred parts.
- Add `siteShellFor(config, kind)`, which builds the `SiteFrame` shell for each of the `SITE_SURFACE_KINDS` (`site`, `front-door`, `admin`, `demo`) from one `SiteFrameConfig`.
- Preserve resolved schedule, share and file copy when rendering specimen panels and item visuals. Keep scene formats and copy provenance structural, and refuse unresolved specimen copy before rendering.
- Preserve the supporting specimen shape for split specimen bands beside text Matrix or plain sequence Items. Structural set pieces and disclosure reference bands retain their existing precedence.
- SectionedView renders canonical header-only content bands through ContentSection with the resolved standard or display frame size. Body actions use medium button groups with accessible tap targets.
- Add two-actor ordered-step lanes with responsive joins, accessible actor labels, visual captions, and explicit terminal markers. Preserve ordinary sequences without new options.
- Add labelled canonical Items row groups with resolved CopyRef labels, whole-block item and link validation, and page-flow handling. The topics recipe supports grouped rows, and catalog examples preserve source item paths.
- `brand` is now optional on `AuthView`, `CaptureView` and `BoundaryView`, and their chrome props are deprecated in favor of `SiteFrame`: `brand`, `header`, `footer`, `mainId`, `nav`, `headerAction`, the secondary header action (`headerSecondaryAction`, or `secondaryAction` on `BoundaryView`), `ground` and `footerSecondary` on all three, plus `surfaceLabel` on `AuthView`.
- Canonical content-section bands author inverse or omit ground for view-owned cadence. Resolved viewGrounds lists canonical omissions even without sectionGroundRhythm: view; that option also delegates omitted grounds on published section kinds. planLandingViewGrounds returns band grounds and neighboring repeats for the document, trailing documents and optional CTA. Only an initial section of kind hero is excluded from body cadence; explicit canonical inverse remains an anchor.
- Name StatusView destination and LegalView related-link regions through their visible headings, with unique stable heading references for sibling views. Empty collections remain omitted. Export the LandingViewAction type through both public web entry points so consumers can name actions used in closing call-to-action groups. Correct resolved ground documentation for canonical content-section omissions and view-owned cadence.
- `AuthView`, `CaptureView` and `BoundaryView` now render their content only, with no header, footer or `<main>`, for use inside a `SiteFrame`; passing any deprecated chrome prop selects the legacy page, which keeps the view's own header, `<main>` and footer around the same content.
- Add optional destinations to StatusView and framed GlobalErrorDocument, and related references after LegalView's body. Caller-labelled collections render one canonical Item or two to six Items rows, with required links and canonical item validation. Omitted or empty collections preserve existing content.
- Updated dependency @clossys/designer to ^0.8.0
- Updated templates/site dependency @clossys/designer to ^0.8.0
- Updated templates/site dependency @clossys/publisher to ^0.9.0

## 0.8.1 - 2026-10-04

- Add immutable front-door defaults and a browser client entry for provider-free forms, preserving strict registry resolution through the existing entries.

Use neutral verification and password notices without assuming email delivery or reset/resend capabilities.
- Use a fixed invalid-surface error message when resolution refuses malformed input; detailed validation findings remain available through the validator.

- Updated dependency @clossys/writer to ^0.5.1
- Updated dependency @clossys/designer to ^0.7.1

## 0.8.0 - 2026-10-02

- `@clossys/publisher/web` exports `ActivateForm`, a form for setting a password from an invitation, and `ResetForm`, a form that asks for a code and then a new password, both with no identity-provider import and with injected handlers whose results show each failure in one place.
- `AuthView` takes an optional `isDisabled` prop that keeps the form on screen inside a disabled fieldset with its typed values shown, so a site whose sign-in provider is unavailable no longer hides the form or shows an empty card.
- `AuthView` now holds its content column to the `--ui-width-form-max` form measure instead of the prose measure, and its `description` prop is required, so every step must pass a supporting line (or `undefined` explicitly).
- `AuthView` accepts an optional `internalNote` (`{ label, message }`) that renders a badge-labelled development note under the footnote, and its `footerSecondary` documentation now says an auth page holds a legal row only.
- `AuthView` now renders `secondaryAction` below the card instead of inside it, so the card holds only the form and the alternate-step lines (for example "Forgot password?" or "No account? Request access") sit between the card and the footnote.
- `AuthView` accepts an optional text-only `surfaceLabel` and forwards it to its site header, so staff and demo sign-in pages can show a surface badge.
- `AuthView` callers must now pass `brand`, which renders in the site header.
- The `AuthView` card now spans the prose width instead of `max-w-sm`.
- `AuthView` accepts `footerSecondary` for the site footer, and the `AuthView` template takes it as a slot.
- AuthView now renders the site header, a page header, the form slot inside Designer's `Card`, and the site footer, with one shell for sign-in, sign-up, password reset, and verification.
- `BoundaryView` renders `ErrorView` between Designer's `SiteHeader` and `SiteFooter` in one shared frame, so a site can delete its private boundary shell; it takes every `ErrorViewProps` key plus a required `brand` and an optional `footerSecondary`.
- `BrandGuideView` takes optional `embedded`, `specimen`, `specimenLabel` and `emptyLabel` props and its `lockupSvg` is now optional, so the guide can render inside another page's `main` with a type specimen and no lockup.
- `buildBrandShareCard()` now cuts a long wordmark or kicker to one line with an ellipsis, stops the headline and supporting line at two lines each, and keeps a non-square mark in ratio; its error text no longer names `buildShareCard` fields.
- `buildBrandShareCard()` builds one 1200 by 630 share card for any site, drawn with the header's plated mark beside the wordmark or the plate alone, from `@clossys/publisher/web` and its server entry.
- Add `buildSiteMetadata` to `@clossys/publisher/web`, which turns a site identity and a page description into one head set (title, canonical, robots, Open Graph, and Twitter card fields) and throws `SiteMetadataError` for an input it cannot build a head from, including a name, tagline or label that has a tab or other control character inside it.
- CaptureView now renders the form or confirmation and the secondary action inside Designer's `Card`.
- The CaptureView content width falls back to `none` instead of a raw length when the `--ui-width-prose-max` token is absent.
- `@clossys/publisher/web` exports `createContactHandler`, a framework-neutral, server-only handler that validates a contact submission, refuses control characters, honours a honeypot field, consults an injected rate limiter and delivers a plain-text email through an injected delivery port, returning status codes.
- `@clossys/publisher/web` exports `createMemoryRateLimiter`, a single-instance sliding-window rate limiter that reads time from an injected clock.
- Adds `renderContactNotificationEmail(input, options?)` to `@clossys/publisher/email`, returning `{ html, text }` for a contact submission (#1516). Every value is HTML-escaped exactly once into inert text: no links, images, scripts or remote resources, and a non-string or control character is refused with a `TypeError` that names the field, never the value. `createContactHandler` now delivers both bodies, so `ContactOutboundMessage.html` changes from `html?: never` to a required `string`; the `text` body is unchanged, and headers, cc, bcc and attachments stay refused.
- `createContactHandler` now reads the delivery's `deliver` and the limiter's `check` once at construction, so a port function reassigned afterwards is not called and a stub assigned onto a production delivery is not reached.
- `@clossys/publisher/web` exports `createStubContactDelivery`, which returns a stub delivery that `createContactHandler` refuses to be constructed with when the target is `production`.
- `createContactHandler` accepts optional `limiterTimeoutMs` and `deliveryTimeoutMs`, which resolve `unavailable` with the new reasons `limiter-timeout` and `delivery-timeout` when a port call does not settle in time, and it refuses a lone UTF-16 surrogate in `name` or `message` as `malformed`.
- `@clossys/publisher/web` exports `ContactView`, a client contact page with client-side validation, a hidden honeypot, and sent, invalid, rate-limited and unavailable states, where each failure leads with a text label and all copy comes only from `CopyRef` entries (#1516).
- `ContactView` accepts an optional `devPreview` prop (`"idle"`, `"submitting"`, `"accepted"`, `"invalid"`, `"rate-limited"` or `"unavailable"`, exported as the type `ContactViewDevPreview`) that pins the view to one state without a real send: it is inert, so submitting does not call `onSubmit`. A value outside that set throws a `RenderError` that names `devPreview` and omits the value. The site template's `/contact?preview=<state>` selects a state when `SITE_TARGET` is not `production` and is ignored on production, where a page must not pass `devPreview`.
- `@clossys/publisher/document` adds `strong` and `em` inline emphasis that nest and can wrap a link, and an optional `columnStyles` on a table that renders a `"mono"` column's body cells in `<code>`, each checked by `validateStructuredDocument` and rendered by `renderStructuredDocument` and `DocumentView`.
- Publisher error messages for the structured-document, legal-document, copy-resolution, image layout and web, email and print rendering failures this change covers now name the fixed field path and leave out the document id, copy id, template name, asset id, notes key, and field key.
- Publisher render and resolve error messages now leave out the document id, template name, asset ids, copy ids and bound slot names, report counts for them instead, and name a structured field by its position rather than its key.
- A stored document that still binds `details` or `detailsLabel` on an error view now fails with `RenderError("resolution-failed")` because those slots no longer exist; remove those bindings.
- `ErrorView` no longer accepts `details` or `detailsLabel`, so a diagnostic reference now goes inline in `description`, and the ErrorView web template drops the matching two slots; `action` is documented as one primary control with any secondary destination a text link inside `description`.
- `@clossys/publisher/web` now exports `formatPageTitle({ page, brand })`, which builds the same `<Page> · <Brand>` title `buildSiteMetadata` uses for non-home pages, so sign-in, admin and error pages can share one title pattern.
- Add `@clossys/publisher/testing`, a test-support check that your sign-in, boundary and global-error pages hold the shared front-door rules (one `<h1>`, the form measure, one primary action, the page title, and the global-error head).
- Sites can render a complete, titled, noindex global-error document, with its own `<html>`, `<head>` and `<body>`, from the `@clossys/publisher/web` exports `GlobalErrorDocument` and `GlobalErrorDocumentProps`.
- `GlobalErrorDocument` takes an optional `htmlClassName` prop that is set as the class of the root `<html>`, so a site whose brand fonts come from a framework font loader keeps them when the global-error document replaces the root layout.
- `publisher-head-lint <html-dir> --site-name <name>` (and `lintRenderedHead` from `@clossys/publisher/pack`) checks rendered HTML pages for a complete head (title, description, robots, theme colour, canonical, Open Graph and Twitter card tags) and a title in the site's `<label> · <site>` or `<site> · <tagline>` form, and reports each gap as a rule and route without repeating page text.
- `LandingView` accepts `ground="inverse"`, which paints the inverse surface on the page and gives the banner, hero and footer text the on-inverse ink. It also accepts `footer="surface"`, which gives the footer an opaque base plate with a hairline on its top edge. `@clossys/publisher/web` exports both prop types, as `LandingViewGround` and `LandingViewFooter`.
- `@clossys/publisher/web` exports `LandingView`, a server-safe single-screen landing page with a transparent banner and footer, one centred hero and an optional inert backdrop, whose copy comes only from props (#1516).
- `validateLegalDocument` in `@clossys/publisher/document` checks a Terms or Privacy document against its kind's fixed section ids and order, a draft or counsel-reviewed status, required calendar-valid effective and last-updated dates, and required content variables.
- `gateLegalDocument` in `@clossys/publisher/document` refuses a draft, an unknown or missing status, and any invalid document for target production, and accepts a valid draft for preview.
- `LegalView` renders a callout with the draft heading and the resolved facts to confirm before the first section of a draft document, and has no prop to turn it off.
- `LegalView` and the launch-pack gallery's back link cap their width with `var(--ui-width-prose-max, none)` instead of a `48rem` fallback, and `LegalView` reports a malformed locale with a fixed message that does not echo the value.
- `LegalView` reports an unresolved label or fact-to-confirm copy reference with a fixed message that names the field path instead of the copy id.
- `LegalView` renders a Terms or Privacy `LegalDocument` in the site chrome and throws a `RenderError` for a document that `validateLegalDocument` reports findings for.
- `MarketingView` now omits the feature band when `features` is empty and no features heading or description is bound.
- `@clossys/publisher/pack` adds `importLegacyV0Pack` and `writeLegacyV0PackImport`, which turn an earlier pack index into a `pack.json` that passes `validatePackManifest`, refusing an unknown shape or an unsupported timestamp by path and writing the file only when it does not exist yet.
- The site template's dev-only pack review now serves its OG image, notification email and plain-text email at `/pack/export`, refuses to serve on `production` and `preview` hosting even when `SITE_TARGET` is a development value, answers 404 for an unknown `SITE_TARGET`, shows each page's badge beside its forced states and contact-sheet frames, and `PackReviewView` names its sections with `aria-labelledby` and accepts an optional `href` on an export.
- The site template's dev-only pack review now serves `/pack` and `/pack/export` only when `NODE_ENV` is unset, `development` or `test`, so a self-hosted production build answers 404 whatever `SITE_TARGET` says, and every export response carries `x-robots-tag: noindex, nofollow`.
- `PackReviewView` takes optional `strategy`, `brandKit` and `voice` props and shows a strategy brief, a brand kit and a voice and copy section, each with its own empty label when its prop is omitted, and its `labels` now require the `strategy`, `brandKit` and `voice` groups.
- `@clossys/publisher/web` exports `PackReviewView`, a dev-only review index that lists a site's pages and their forced states, its exported artifacts and a lazy contact sheet at 390, 1024 and 1440 px, each entry badged `draft`, `delegated` or `approved`, and `@clossys/publisher/pack` exports `buildPackReviewIndex`, which builds those entries from `pack.json` and the site's route list and refuses a manifest, path, route or state it cannot list. The site template adds `/pack`, served only when `SITE_TARGET` is `development` or `test` and answering the 404 page on every other target.
- The README now links to the package's changelog at its real location in this repository instead of citing a CHANGELOG that no longer ships in the package.
- Publisher error text for malformed bindings and for slide decks now names them by position instead of by the value or id they carried, validation findings no longer repeat a duplicate slot key or a string value, and the empty-canvas refusal reports a count of omitted slots.
- `publisher-seal` now refuses a symbolic-linked or hard-linked manifest or ledger, keeps each file's permissions, locks both files and refuses if either changed while it ran, restores the ledger when the manifest write fails, and takes its time from the clock instead of a `--now` flag, and the seal evidence now carries the `itemId` it was taken for, only the `website` item can be sealed, and `observedAt` must be a real calendar date.
- `publisher-seal` and `sealWebsite` refuse a production URL that carries a username or password. A seal interrupted between the ledger write and the manifest write is finished by running the same command again, which writes only the manifest from the identical ledger entry. The seal lock is taken in the real directory of each file, so two spellings of one directory contend, and only an existing lock is reported as another run holding it. `checkSealEvidence` requires `itemId`, and the `isSealInstant` export is removed.
- `publisher-seal` and `sealWebsite` now refuse a production URL that is not already in its canonical form or whose host is not plain letters, digits, hyphens and dots (or an IP literal); this covers spellings that parsers read differently, such as a backslash before userinfo, an empty userinfo, a control character or an upper-case scheme or host. A production URL without a path (`https://host`), with an explicit default port, or in any other non-canonical spelling is now refused, and an interrupted seal whose ledger already holds such a URL must be repaired by hand.
- `buildBrandShareCard` now derives the share card's alt text from its visible text when `alt` is omitted, and a supplied `alt` is still used unchanged.
- Callers can build the exports of a site's `opengraph-image` route from a brand share card with `createShareCardRoute`, passing their own `ImageResponse` class and an optional title that replaces the card's headline.
- The site template ships `templates/site/app/site-metadata.ts`, whose `toNextMetadata` and `toNextViewport` map the result of `buildSiteMetadata` onto Next.js metadata and viewport.
- Add `buildShareCard` to `@clossys/publisher/web`, which builds the site share card as a React element of exactly the `OG_SHARE_CARD_SPEC` size, coloured only from Designer role tokens, together with the `shareCard` record `buildSiteMetadata` accepts, and throws `ShareCardError` for input it cannot build a card from.
- Callers can pass `formLabel` on CaptureView, `entriesLabel`, `tagsLabel`, and `paginationLabel` on CollectionView, `lockupLabel`, `downloadsLabel`, `colorLabel`, `typeLabel`, and `factsLabel` on BrandGuideView, `galleryLabel`, `brandSectionLabel`, `contrastLabel`, and `coverageDescription` on SystemAuditView, and `nodeChapterFallbackTitle` and `statGridLabel` on consumer templates registered through `defineWebTemplate`.
- `@clossys/publisher/web` exports `SignInForm`, an identifier-first sign-in form with no identity-provider import, which takes `identify`, `verify` and `onSignedIn` handlers and shows each failure result in one place.
- `SignInForm` in `@clossys/publisher/web` takes optional `verifyCode`, `resendCode` and `unavailable` props: a `verify` answer of `{ status: "needsCode" }` moves to a one-time code step after the password, and `unavailable` shows the unavailable notice from the first render with submission disabled.
- `publisher-site-instantiate --root <repo> --pins <file.json>` copies the site template into the repository's `apps/site` with exact `@clossys/*` pins and adds `apps/*` to the root workspaces, refusing a non-empty target, a missing or non-exact pin, an unsafe root manifest and a template that holds a symlink before writing anything.
- Add `lintSiteMetadataHtml` and `SITE_METADATA_REQUIRED_TAGS` to `@clossys/publisher/web`, which report each missing, empty, or duplicated site metadata tag in a rendered document's head in one pass, and report any head content outside a fixed set of head elements, and anything between the closing head tag and the body other than whitespace and comments, as unreadable instead of guessing.
- The site template routes `/` to `LandingView`, `/contact` to `ContactView` with a server action that sends through Messenger's Resend adapter, and `/terms` and `/privacy` to `LegalView` behind the production legal gate, with error and not-found pages that render every word from copy ids (#1516).
- The site template's `siteOrigin()` now refuses, on an explicit `SITE_TARGET=production`, a `NEXT_PUBLIC_SITE_URL` that differs from the brand-facts record's `canonicalOrigin`, and its README lists the five copy ids a site made from an older template copy needs to add.
- The site template's `/contact` route preselects the topic named by `?topic=<id>` when it is one of the listed topics, and selects nothing for an unlisted or repeated value.
- The site template now declares dependency ranges that cover the current Designer and Publisher versions and the current Next.js, React and TypeScript majors.
- The site template's `robots`, `sitemap` and `opengraph-image` routes now read only the declared routes, records and copy ids, with `NEXT_PUBLIC_SITE_URL` as the required origin and crawling allowed only on production, and its `/about` page uses `MarketingView` (#1516).
- The site template now requires next 16.3.6 or newer, because next versions from 16.2.0 up to 16.3.5 have a critical advisory (GHSA-vcvr-r3jv-pc5j) in next/og, which the template's opengraph-image route uses.
- The site template's dev-only `/pack` page fills its strategy brief, brand kit and voice and copy sections from `clossys/strategist/contract.json`, `clossys/brief.json`, `clossys/designer/brand.css`, `clossys/writer/voice.json` and the copy registry, and the template's `package.json` now depends on `@clossys/strategist`.
- The site template README now describes the template's global stylesheet in the order the file imports and scans, and states that its `@source` paths assume the Designer and Publisher packages are installed in the template's own `node_modules`.
- The site template now loads the Designer token layer through Tailwind and PostCSS, sets the brand binding and the theme init script in its root layout, and documents the static guards that check its ranges, custom properties and token purity.
- A site made from a template copy that predates the /about page and share card fails its build unless its copy registry has `site.about.heading`, `site.about.description`, `site.about.cta-heading`, `site.about.cta-description` and `site.share-card.alt`.
- `ContactView`, `LegalView`, `BoundaryView`, `MarketingView` and `PackReviewView` accept the optional header slots `headerAction`, `secondaryAction` and `nav`, plus a `ground` for the header and footer plate, so every site page can carry the same banner call to action as `LandingView` (#1886). The site template passes its contact call to action in the header of the about, contact, terms and privacy pages.
- `@clossys/publisher/pack` adds `checkSealEvidence` and `sealWebsite`, and a `publisher-seal` command, which refuse to mark a website item `published` unless render and delivery evidence matches the production commit, and on acceptance record the seal as one `web` ledger entry.
- Each package skill's section for when the package is not installed speaks of the repositories the team is set up in, instead of every inventoried repository.
- Each package skill says the whole team is composed in the hub and a repository staffed in an approved plan gets `@clossys-advisor` and the voices of the roles staffed there once that plan's setup pull request has merged, so a missing `@clossys-<package>` mention is a bug only in the hub.
- Updated dependency @clossys/writer to ^0.5.0
- Updated dependency @clossys/designer to ^0.7.0
- Updated dependency @clossys/controller to ^0.10.0
- Updated templates/site dependency @clossys/designer to ^0.7.0
- Updated templates/site dependency @clossys/publisher to ^0.8.0
- Updated templates/site dependency @clossys/writer to ^0.5.0

## 0.7.0 - 2026-09-24

- The `foundry` manifest block now declares `capabilities` (manifest schema
version 3, #1196), a capability map of this role's craft with eleven
capabilities: three `built`, two `partial`, and six `planned`. Every
`built` or `partial` capability names as its `proofCase` a
release-qualification case that exercises it (#1272). Built: channel
rendering (`preview-rendered`), the asset roster and coverage
(`media-satisfied`), and sealing and the publication record, which also
covers the citation-drift check `checkLedgerDrift`
(`record-append-only-clean`). Partial: the materials site
(`preview-rendered`), an internal, locally opened index whose renderers
ship but which nothing yet derives from a product's own pack manifest; and
route and visibility governance (`web-routes-clean`), where
`checkMaterialsVisibility` checks visibility for materials but
`publisher-web-route-check` still checks only the route-to-template
mapping. Planned, with no proof case because no qualification case
exercises them yet: surface documents; v0 Launch pack planning and
inventory (`@clossys/publisher/pack` ships `validatePackManifest`,
`computePackReadiness`, `planPackOrder`, and `detectExistingPackItems` as
library functions, but no command checks a real product's pack manifest
with them); templates and channel specs; channel kits; the site template
(shipped under `templates/site/`; Launcher does not apply it yet, #1215);
and live parity.
- Tighten the `@clossys/controller` dependency range from `~0.9.0` to
`~0.9.14`. `@clossys/publisher/pack` imports `packStatusToLifecycle`,
`PACK_STATUSES`, `LIFECYCLE_CONDITIONS`, and `LIFECYCLE_STATES` from
`@clossys/controller`, which first exports them in 0.9.14. The old range
also admitted earlier 0.9.x releases without them, including the 0.9.10
release on the public registry, against which importing
`@clossys/publisher/pack` fails at module load. The README's "Requirements
and version coupling" section no longer restates the dependency ranges, so
a release cannot leave it stale, and now names the root-entry imports from
`@clossys/controller` alongside the `./policy` subpath.
- The `foundry` manifest block now declares `outputs`, `feeds`, and `fit`
(package framework, #1172). `outputs` names only the two
`clossys/publisher/` paths this package's own code fixes: `pack.json` (the
Launch pack manifest `@clossys/publisher/pack` validates) and `surfaces/`
(read by the shipped site template, and matching `PUBLISHER_SURFACES_DIR`).
`feeds` hands `surface-documents` to Customer. `fit` names a new shipped
`fit-signals.json` with two signals: an audience-facing surface exists, and
the release must be proved afterwards. `intake` and `status` are not
declared yet.
- The `foundry` manifest block now declares `needs` and `solves` (package
framework, #1172). `needs` names four artifacts other roles feed:
Strategist's `strategy-brief`, Designer's
`token-contract-and-brand-overlay-binding`, Writer's `copy-registry`, and
Customer's `keep-verdict`. Designer's components are not listed: they reach
this package as imports of `@clossys/designer`, recorded in `dependencies`,
and a `needs` entry names an artifact another role feeds, not a package
import. Designer's logo and identity files are not listed either, because
that capability is still `planned`. `solves` claims the
`publisher-verified-release` problem, measured by the verified publication
rate, backed by `sealing-and-the-publication-record` and shown by the
`rate-violated` case, at `designed` evidence.
- The README explains that an exact pin of Writer, Designer or Controller outside Publisher's declared range installs a second, nested copy, and why to pin inside the range.
- README: the "Lifecycle vocabulary" section now matches the source. A pack
item's `status` is one of `PACK_STATUSES` (`absent`, `found`, `draft`,
`in-review`, `kept`, `published`), which `packStatusToLifecycle` maps onto
the six shared `LIFECYCLE_STATES`; it is not one of the shared states
itself, and `validatePackManifest` reports a shared state such as
`approved` as `invalid-status`. The `pack` export list now names the real
re-exports from `@clossys/controller` (`PACK_STATUSES`,
`LIFECYCLE_STATES`, `packStatusToLifecycle`, and the `PackStatus`,
`LifecycleState`, and `PackStatusLifecyclePosition` types) instead of
`LIFECYCLE_STATUSES`, `isLifecycleStatus`, `isLifecycleCondition`, and
`LifecycleStatus`, which this package does not export.
- Fix a `process.exit()`-after-write race in `publisher-web-route-check` (the
`checkWebRoutesCli.ts` CLI) that could truncate stdout under load; the CLI
now sets `process.exitCode` and lets the process exit naturally, matching
the pattern Foundry's other CLIs use.
- The changelog is no longer included in the package; it now lives in the public repository, linked from the README.
- The skill cites Strategist's records at `clossys/strategist/`.
- Remove the duplicated "How we work together" and "One question at a time"
sections from this package's packed skill (`skill/SKILL.md`).
`@clossys/launcher` injects the shared conversation contract when it
composes a skill for a consumer, so the packed skill no longer carries its
own byte-identical copy (#1182).
- Packed skill: cite the strategist handoff. writer cites an audience id,
approved claim ids (`claim:<id>`), applicable constraint ids
(`constraint:<id>`), and the current direction id, and never edits
`clossys/strategist/`. designer cites constraint ids and derived token slot names,
and never adds a brand attribute, color value, or type pairing inside
strategy records. customer speaks only from the audience
`situation`/`pains` Strategist recorded, never authors the audience
record, and does not inhabit until `strategist-check handoff` is green.
publisher seals against the projected strategy provenance
(`projectStrategyContract` / `createStrategyProvenance`) and never
authors strategy. Refs: #1120, #1121, #1122, #1123.
- Fix the remaining #1205 inconsistencies: Designer's and Writer's packed
skills now say they supply the tokens, atoms, blocks, and copy ids a
surface document cites by reference rather than co-authoring it, matching
Publisher's skill. Publisher's surface-ownership module no longer says the
shared consumer layout contract (#1171) has not landed; that contract now
names Publisher as the owner of `clossys/publisher/surfaces`. Launcher's
packed skill catalogue carries a copy of each role's skill, so it is
released alongside the skill edits (#1184).
- Updated dependency @clossys/writer to ^0.4.0
- Updated dependency @clossys/designer to ^0.6.0

## [0.6.0] - 2026-09-23

### Added

- `@clossys/publisher/materials`: the materials mini-site (#1206) —
  `renderMaterialsIndexHtml` (the browsable index, from the pack
  manifest), `selectAudienceVariant`/`declaredAudiences` (one source
  deck, filtered to declared per-slide audience selections),
  `renderPitchDeckHtml` (wraps `renderSlidesDeck`'s own rendered SVG
  slides into a self-contained HTML deck with keyboard navigation and the
  shared print stylesheet), `materialsPrintStylesheet`, and
  `checkMaterialsVisibility`/`MATERIALS_DEFAULT_VISIBILITY` (materials
  are internal by default; committing one to a public repository
  publishes it, and this is the refusal check for that).
- `@clossys/publisher/templates`: the pack's default templates and
  channel spec registry (#1207) — company overview and pitch deck
  defaults, an email signature builder (HTML and plain text),
  `SOCIAL_CHANNEL_SPECS`/`getSocialChannelSpec` (LinkedIn, X, Instagram,
  Facebook, YouTube, TikTok, GitHub), `OG_SHARE_CARD_SPEC`,
  `VIDEO_CALL_BACKGROUND_SPECS`/`getVideoCallBackgroundSpec` (Zoom,
  Google Meet, Microsoft Teams), and `staleChannelSpecEntries` for
  periodic re-verification.
- `templates/site/`: a Next.js App Router template for `apps/site`
  (#1208), shipped in the published tarball (`files` now includes
  `templates`) but not built, typechecked, or tested by this
  repository's own workspace.
- `publisher-preview` now renders the whole Launch pack, not just the
  shipped web views: `templates/site`'s own routes (rendered through the
  same `MarketingView`/`ErrorView` templates `apps/site` itself uses —
  the two Next.js metadata route handlers, `robots.ts`/`sitemap.ts`,
  have no view to render and are called out in `index.html` instead), the
  materials mini-site (company overviews at all three lengths, the
  default pitch deck, and one `selectAudienceVariant` filtered variant),
  the email kit (launch announcement, welcome, follow-up, and a
  signature, each in an email-width frame), and one SVG per
  `SOCIAL_CHANNEL_SPECS`/`OG_SHARE_CARD_SPEC`/`VIDEO_CALL_BACKGROUND_SPECS`
  entry — all from the same validated `brand.css`, all deterministic, and
  every string of prose sourced from the extended fixture copy registry
  (never hardcoded in a renderer). A new `index.html` links every file
  the command writes. The CLI's arguments and exit-code contract are
  unchanged.

## [0.5.0] - 2026-09-22

### Changed

- `@clossys/designer` dependency range further raised to `^0.5.0` (from
  `^0.4.12`), riding along with Designer's own 0.5.0 identity-kit release
  (issue #1210) — `dependencies` is packed content, so this repository's
  own release-readiness gate requires this version bump even though
  nothing in `src/` changed.

### Fixed

- Raised the `@clossys/designer` dependency floor from `^0.4.0` to `^0.4.12`.
  The pinned-runtime release-qualification run for 0.4.24 caught a real
  defect: the currently-published Designer is 0.4.7, which `^0.4.0`
  resolves cleanly, but this package's web templates import Designer's
  `MarketingChapter` block (a 0.4.12 addition) — so `import("@clossys/
  publisher/web")` threw `SyntaxError: ... does not provide an export named
  'MarketingChapter'` under both its ordinary and `react-server` conditions.
  Added a regression test (`src/web/react-server-artifact.test.ts`, part of
  this repository's own test suite — `*.test.ts` files are never shipped in
  the published package) that reproduces the exact 0.4.7-shaped Designer
  graph deterministically and proves the new floor refuses it.

### Added

- `@clossys/publisher/pack`: the v0 Launch pack manifest contract (#1204).
  Publisher plans first and seals last — types, `validatePackManifest`
  (schema, needs-graph, and lifecycle-vocabulary validation),
  `computePackReadiness`/`planPackOrder`/`sealableItemIds` (readiness and
  sealing derived from the `needs` graph), and `detectExistingPackItems`/
  `foundPackItem` (adopt-don't-override detection with sha256
  fingerprints). Pack item statuses and conditions use the one lifecycle
  vocabulary from #1228 (`absent`/`found`/`draft`/`approved`/`verified`/
  `retired`, `current`/`stale`/`blocked`) — a local copy pending #1237,
  which exports the same list from `@clossys/controller`; see this
  repository's own `pack/lifecycle.test.ts` (not shipped in the published
  package) for the premise-guard test.
- `@clossys/publisher/surfaces`: the one-owner-per-file contract for surface
  documents (#1205). Surface documents (which template, which sections,
  which copy ids and asset ids, all by reference) move from Designer/Writer
  co-authorship to Publisher, under `clossys/publisher/surfaces/`; Designer
  and Writer own everything a document references and propose changes and
  review renders in their own folders, but never edit a Publisher surface
  file directly. `validateSurfaceOwnership` is the gate: it flags any path
  more than one role claims. Updated the Publisher, Designer, and Writer
  skills to describe this ownership split; the shared consumer layout
  contract (#1171) has not landed in this repository yet, so
  `PUBLISHER_SURFACES_DIR` is this package's own record of the path pending
  that contract, and Writer's own removal of its former document-authoring
  role is left for a follow-up behind #1163.

## [0.4.24] - 2026-09-21

### Changed

- `tailwind-merge` peer and dev dependency raised to `^3.7.0` (from
  `^3.0.0`), riding along with the same bump in `@clossys/designer` —
  `peerDependencies` is packed content, so this repository's own
  release-readiness gate requires this version bump even though nothing in
  `src/` changed.

## [0.4.23] - 2026-09-21

### Added

- Consumer `defineWebTemplate` templates are data: a `blocks` sequence of
  Designer block kinds (`page-header`, `node-chapter`, `stat-grid`, and
  others) this package renders. Arbitrary `build` functions are refused on
  consumer templates; shipped views keep internal `build` implementations
  (#1103).
- `publisher-web-route-check` bin: fails when a publishing web route omits a
  registered `SurfaceDocument.template` name or composes `@clossys/designer`
  blocks directly in a route file. The route check ships as that bin for
  adopters and CI (#1103).
- `./core` publication-map document beside `SurfaceDocument`: path and slide
  locations, validation against registered templates, and resolve helpers for
  host routing (#1104).
- `SectionedViewDocument.sectionGroundRhythm` (`base-then-sunken`) fills omitted
  section grounds as `base` then `sunken` in document order; explicit
  `ground` values (including `inverse`) are never overwritten (#1105).
- Closed `SectionedView` section kinds `pricing`, `testimonial`, and `stat`:
  copy refs, optional eyebrow on `pricing`, `ground`, and no node escape.
  Each kind renders through Designer `PricingTable`, `Testimonial`, and
  `Stat` respectively; `ground` is applied with `SECTION_GROUND_CLASSES`
  where the block does not accept it. Unknown kinds are still refused by
  name (#1106).
- `publisher-preview` CLI: after `readBrandCss` and `checkBrandFileCoverage`
  succeed, renders fixture documents for every shipped web view
  (`MarketingView`, `SectionedView` including `pricing` / `testimonial` /
  `stat`, `AuthView`, `ErrorView`, `CaptureView`, `DocumentView`,
  `CollectionView`) into a static `gallery.html` using an in-package
  `CopyRegistry` of approved placeholder copy (#1107).
- Brand-asset roster roles on top of the image/video registry: favicon SVG,
  32px PNG, apple-touch 180, maskable 192 and 512, Open Graph 1200×630,
  Twitter image 1200×630, and email-safe PNG 600×200. Each role requires
  alt text and a non-empty src. A derivative reads the master SVG and the
  roster check fails until every role exists at its required pixel size
  (#1110).
- A complete roster emits favicon and apple-touch links for a publication
  map that contains a web path (#1110).
- `BrandGuideView` and `SystemAuditView` are catalog templates. `publisher-preview`
  takes an optional third `roster.json` argument; when given and the
  brand-asset roster is complete, it writes `guide.html` and `audit.html`
  beside `gallery.html` from the same `brand.css` and roster after the
  brand-file check passes. Fixture copy ships with the package. Strategist
  facts are cited beside the tokens; this package does not change
  Strategist (#1111).
- Web head metadata: Open Graph URL (`og.url`), Twitter image
  (`twitter.image`), and hreflang alternates (`hreflangAlternates`) on
  `WebMeta` / `SurfaceWebMeta`, emitted from `buildWebHeadMetadata`
  (#1108).

## [0.4.22] - 2026-09-21

### Changed

- Web golden markup for `MarketingView` and `SectionedView` matches Designer
  0.4.16 logical inline utilities (`text-start`, `ps-lg`) and shell footer
  ink on inverse-ground plates.
- Skill: names `publisher-web-route-check` and documents consumer templates
  as `blocks`, not route-local `build` functions (#1103).
- `MarketingView` passes semantic `ground` through to its hero, feature grid,
  FAQ, and closing CTA bands (defaulting to base/sunken alternation) (#1105).

## [0.4.21] - 2026-09-21

### Fixed

- Install section names `https://registry.npmjs.org` and states that
  installing requires no authentication, without GitHub-token wording that
  could be read as a prerequisite. Peer-install notes no longer name a
  retired registry lane as if it were current install guidance. (#924)

## [0.4.20] - 2026-09-21

### Changed

- README: declared escape, metric, reconciliation loop, measurer, and close
  condition for the publisher role (#446). Names the #502 reconciler blocker
  so unmeasured rates are not mistaken for zero escapes.

## [0.4.19] - 2026-09-21

### Changed

- README: documents the three SectionedView contract holds measured in
  issue #756 (required status-list `labels`, required step `ordinal`
  CopyRef, non-empty repeating arrays) so adopters can convert recorded
  refusals into upgrades or permanent local seams.

## [0.4.18] - 2026-09-21

### Added

- `./record` reconciliation contracts: `proposeRegistryPublicationEntry`
  (publish-path ledger producer), `checkRegistryPublicationReconciliation`
  (ledger vs independent registry witness), `asLedgerDriftSubject` (drift-check
  subject pairing), and `registryPublicationEntryId`.

### Changed

- README distinguishes gate-loop staging evidence from
  reconciliation loops that require a publish-path ledger producer plus an
  independent witness; document that this repository's own npm publish
  reconciliation uses governance publication records, not a persisted
  `./record` ledger.

## [0.4.17] - 2026-09-21

### Added

- `SectionedViewDocument` hero sections may carry optional `media`
  (`{ assetId, alt }`), with `alt` as a `CopyRef` and `assetId` resolved at
  render time through `SectionedView`'s `resolveAssetId` — the same seam as
  `MarketingView`'s `heroMedia`. Hero media switches Designer `Hero` to the
  two-column layout (`tablet:grid-cols-2`).
- A closed `stat-grid` section kind maps each row onto Designer `Stat` with
  `CopyRef` label, value, optional delta/trend, and optional description.

### Changed

- `SectionedView` passes explicit Hero `composition` (`split` when hero media
  is present), matching `MarketingView` and Designer 0.4.12 layout rules.
- SectionedView and MarketingView golden markup match Designer 0.4.12 display
  measure classes (`max-w-display` on Hero headings and lead copy).
- README and skill: six shipped `SectionedView` kinds; hero `actions` still
  render as underlined anchors into `Hero`'s `actions` slot (data-shaped
  `href` contract unchanged). `article-body` / `section-header` remain out of
  contract — compose those blocks in the consumer or via `defineWebTemplate`.

## [0.4.16] - 2026-09-21

### Changed

- Packed skill: seal an approved named surface after a keep — head,
  OG/meta join, and release proof — and verify the exact shipped result;
  do not author the in-tree `SectionedView` or `MarketingView` page
  document, select templates from business intent, own the app router, or
  lock final copy. Refs: #1027.

### Added

- `SectionedView` resolve-then-render integration coverage for grouped
  and flat `status-list` sections.

## [0.4.10] - 2026-09-21

### Changed

- `MarketingView` passes explicit Hero `composition` (`split` when media is
  present) and golden markup matches Designer 0.4.12 display measure
  classes.

## [0.4.9] - 2026-09-21

### Changed

- Packed skill Pre-auth section: bounded taste pass after `designer-fold-check` is green (see PRE-AUTH-QUALITY, the brief that ships with `@clossys/designer`).

## [0.4.8] - 2026-09-21

### Changed

- `validateSectionedViewDocument` and `resolveSectionedViewDocument` refuse
  unknown section kinds and name the unsupported kind in the finding or
  error; there is no implicit flatten into `feature-grid` or any other
  shipped kind.
- `resolveSurfaceDocument` accepts optional `knownTemplates`; when set, an
  unregistered `surface.template` refuses at resolve time with
  `unsupported-template` and names the template.
- README and packed skill: choose shipped templates when slots fit; register
  `defineWebTemplate` for custom page bands; route-local block composition
  is a workaround, not the extension path.

## [0.4.7] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.4.6] - 2026-09-20

### Added


### Changed

- README: `MarketingView` is the primary pre-auth marketing template;
  `SectionedView` is documented only for the closed five section kinds.
- README/skill: first-viewport `heroActions` carries one primary CTA;
  `heroMedia` is product surface or original art, not decorative stock.
  Publisher seals after a synthetic-user keep and does not inhabit the
  persona.

## [0.4.5] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `verified publication rate`, computed by
  `assessVerifiedPublicationRate()`. An empty evaluated set is
  indeterminate, never a perfect rate of 1. `publisher-media-check` and
  `publisher-record-check` remain the gates they are; neither is this
  rate. The record half still records and does not judge.
- Declared `foundry.assessment` against a new mapped `publisher-rate-check`
  bin with `invocation: "single-json-input"`. The two existing publisher
  bins remain gates and are not the assessment surface. Advisor remains
  the only required first-day role.
- Public `./assessment` subpath for `assessVerifiedPublicationRate`.
- `publisher-rate-check assessment.json`: prints the `verified publication
  rate` report and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.4.5` is
  deferred under #833.

## [0.4.4] - 2026-09-16

### Fixed

- `resolveSectionedViewDocument` no longer writes both `groups` and `items`
  as own keys on a resolved status-list section. It previously used optional
  chaining (`groups: section.groups?.map(...)`), which sets the VALUE to
  `undefined` but still creates the KEY. `SectionedView` decides grouped-vs-flat
  with `Object.hasOwn`, which is true for a key holding `undefined`, so its
  "exactly one of groups or items" check saw both and threw — for every
  status-list section, whether the source carried `groups`, `items`, or one of
  each. Rendering any status-list section was impossible in 0.4.3.

  The resolver now spreads each key conditionally, so exactly the one the
  source declared survives. `groups` and `items` are also destructured out of
  the spread base, because spreading the whole section would carry the
  unresolved shapes alongside the resolved ones.

  A test pins the resolved own-key set in both directions — grouped sections
  carry `groups` and not `items`, flat sections the reverse.

## [0.4.3] - 2026-09-14

### Changed

- Patch version bump only, to obtain a fresh, never-before-used
  `governance/release-qualifications/` record path. The 0.4.2 qualification
  record added by #811 was orphaned when that pull request was squash-merged
  (#821) and had to be removed (#834); the immutability gate that protects
  already-introduced record paths (`check-candidate-qualification.mjs`'s
  single-introduction-commit invariant) means a valid record can never again
  be introduced at the `0.4.2` path, so this package moves to `0.4.3`
  purely to regain one. No functional or behavioral change.


## [0.4.2] - 2026-09-09

### Changed

- Historical entries below now describe the previous npm scope without naming
  the producer account this catalogue no longer publishes under, and links to
  this repository use its current `clossys/foundry` path. No date, version,
  or recorded fact changed — only the way the retired scope is referred to.


## [0.4.1] - 2026-09-02

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.4.0] - 2026-09-02

### Added

- Relaxed `SectionedViewDocument`'s hero rule from "exactly one hero section,
  and it must be first" to "at most one hero section, anywhere in the
  document." A document with zero heroes, or with a hero that is not the
  first section (a closing call-to-action band, say), now validates.
  `SectionedView` was already forgiving of a hero's position when rendering
  (`headingLevel` is 1 only at section index 0, 2 otherwise); this only
  widens the validation and render-time assertion to match. A document
  carrying a single leading hero — every document that validated before —
  still validates and renders identically.
- Made a `status-list` section's `groups` optional and added a sibling
  `items` field: a flat, ungrouped array of the same status-item shape,
  for the common case of a short list with nothing to group. Provide
  exactly one of `groups` or `items`. Renders through Designer `0.4.0`'s
  new `StatusList` `items` prop as a single definition list with no group
  heading. A document using `groups` — every document that validated
  before — still validates and renders identically.

### Changed

- Raised the runtime Designer floor from `^0.3.0` to `^0.4.0`. The
  `status-list` `items` field above renders into Designer 0.4.0's new
  `StatusList` `items` prop, which the older range does not resolve.

Both of the additions above are optional and additive: a document that
validated before still validates, and a document carrying a single leading
hero with grouped status-list items — the shape every document authored
against 0.2.1 through 0.3.1 already has — renders byte-for-byte the markup
it always did, asserted against the same frozen captured markup this
package's tests have used since the 0.3.0 additive round rather than merely
described. This is a minor rather than a patch because 0.x caret and tilde
ranges are minor-locked, so a consumer that wants either relaxation widens
its declared range deliberately.

## [0.3.1] - 2026-09-02

### Changed

- Widened the `@clossys/controller` runtime dependency range from `~0.8.0` to `~0.9.0` to cover controller's 0.9.0 release. No other change.

## [0.3.0] - 2026-09-01

### Added

- Added an optional `eyebrow` `CopyRef` to the `feature-grid`, `faq`,
  `ordered-step-sequence`, and `status-list` sections of
  `SectionedViewDocument`. Only `hero` carried one before, so authored eyebrow
  copy for any other section had nowhere to go.
- Added an optional `actions` list to the `SectionedViewDocument` hero
  section: data-only `{ id, label, href }` entries whose `href` is held to the
  same sanctioned-target rule the other server-rendered views use, rendered
  into the Designer `Hero` block's existing actions slot. A document could not
  express a hero call to action at all before, even though the block beneath
  it always had the slot.
- Added an optional `detail` `CopyRef` to a `status-list` item, carrying that
  row's own explanation, including the reasoning behind a `not-offered`
  answer. That reasoning previously had to be folded into the row label or
  left off the page.
- Added the optional `landmark` prop to `SectionedView`. The default, `"main"`,
  is unchanged; `"none"` renders the same sections without the view's own
  `main` landmark, so a page can mount the subset this contract expresses and
  keep the rest inside a landmark it owns. Partial adoption previously had to
  choose between a second `main` landmark and leaving real content outside the
  only one.

### Changed

- Raised the runtime Designer floor from `^0.2.7` to `^0.3.0`. The non-hero
  `eyebrow` slot and the per-row `detail` slot that the new document fields
  render into are Designer 0.3.0 additions, and 0.x caret ranges are
  minor-locked, so the older range would resolve a Designer without them.

Every one of these is optional and additive: a document that validated before
still validates, and a document carrying none of them renders byte-for-byte
the markup it did at 0.2.1, which is asserted against frozen captured markup
rather than described. This is a minor rather than a patch because 0.x caret
and tilde ranges are minor-locked, so a consumer that wants any of the four
widens its declared range deliberately.

## [0.2.1] - 2026-09-01

### Fixed

- Normalized both published CLI targets so npm preserves the declared
  `publisher-media-check` and `publisher-record-check` bin map without
  auto-correction. The unpublished 0.2.0 dry-run candidate was rejected and
  is not publication evidence.

## [0.2.0] - 2026-08-31

### Added

- Added the closed, provenance-preserving `SectionedView` web renderer for
  resolved `SectionedViewDocument` models. It maps the five approved section
  kinds to Designer 0.2.7's ground-aware server-safe blocks without opening a
  caller-authored node or styling escape hatch.
- Added the separate `not-offered` status disposition and its localized label,
  keeping deliberate non-capabilities outside the readiness axis.

### Changed

- Raised the runtime Designer floor to `^0.2.7`, which supplies the
  server-safe section-ground, ordered-step, and status-list blocks required by
  `SectionedView`. This source version is intentionally unqualified and
  unpublished; exact-head qualification remains required.

## [0.1.11] - 2026-08-31

### Changed

- Advanced the source to the later trusted-publisher/OIDC successor after the
  owner-present 0.1.10 first publication. This source-only change is neither
  qualification nor publication evidence: a future 0.1.11 candidate requires
  fresh exact-head qualification, release checks, and registry verification.

## [0.1.10] - 2026-08-31

### Changed

- Advanced the first-publication source candidate after the immutable 0.1.9
  qualification was quarantined as unpublished: its retained tarball was
  produced outside the required release runtime and cannot be rewritten under
  the append-only qualification contract. This 0.1.10 source is not yet
  qualified or published; its future candidate must be packed and replayed
  with the pinned release runtime.

## [0.1.9] - 2026-08-31

### Fixed

- Declared Designer's optional `@internationalized/date`,
  `react-aria-components`, `tailwind-merge`, and `tailwindcss` peers directly
  and installed their exact qualification versions. A clean public-registry
  consumer can now import both ordinary and `react-server`
  `@clossys/publisher/web` instead of failing on Designer's absent transitive
  optional peers. The rejected 0.1.8 candidate was never published. The
  immutable 0.1.9 qualification is retained as quarantined evidence only;
  the source's next first-publication candidate is 0.1.10.

## [0.1.8] - 2026-08-31

### Fixed

- Added a `react-server` target for `@clossys/publisher/web`. Its runtime
  exports match the ordinary target, while `MarketingView`, `AuthView`, and
  `ErrorView` resolve only Designer's server-safe barrels and the server FAQ
  renders as native `details`/`summary`. Ordinary imports retain the React
  Aria FAQ. The runtime dependency floor is now `@clossys/designer ^0.2.4`,
  the first release that exports `Faq` from its server-safe blocks barrel.

## [0.1.7] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.6] - 2026-08-30

### Fixed

- Corrected exact-pin consumer guidance to require Writer `0.3.x`, matching
  this package's real `@clossys/writer ^0.3.0` runtime dependency, rather
  than directing a clean consumer to the incompatible historical `0.2.x`
  line.

## [0.1.5] - 2026-08-29

### Security

- Replaced the ambiguous OKLCH argument and numeric-token regular expressions
  with single-pass scanners, so hostile malformed public input is rejected in
  linear time without changing valid color conversion behavior.

## [0.1.4] - 2026-08-24

### Fixed

- Updated README references to the active Strategist package and corrected
  historical donor availability with a lifecycle note.

## [0.1.3] - 2026-08-21

### Changed

- Widened the declared `@clossys/writer` dependency range from
  `^0.2.0` to `^0.3.0`. `writer` 0.3.0 (issue #373) added the passage
  layer — `checkPassageComposition`, `readPassageRecord`, the
  `writer-check passages` CLI subcommand, and their supporting types — a
  purely additive feature, not a patch; `^0.2.0` does not resolve `0.3.0`
  (0.x ranges are minor-locked), so the old declared range would have kept
  this package pinned to the superseded release. No source in this
  package imports the new passage-layer surface; this is purely picking
  up the new range.

## [0.1.2] - 2026-08-21

### Changed

- Widened the declared `@clossys/writer` dependency range from
  `^0.1.0` to `^0.2.0`. `writer` 0.2.0 (issue #407) changed
  `writer-check addressability`'s exit-code precedence — a real violation
  now wins over an incomplete scan — which is a behavioural contract
  change, not a patch; `^0.1.0` does not resolve `0.2.0` (0.x ranges are
  minor-locked), so the old declared range would have kept this package
  pinned to the superseded precedence. No source in this package imports
  `checkAddressability` or otherwise depends on the changed behaviour
  directly; this is purely picking up the new range.

  This release is `0.1.2` rather than `0.1.1` because the `designer`
  widening below took `0.1.1` first, on a branch developed in parallel with
  this one. Both widenings are carried here together. Resolving that
  collision by keeping only one side would have shipped this package with
  the other range still pointing at a superseded version, and no gate would
  have failed — an un-widened range still resolves against the older
  published release, so it would simply never widen.

## [0.1.1] - 2026-08-21

### Changed

- **Widened the `@clossys/designer` dependency range to `^0.2.0`.** A
  runtime dependency range is shipped content, so it moves this package's
  version even though no code here changed. See
  [issue #405](https://github.com/clossys/foundry/issues/405), which
  added `designer`'s `environment-conformance` gate
  (`designer-environment-check`, `checkEnvironmentConformance`) and bumped
  `designer` to `0.2.0`.

## [0.1.0] - 2026-08-21

First release. This package is the publisher role, fused from two donors in
the previous scope — `surface` (the composer half) and `ledger`
(the record half) — per
[decision 10](../../docs/DECISIONS.md#10-recutting-the-expression-surface-into-role-shaped-packages).
The role's exclusive question: *did we put it out to an audience, and can we
prove what shipped?*

This changelog starts here rather than carrying either donor's history,
which cites decisions and issues that would mean nothing — or the wrong
thing — to a reader who arrives at this package first.

### Added

- Surface composition, media registries, and channel renderers for web,
  email, print, images, and slides, plus a product-neutral
  structured-document contract — unchanged from the previous scope's `surface`,
  under the same eight subpaths: `./core`, `./media`, `./web`, `./document`,
  `./email`, `./print`, `./image`, `./slides`.
- An append-only, content-addressed record of what was published, to which
  channel, when, citing which facts, plus a drift checker and a join-key
  completeness checker — unchanged from the previous scope's `ledger`, now under
  a ninth subpath, `./record`.
- Two bins: `publisher-media-check` (the composer's media-registry gate) and
  `publisher-record-check` (the record's drift/append-only/join-key gates,
  with `append-only` and `join-key` reachable as subcommands). Both dispatch
  on `argv[0]`/`argv[1]` matching exactly — never on
  `basename(process.argv[1])`, which would see `cli.js` and silently run the
  wrong command wherever a gate is invoked by compiled path, the same
  convention every other package in this repository's rename series holds
  to.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`, following the convention the operation packages adopted in
  #417. A consumer reading the installed package should not have to leave it
  to find out what changed; a new package should be born with the current
  convention rather than inheriting either donor's gap.

### Why one package, not two

`publisher` is one package, not two, for a reason stated in decision 10 and
worth restating here: composition without a record is unprovable, and every
time the publisher runs, the record runs — there is no publish that
legitimately skips it. That argues for one install and one version, which
one package with a `./record` subpath delivers.

The measurement that originally argued for splitting `surface` and `ledger`
into two packages is accommodated, not overturned: **the record shares no
code with the composer and does not import it, in either direction.**
`./record`'s own source imports only `@clossys/controller/policy`
and its own relative files; nothing under `./core`, `./media`, `./web`,
`./document`, `./email`, `./print`, `./image`, or `./slides` imports
anything under `./record`, or vice versa. Fusing the *packaging* was never
the same as fusing the *dependency graph*, and only the second would have
cost anything. A publication record is a DOCUMENT the composer never
imports.

### Changed from the previous scope's `surface` and `ledger`

- **The package is named for the job, not the artifact.** The role's
  exclusive question is *did we put it out to an audience, and can we prove
  what shipped?* A name that describes a thing rather than a doer is an
  artifact, and an artifact belongs inside a role.
- **Seven import specifiers repointed, verified against the real `exports`
  maps of their new targets, not assumed:**
  - the donor scope's `copy` → `@clossys/writer` (writer's `"."`
    export)
  - the donor scope's `copy/voice` → `@clossys/writer/voice`
    (writer's `"./voice"` export)
  - the donor scope's `ui` → `@clossys/designer` — **not actually
    imported anywhere in the composer's source**; that donor has
    no `"."` export either in the donor or in `designer`, and grepping
    `surface/src` turned up zero real (non-comment) imports of the bare
    specifier. Listed for completeness; nothing to repoint.
  - the donor scope's `ui/atoms` → `@clossys/designer/atoms`
    (designer's `"./atoms"` export)
  - the donor scope's `ui/blocks` → `@clossys/designer/blocks`
    (designer's `"./blocks"` export)
  - the donor scope's `ui/shell` → `@clossys/designer/shell`
    (designer's `"./shell"` export)
  - the donor scope's `ui/tokens` → `@clossys/designer/tokens`
    (designer's `"./tokens"` export)

  All prose (doc-comment) mentions of the donor scope's `copy` and
  `ui` — not just real `import` statements — were updated
  the same way, the same treatment `writer` and `designer` gave their own
  self-references.
- **The bins are `publisher-media-check` and `publisher-record-check`, not
  `surface-media-check` and `ledger-check`.** Same two programs, renamed to
  match the role. `publisher-record-check` keeps `ledger-check`'s two
  subcommands (`append-only`, `join-key`) unchanged — only the bin name
  moved, never the dispatch logic or the subcommand names, since those name
  what each gate checks, not who runs it.
- **Nothing else was renamed.** `SurfaceDocument`, `ComposeDocument`,
  `renderWebDocument`, `AssetEntry`, the whole `media`/`web`/`document`/
  `email`/`print`/`image`/`slides` vocabulary, and — on the record side —
  `PublicationEntry`, `Ledger`, `FactCitation`, `appendEntry`,
  `checkLedgerDrift`, `checkAppendOnly`, `checkJoinKeyCompleteness`, all keep
  their names. A role owns artifacts; renaming the role does not rename what
  it composes or what it records. A sweep that also renamed the vocabulary
  would have made the diff unreviewable while changing no behaviour.
- Self-referential `surface` and `ledger`
  package-name mentions in doc comments were updated to
  `@clossys/publisher` (and, where the mention was specifically
  about the record half, `@clossys/publisher`'s `./record`
  subpath) — the same treatment `strategist`, `writer`, and `designer` gave
  their own self-references. A citation of a donor BY NAME, describing
  provenance (e.g. "recut from the previous scope's `surface`"), is left as-is —
  that is a historical fact, not a stale specifier.
- **Dependencies changed shape, not just name.** `surface` declared
  the donor scope's `copy` (`~0.10.0`) and its `ui` (`~0.15.0`);
  `ledger` declared `@clossys/controller` (`~0.8.0`). This package
  declares `@clossys/writer` (`^0.1.0`), `@clossys/designer`
  (`^0.1.0`), and `@clossys/controller` (`~0.8.0`, unchanged range).
  `writer` and `designer` are caret ranges because they are fresh `0.x` role
  packages starting at `0.1.0`; `controller` stays a tilde range, carried
  over unchanged from `ledger` — a caret range on a `0.x` package is
  patch-only under semver and has broken this repository's CI before.
  `./record` continues to import only `@clossys/controller/policy`,
  never `@clossys/controller/gates`, which drags a runtime
  TypeScript import this package has no reason to take on.

### On the donors, and why neither is deprecated yet

> **Current lifecycle note:** the previous scope's `surface` and
> `ledger` are now retired. This release note records their
> state at 0.1.0; the lifecycle contract is the authority for current
> availability.

The previous scope's `surface` and `ledger` both stay
`published` for now. Neither can be marked deprecated while nothing else in
this repository has moved to depend on `publisher` instead — the donors
deprecate together, once `publisher` is what the rest of the workspace
actually depends on. `check:package-governance` enforces that a live
package cannot depend on a deprecated one; deprecating either donor before
that migration would trip it for anyone still consuming `surface` or
`ledger` directly.

This is a deferral with a trigger, not an omission.

### Not included

- **No forwarding stub in either donor.** The previous scope's `surface` and
  `ledger` remain independently installable, with no
  re-export pointing here. A stub would keep the old names importable, and a
  supersession check could then never reach zero — the forwarding layer
  would defeat the gate built to prove the swap completed.
- **No new coupling between the two halves.** `./record` does not import
  `@clossys/writer` or `@clossys/designer`; nothing under
  `./core`, `./media`, `./web`, `./document`, `./email`, `./print`,
  `./image`, or `./slides` imports `./record`. Fusing the packaging was a
  decision about install/version granularity, never about the dependency
  graph.
