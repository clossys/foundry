import { createCopyResolver } from "@clossys/writer";
import type { CopyRef } from "@clossys/writer";
import type {
  SectionedViewContentSection,
  SectionedViewDocument,
  SectionedViewHeroSection,
  SectionedViewSpecimenPanel,
  SectionedViewSpecimenStatus,
  SectionedViewSpecimenTone,
} from "../core/sectioned-view.js";

/**
 * The content catalog's fixture: one `SectionedViewDocument` that shows every
 * content-section module and specimen arrangement, rendered by
 * `render-content-catalog.ts` through `LandingView`. All copy is sample copy
 * for an invented facilities-maintenance product; every name and figure is
 * made up. Each band is written either at a realistic length (`typical`) or
 * at the longest the copy cookbook allows (`max`), so a reviewer sees both.
 */

const CATALOG_COPY = new Map<string, string>();

/** Registers `text` under `id` and returns its `CopyRef`. An id is registered once. */
function copy(id: string, text: string): CopyRef {
  const key = `catalog.${id}`;
  if (CATALOG_COPY.has(key)) throw new Error(`content catalog fixture registers ${key} twice`);
  CATALOG_COPY.set(key, text);
  return { id: key };
}

function status(id: string, tone: SectionedViewSpecimenTone, text: string): SectionedViewSpecimenStatus {
  return { tone, label: copy(`${id}.status`, text) };
}

/** A fields part from `[label, value]` pairs. */
function fields(id: string, pairs: readonly (readonly [string, string])[], columns?: 1 | 2 | 4) {
  return {
    id,
    type: "fields" as const,
    ...(columns === undefined ? {} : { columns }),
    items: pairs.map(([label, value], index) => ({ id: `f${index + 1}`, label: copy(`${id}.f${index + 1}.label`, label), value: copy(`${id}.f${index + 1}.value`, value) })),
  };
}

/** Which copy length a band is written at. */
export type ContentCatalogBudget = "typical" | "max";

/** The preview-chrome caption shown above one band. Never rendered inside the page itself. */
export interface ContentCatalogCaption {
  /** The band's section id (the call to action's `id` for the closing band). */
  sectionId: string;
  /** What the band shows, for example "Specimen, stacked, row of 3". */
  title: string;
  /** Layout, ground and treatment details. */
  detail: string;
  budget: ContentCatalogBudget;
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

const hero: SectionedViewHeroSection = {
  id: "catalog-hero",
  kind: "hero",
  ground: "inverse",
  eyebrow: copy("hero.eyebrow", "Facilities maintenance records"),
  heading: copy("hero.heading", "Every work order, inspection and repair in one record"),
  description: copy(
    "hero.description",
    "Fieldmark keeps each site's work orders, inspection results and service history in one place, so supervisors can see what is open, what is overdue and who holds each job before the week starts.",
  ),
  actions: [{ id: "walkthrough", label: copy("hero.action", "Book a walkthrough"), href: "#catalog-close" }],
};

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

const introMax: SectionedViewContentSection = {
  id: "catalog-intro",
  kind: "content-section",
  ground: "base",
  eyebrow: copy("intro.eyebrow", "How the record works"),
  heading: copy("intro.heading", "One record replaces the binder, the inbox and the spreadsheet"),
  description: copy(
    "intro.description",
    "Technicians log work where it happens, supervisors assign and close it, and the record keeps every reading, photo and signature against the asset it belongs to. Nothing is retyped at month end, and nothing lives in one person's notebook.",
  ),
  actions: [
    { id: "record", label: copy("intro.action.record", "See an example"), href: "#catalog-specimen-single" },
    { id: "faq", label: copy("intro.action.faq", "Read the FAQ"), href: "#catalog-faq" },
  ],
};

const workOrderPanel: SectionedViewSpecimenPanel = {
  id: "work-order",
  title: copy("single.panel.title", "WO-2214 · Rooftop air handler AHU-3"),
  meta: copy("single.panel.meta", "North depot · Opened 3 Mar · Priority 2"),
  status: status("single.panel", "warning", "Awaiting parts"),
  parts: [
    fields("single.fields", [
      ["Asset", "AHU-3"],
      ["Location", "Roof, block B"],
      ["Fault", "Belt wear"],
      ["Reported by", "Site lead"],
      ["Due", "7 Mar"],
      ["Cost code", "MNT-04"],
    ]),
    {
      id: "checks",
      type: "status-rows",
      items: [
        { id: "filter", label: copy("single.check.filter", "Filter condition"), status: status("single.check.filter", "success", "Pass") },
        { id: "belt", label: copy("single.check.belt", "Belt tension"), status: status("single.check.belt", "danger", "Fail") },
        { id: "drain", label: copy("single.check.drain", "Drain pan"), status: status("single.check.drain", "warning", "Recheck") },
      ],
    },
    {
      id: "pressure",
      type: "meter",
      label: copy("single.meter.label", "Static pressure"),
      value: 1.8,
      scaleMax: 3,
      limit: 2.5,
      direction: "max",
      tone: "info",
      valueText: copy("single.meter.value", "1.8 in. wg"),
      limitText: copy("single.meter.limit", "Limit 2.5"),
      status: status("single.meter", "success", "Within limit"),
      note: copy("single.meter.note", "Read on site, 3 Mar"),
    },
  ],
  footer: { assignee: { initials: copy("single.assignee.initials", "JP"), name: copy("single.assignee.name", "J. Park") }, note: copy("single.footer.note", "Parts ordered 4 Mar") },
};

const specimenSingle: SectionedViewContentSection = {
  id: "catalog-specimen-single",
  kind: "content-section",
  ground: "sunken",
  eyebrow: copy("single.eyebrow", "Work orders"),
  heading: copy("single.heading", "Each job carries its own evidence from open to close"),
  description: copy(
    "single.description",
    "A work order holds the asset, the fault, the readings taken and the sign-off, so the person who closes it and the person who audits it see the same thing.",
  ),
  media: {
    type: "specimen",
    label: copy(
      "single.label",
      "A work order for a rooftop air handler, showing its fields, three inspection checks, a pressure reading against its limit and the assigned technician.",
    ),
    arrangement: "single",
    panels: [workOrderPanel],
  },
};

const featuresPlain: SectionedViewContentSection = {
  id: "catalog-features-plain",
  kind: "content-section",
  ground: "base",
  eyebrow: copy("plain.eyebrow", "Daily work"),
  heading: copy("plain.heading", "Less chasing, more time on the floor"),
  description: copy("plain.description", "The three things a site team does every day, each recorded once and visible to everyone who needs it."),
  module: {
    type: "features",
    columns: 3,
    treatment: "plain",
    items: [
      { id: "log", icon: "clock", heading: copy("plain.log.heading", "Log in seconds"), description: copy("plain.log.description", "Technicians record a reading or a photo from the asset tag, offline if needed.") },
      { id: "assign", icon: "users", heading: copy("plain.assign.heading", "Assign by skill"), description: copy("plain.assign.description", "Supervisors route each job to the trade and shift that can close it.") },
      { id: "close", icon: "file-check", heading: copy("plain.close.heading", "Close with proof"), description: copy("plain.close.description", "A job closes only with its readings, its sign-off and its parts recorded.") },
    ],
  },
};

const scheduleRow = (id: string, date: string, label: string, amount: string, tone: SectionedViewSpecimenTone, state: string) => ({
  id,
  date: copy(`split-end.schedule.${id}.date`, date),
  label: copy(`split-end.schedule.${id}.label`, label),
  amount: copy(`split-end.schedule.${id}.amount`, amount),
  status: status(`split-end.schedule.${id}`, tone, state),
});

const splitEnd: SectionedViewContentSection = {
  id: "catalog-split-end",
  kind: "content-section",
  ground: "sunken",
  layout: "split",
  mediaSide: "end",
  eyebrow: copy("split-end.eyebrow", "Inspections"),
  heading: copy("split-end.heading", "Overdue checks surface before they become findings"),
  description: copy("split-end.description", "Each recurring inspection carries its interval and its last result, so the schedule shows what is due this week."),
  actions: [{ id: "schedule", label: copy("split-end.action", "See the schedule"), href: "#catalog-specimen-stack" }],
  media: {
    type: "specimen",
    label: copy("split-end.label", "An inspection schedule for one site, listing five recurring checks with their due dates and current results."),
    panels: [
      {
        id: "schedule",
        title: copy("split-end.panel.title", "Inspection schedule · East yard"),
        meta: copy("split-end.panel.meta", "Week 11"),
        parts: [
          {
            id: "week",
            type: "schedule",
            items: [
              scheduleRow("anchor", "Fri 7 Mar", "Roof anchor test", "45 min", "danger", "Overdue"),
              scheduleRow("doors", "Mon 10 Mar", "Fire door audit", "2 h", "success", "Done"),
              scheduleRow("lighting", "Tue 11 Mar", "Emergency lighting", "1 h", "success", "Done"),
              scheduleRow("forklift", "Wed 12 Mar", "Forklift pre-use", "20 min", "warning", "Due today"),
              scheduleRow("sprinkler", "Thu 13 Mar", "Sprinkler valves", "1 h 30 min", "neutral", "Scheduled"),
            ],
          },
        ],
      },
    ],
  },
};

const featuresRule: SectionedViewContentSection = {
  id: "catalog-features-rule",
  kind: "content-section",
  ground: "base",
  eyebrow: copy("rule.eyebrow", "Built for multi-site teams"),
  heading: copy("rule.heading", "The same record works for one building or for forty"),
  description: copy(
    "rule.description",
    "Sites share one asset register and one set of procedures, while each keeps its own schedule and team, and reports roll up across sites without anyone rebuilding them.",
  ),
  module: {
    type: "features",
    columns: 4,
    treatment: "rule",
    items: [
      {
        id: "register",
        heading: copy("rule.register.heading", "One register for every asset"),
        description: copy("rule.register.description", "Each pump, panel and vehicle has one entry, with its location, its manuals and its full service history attached."),
      },
      {
        id: "procedures",
        heading: copy("rule.procedures.heading", "Procedures written once, used everywhere"),
        description: copy("rule.procedures.description", "A checklist is written once and every site runs that same version, so results compare across buildings and across years."),
      },
      {
        id: "schedules",
        heading: copy("rule.schedules.heading", "Schedules that respect each site"),
        description: copy("rule.schedules.description", "Each site sets its own intervals, shifts and closed days, and the schedule plans every job around them automatically."),
      },
      {
        id: "reports",
        heading: copy("rule.reports.heading", "Reports without the monthly rebuild"),
        description: copy("rule.reports.description", "Completion rates, overdue checks and spend by site come from the record itself, ready to send on the first day."),
      },
    ],
  },
};

const historyRow = (id: string, field: string, person: string, when: string, tone: SectionedViewSpecimenTone, state: string) => ({
  id,
  cells: [
    { text: copy(`split-start.table.${id}.field`, field) },
    { text: copy(`split-start.table.${id}.person`, person) },
    { text: copy(`split-start.table.${id}.when`, when) },
    { status: status(`split-start.table.${id}`, tone, state) },
  ],
});

const splitStart: SectionedViewContentSection = {
  id: "catalog-split-start",
  kind: "content-section",
  ground: "sunken",
  layout: "split",
  mediaSide: "start",
  eyebrow: copy("split-start.eyebrow", "Audit trail"),
  heading: copy("split-start.heading", "Every change is kept, so audits take hours"),
  description: copy(
    "split-start.description",
    "When an inspector asks who changed a reading and why, the answer is already in the record, with the time, the person and the reason they gave.",
  ),
  module: {
    type: "topics",
    columns: 1,
    items: [
      { id: "locked", icon: "lock", heading: copy("split-start.locked.heading", "Locked once signed"), description: copy("split-start.locked.description", "A signed record can be amended, never overwritten.") },
      { id: "search", icon: "search", heading: copy("split-start.search.heading", "Search by asset or person"), description: copy("split-start.search.description", "Find every change to one asset in seconds.") },
      { id: "export", icon: "file-text", heading: copy("split-start.export.heading", "Export for the auditor"), description: copy("split-start.export.description", "One file with the history, signatures and attachments.") },
    ],
  },
  media: {
    type: "specimen",
    label: copy(
      "split-start.label",
      "A change history for one inspection record, listing four edits with the field changed, the person who changed it and the review state.",
    ),
    panels: [
      {
        id: "history",
        title: copy("split-start.panel.title", "History · Fire door audit FD-07"),
        meta: copy("split-start.panel.meta", "Signed 10 Mar by A. Novak"),
        parts: [
          {
            id: "changes",
            type: "table",
            caption: copy("split-start.table.caption", "Changes to this record"),
            columns: [
              { id: "field", label: copy("split-start.table.col.field", "Field") },
              { id: "person", label: copy("split-start.table.col.person", "Changed by") },
              { id: "when", label: copy("split-start.table.col.when", "When") },
              { id: "state", label: copy("split-start.table.col.state", "State") },
            ],
            rows: [
              historyRow("closer", "Door closer", "J. Park", "10 Mar 09:12", "success", "Accepted"),
              historyRow("seal", "Seal gap", "J. Park", "10 Mar 09:14", "success", "Accepted"),
              historyRow("photo", "Photo", "A. Novak", "10 Mar 11:40", "info", "Added"),
              historyRow("result", "Result", "A. Novak", "10 Mar 11:42", "neutral", "Signed"),
            ],
          },
        ],
      },
    ],
  },
};

const featuresStatement: SectionedViewContentSection = {
  id: "catalog-features-statement",
  kind: "content-section",
  ground: "inverse",
  align: "center",
  eyebrow: copy("statement.eyebrow", "What changes"),
  heading: copy("statement.heading", "Three things teams notice in the first month"),
  description: copy("statement.description", "Teams describe the same three changes once the record replaces their spreadsheets."),
  module: {
    type: "features",
    columns: 3,
    emphasis: "statement",
    items: [
      { id: "missed", heading: copy("statement.missed.heading", "Fewer missed checks"), description: copy("statement.missed.description", "Due dates surface before they pass, not after.") },
      { id: "handover", heading: copy("statement.handover.heading", "Faster handovers"), description: copy("statement.handover.description", "The next shift reads the record, not a note.") },
      { id: "audits", heading: copy("statement.audits.heading", "Calmer audits"), description: copy("statement.audits.description", "The evidence is already filed against each asset.") },
    ],
  },
};

function assetPanel(id: string, title: string, meta: string, tone: SectionedViewSpecimenTone, state: string, meter: { label: string; value: number; scaleMax: number; limit: number; valueText: string; limitText: string }, openJobs: string): SectionedViewSpecimenPanel {
  return {
    id,
    title: copy(`row.${id}.title`, title),
    meta: copy(`row.${id}.meta`, meta),
    status: status(`row.${id}`, tone, state),
    parts: [
      {
        id: "reading",
        type: "meter",
        label: copy(`row.${id}.meter.label`, meter.label),
        value: meter.value,
        scaleMax: meter.scaleMax,
        limit: meter.limit,
        tone,
        valueText: copy(`row.${id}.meter.value`, meter.valueText),
        limitText: copy(`row.${id}.meter.limit`, meter.limitText),
      },
      fields(`row.${id}.fields`, [["Open jobs", openJobs]], 1),
    ],
  };
}

const specimenRow: SectionedViewContentSection = {
  id: "catalog-specimen-row",
  kind: "content-section",
  ground: "sunken",
  eyebrow: copy("row.eyebrow", "Assets"),
  heading: copy("row.heading", "See an asset's condition at a glance"),
  description: copy("row.description", "Three assets at one site, each with its last reading and the work open against it."),
  media: {
    type: "specimen",
    label: copy("row.label", "Three asset cards from one site, each showing its last reading against a limit and its open work."),
    arrangement: "row",
    panels: [
      assetPanel("boiler", "Boiler B-1", "Plant room", "success", "In service", { label: "Flue temperature", value: 182, scaleMax: 260, limit: 220, valueText: "182 °C", limitText: "Limit 220 °C" }, "0"),
      assetPanel("chiller", "Chiller C-2", "Roof, block A", "warning", "Watch", { label: "Discharge pressure", value: 15.8, scaleMax: 20, limit: 17, valueText: "15.8 bar", limitText: "Limit 17 bar" }, "1"),
      assetPanel("pump", "Pump P-4", "Plant room", "danger", "Out of service", { label: "Vibration", value: 7.4, scaleMax: 10, limit: 6, valueText: "7.4 mm/s", limitText: "Limit 6 mm/s" }, "2"),
    ],
  },
};

const featuresPlate: SectionedViewContentSection = {
  id: "catalog-features-plate",
  kind: "content-section",
  ground: "base",
  eyebrow: copy("plate.eyebrow", "Field and office"),
  heading: copy("plate.heading", "The floor and the office finally read the same record"),
  description: copy(
    "plate.description",
    "Technicians get a short list and large buttons on a phone; supervisors get the schedule, the backlog and the spend on a desktop, and both edit one record underneath.",
  ),
  module: {
    type: "features",
    columns: 2,
    treatment: "plate",
    items: [
      {
        id: "floor",
        icon: "briefcase",
        heading: copy("plate.floor.heading", "For technicians on the floor"),
        description: copy(
          "plate.floor.description",
          "Open today's jobs, scan an asset tag, record readings and photos, and close the job with a signature from one phone, with or without signal.",
        ),
      },
      {
        id: "office",
        icon: "building-2",
        heading: copy("plate.office.heading", "For supervisors in the office"),
        description: copy(
          "plate.office.description",
          "Plan the week across sites, move jobs between technicians, approve parts spend and see every overdue check before it turns into a finding at audit.",
        ),
      },
    ],
  },
};

const specimenStack: SectionedViewContentSection = {
  id: "catalog-specimen-stack",
  kind: "content-section",
  ground: "sunken",
  eyebrow: copy("stack.eyebrow", "Parts and spend"),
  heading: copy("stack.heading", "Know what each repair cost before the invoice arrives"),
  description: copy("stack.description", "Parts and labour post to the job as they are used, so spend tracks against each site's budget."),
  media: {
    type: "specimen",
    label: copy("stack.label", "One site's maintenance spend against its monthly budget, above the parts drawn for a single repair."),
    arrangement: "stack",
    panels: [
      {
        id: "spend",
        title: copy("stack.spend.title", "Spend · North depot"),
        meta: copy("stack.spend.meta", "March to date"),
        status: status("stack.spend", "success", "On track"),
        parts: [
          {
            id: "budget",
            type: "meter",
            label: copy("stack.spend.meter.label", "Maintenance spend"),
            value: 31.2,
            scaleMax: 50,
            limit: 40,
            tone: "info",
            valueText: copy("stack.spend.meter.value", "31.2k"),
            limitText: copy("stack.spend.meter.limit", "Budget 40k"),
          },
          {
            id: "split",
            type: "shares",
            label: copy("stack.spend.shares.label", "Spend by type"),
            items: [
              { id: "labour", name: copy("stack.spend.labour", "Labour"), share: 58, shareText: copy("stack.spend.labour.share", "58%") },
              { id: "parts", name: copy("stack.spend.parts", "Parts"), share: 30, shareText: copy("stack.spend.parts.share", "30%") },
              { id: "contractors", name: copy("stack.spend.contractors", "Contractors"), share: 12, shareText: copy("stack.spend.contractors.share", "12%") },
            ],
          },
        ],
      },
      {
        id: "parts",
        title: copy("stack.parts.title", "Parts drawn · WO-2214"),
        parts: [
          {
            id: "drawn",
            type: "table",
            caption: copy("stack.parts.caption", "Parts drawn for this job"),
            columns: [
              { id: "part", label: copy("stack.parts.col.part", "Part") },
              { id: "qty", label: copy("stack.parts.col.qty", "Qty") },
              { id: "cost", label: copy("stack.parts.col.cost", "Cost") },
            ],
            rows: [
              { id: "belt", cells: [{ text: copy("stack.parts.belt", "Drive belt B-52") }, { text: copy("stack.parts.belt.qty", "2") }, { text: copy("stack.parts.belt.cost", "84") }] },
              { id: "filter", cells: [{ text: copy("stack.parts.filter", "Filter set") }, { text: copy("stack.parts.filter.qty", "1") }, { text: copy("stack.parts.filter.cost", "126") }] },
              { id: "bearing", cells: [{ text: copy("stack.parts.bearing", "Bearing 6204") }, { text: copy("stack.parts.bearing.qty", "2") }, { text: copy("stack.parts.bearing.cost", "38") }] },
            ],
          },
        ],
        footer: { note: copy("stack.parts.note", "Posted to cost code MNT-04") },
      },
    ],
  },
};

const topicsTwo: SectionedViewContentSection = {
  id: "catalog-topics-two",
  kind: "content-section",
  ground: "base",
  eyebrow: copy("topics.eyebrow", "What it covers"),
  heading: copy("topics.heading", "The everyday records a maintenance team keeps, in one place"),
  description: copy(
    "topics.description",
    "Each of these is a record type in its own right, with its own fields and history, and each links back to the assets and the sites it concerns.",
  ),
  module: {
    type: "topics",
    columns: 2,
    items: [
      { id: "orders", icon: "file-text", heading: copy("topics.orders.heading", "Work orders and requests"), description: copy("topics.orders.description", "Every job from first report to signed close, with its full history.") },
      { id: "planned", icon: "calendar", heading: copy("topics.planned.heading", "Planned preventive maintenance"), description: copy("topics.planned.description", "Recurring tasks on fixed intervals, meter readings or both, planned automatically.") },
      { id: "inspections", icon: "file-check", heading: copy("topics.inspections.heading", "Inspections and safety checks"), description: copy("topics.inspections.description", "Checklists with pass, fail and recheck results, each signed by the inspector.") },
      { id: "assets", icon: "layers", heading: copy("topics.assets.heading", "Asset register and hierarchy"), description: copy("topics.assets.description", "Sites, buildings, systems and assets, nested the way your plant is.") },
      { id: "parts", icon: "receipt", heading: copy("topics.parts.heading", "Parts, stock and purchasing"), description: copy("topics.parts.description", "Stock per store, reorder points and the parts each job used.") },
      { id: "contractors", icon: "users", heading: copy("topics.contractors.heading", "Contractors and their permits"), description: copy("topics.contractors.description", "Approved contractors, their insurance dates and the permits each visit needs.") },
      { id: "documents", icon: "folder", heading: copy("topics.documents.heading", "Manuals, drawings and certificates"), description: copy("topics.documents.description", "Documents filed against the asset they describe, with their review dates.") },
      { id: "incidents", icon: "shield-check", heading: copy("topics.incidents.heading", "Incidents and corrective actions"), description: copy("topics.incidents.description", "What happened, what was done and who confirmed the fix held.") },
    ],
  },
};

const specimenFlow: SectionedViewContentSection = {
  id: "catalog-specimen-flow",
  kind: "content-section",
  ground: "sunken",
  eyebrow: copy("flow.eyebrow", "Requests"),
  heading: copy("flow.heading", "A reported fault becomes a planned job"),
  description: copy("flow.description", "Anyone on site can report a fault; a supervisor turns it into a work order with an owner and a date."),
  media: {
    type: "specimen",
    label: copy("flow.label", "A fault report from a site worker and the work order a supervisor created from it, with an owner and a due date."),
    arrangement: "flow",
    connector: copy("flow.connector", "Reviewed and assigned"),
    panels: [
      {
        id: "request",
        title: copy("flow.request.title", "Request R-0418"),
        meta: copy("flow.request.meta", "Reported 11 Mar, 07:52"),
        status: status("flow.request", "info", "New"),
        parts: [
          fields(
            "flow.request.fields",
            [
              ["Location", "Loading bay 2"],
              ["Issue", "Door won't close"],
              ["Reported by", "Shift lead"],
            ],
            1,
          ),
        ],
      },
      {
        id: "order",
        title: copy("flow.order.title", "WO-2231 · Dock door DD-2"),
        meta: copy("flow.order.meta", "Created 11 Mar, 08:10"),
        status: status("flow.order", "warning", "Assigned"),
        parts: [
          fields(
            "flow.order.fields",
            [
              ["Priority", "1 · Same day"],
              ["Trade", "Mechanical"],
              ["Due", "11 Mar, 14:00"],
            ],
            1,
          ),
        ],
        footer: { assignee: { initials: copy("flow.order.initials", "SM"), name: copy("flow.order.name", "S. Mensah"), note: copy("flow.order.assignee-note", "Day shift") } },
      },
    ],
  },
};

const stepsPlain: SectionedViewContentSection = {
  id: "catalog-steps-plain",
  kind: "content-section",
  ground: "base",
  eyebrow: copy("steps-plain.eyebrow", "Getting started"),
  heading: copy("steps-plain.heading", "From a spreadsheet to a live record in four steps"),
  description: copy(
    "steps-plain.description",
    "A team starts with one site and the records it already keeps, then adds sites once the first runs on the new record without the old spreadsheet beside it.",
  ),
  module: {
    type: "steps",
    items: [
      { id: "import", ordinal: copy("steps-plain.import.ordinal", "01"), label: copy("steps-plain.import.actor", "Your team"), heading: copy("steps-plain.import.heading", "Import"), description: copy("steps-plain.import.description", "Bring in the asset list and open jobs from the spreadsheets you already keep.") },
      { id: "map", ordinal: copy("steps-plain.map.ordinal", "02"), label: copy("steps-plain.map.actor", "Fieldmark"), heading: copy("steps-plain.map.heading", "Map sites"), description: copy("steps-plain.map.description", "We nest assets under sites and systems and flag any asset without a location.") },
      { id: "schedule", ordinal: copy("steps-plain.schedule.ordinal", "03"), label: copy("steps-plain.schedule.actor", "Supervisors"), heading: copy("steps-plain.schedule.heading", "Set schedules"), description: copy("steps-plain.schedule.description", "Set intervals and shifts per site, and the first month of work plans itself.") },
      { id: "live", ordinal: copy("steps-plain.live.ordinal", "04"), label: copy("steps-plain.live.actor", "Technicians"), heading: copy("steps-plain.live.heading", "Go live"), description: copy("steps-plain.live.description", "Record work on phones while the old spreadsheet stays read-only for a month.") },
    ],
  },
};

const cardsVisual: SectionedViewContentSection = {
  id: "catalog-cards-visual",
  kind: "content-section",
  ground: "sunken",
  eyebrow: copy("cards-a.eyebrow", "Views"),
  heading: copy("cards-a.heading", "The same record, read four ways"),
  description: copy("cards-a.description", "Each role sees the part of the record it acts on, without a separate report to build."),
  module: {
    type: "cards",
    items: [
      {
        id: "technician",
        span: "half",
        eyebrow: copy("cards-a.technician.eyebrow", "Technician"),
        heading: copy("cards-a.technician.heading", "Today's jobs"),
        description: copy("cards-a.technician.description", "A short list for the shift, ordered by priority and by walking route."),
        visual: {
          id: "jobs",
          type: "status-rows",
          label: copy("cards-a.technician.visual", "Today's jobs for one technician"),
          items: [
            { id: "ahu", label: copy("cards-a.jobs.ahu", "AHU-3 belt change"), detail: copy("cards-a.jobs.ahu.detail", "Roof, block B"), status: status("cards-a.jobs.ahu", "warning", "In progress") },
            { id: "door", label: copy("cards-a.jobs.door", "Fire door FD-07"), detail: copy("cards-a.jobs.door.detail", "Level 1"), status: status("cards-a.jobs.door", "success", "Done") },
            { id: "pump", label: copy("cards-a.jobs.pump", "Pump P-4 vibration"), detail: copy("cards-a.jobs.pump.detail", "Plant room"), status: status("cards-a.jobs.pump", "danger", "Overdue") },
            { id: "dock", label: copy("cards-a.jobs.dock", "Dock door DD-2"), detail: copy("cards-a.jobs.dock.detail", "Loading bay 2"), status: status("cards-a.jobs.dock", "neutral", "Assigned") },
          ],
        },
      },
      {
        id: "supervisor",
        span: "half",
        eyebrow: copy("cards-a.supervisor.eyebrow", "Supervisor"),
        heading: copy("cards-a.supervisor.heading", "Crew workload"),
        description: copy("cards-a.supervisor.description", "Open hours per technician this week, so new jobs go where there is room."),
        visual: {
          id: "workload",
          type: "shares",
          label: copy("cards-a.supervisor.visual", "Open hours by technician this week"),
          items: [
            { id: "park", name: copy("cards-a.workload.park", "J. Park"), share: 40, shareText: copy("cards-a.workload.park.share", "40%") },
            { id: "mensah", name: copy("cards-a.workload.mensah", "S. Mensah"), share: 35, shareText: copy("cards-a.workload.mensah.share", "35%") },
            { id: "novak", name: copy("cards-a.workload.novak", "A. Novak"), share: 25, shareText: copy("cards-a.workload.novak.share", "25%") },
          ],
        },
      },
      {
        id: "manager",
        span: "two-thirds",
        eyebrow: copy("cards-a.manager.eyebrow", "Site manager"),
        heading: copy("cards-a.manager.heading", "Inspection coverage"),
        description: copy("cards-a.manager.description", "Every recurring check across the site, with its last result and when it is next due."),
        visual: {
          id: "coverage",
          type: "table",
          caption: copy("cards-a.coverage.caption", "Inspection coverage by area"),
          columns: [
            { id: "area", label: copy("cards-a.coverage.col.area", "Area") },
            { id: "checks", label: copy("cards-a.coverage.col.checks", "Checks") },
            { id: "next", label: copy("cards-a.coverage.col.next", "Next due") },
            { id: "result", label: copy("cards-a.coverage.col.result", "Last result") },
          ],
          rows: [
            { id: "plant", cells: [{ text: copy("cards-a.coverage.plant", "Plant room") }, { text: copy("cards-a.coverage.plant.checks", "12") }, { text: copy("cards-a.coverage.plant.next", "14 Mar") }, { status: status("cards-a.coverage.plant", "success", "Pass") }] },
            { id: "roof", cells: [{ text: copy("cards-a.coverage.roof", "Roof") }, { text: copy("cards-a.coverage.roof.checks", "6") }, { text: copy("cards-a.coverage.roof.next", "7 Mar") }, { status: status("cards-a.coverage.roof", "warning", "Recheck") }] },
            { id: "bays", cells: [{ text: copy("cards-a.coverage.bays", "Loading bays") }, { text: copy("cards-a.coverage.bays.checks", "8") }, { text: copy("cards-a.coverage.bays.next", "18 Mar") }, { status: status("cards-a.coverage.bays", "success", "Pass") }] },
          ],
        },
      },
      {
        id: "auditor",
        span: "third",
        eyebrow: copy("cards-a.auditor.eyebrow", "Auditor"),
        heading: copy("cards-a.auditor.heading", "Evidence files"),
        description: copy("cards-a.auditor.description", "Signed checklists and certificates, filed against the asset they describe."),
        visual: {
          id: "evidence",
          type: "files",
          label: copy("cards-a.auditor.visual", "Evidence filed for fire door FD-07"),
          items: [
            { id: "checklist", format: copy("cards-a.files.checklist.format", "PDF"), name: copy("cards-a.files.checklist", "FD-07 checklist, signed"), source: copy("cards-a.files.checklist.source", "A. Novak") },
            { id: "photo", format: copy("cards-a.files.photo.format", "JPG"), name: copy("cards-a.files.photo", "Closer after repair") },
            { id: "certificate", format: copy("cards-a.files.certificate.format", "PDF"), name: copy("cards-a.files.certificate", "Door rating certificate") },
          ],
        },
      },
    ],
  },
};

const cardsText: SectionedViewContentSection = {
  id: "catalog-cards-text",
  kind: "content-section",
  ground: "base",
  eyebrow: copy("cards-b.eyebrow", "Integrations and data"),
  heading: copy("cards-b.heading", "Your records stay yours and move where you need them"),
  description: copy(
    "cards-b.description",
    "Fieldmark reads from and writes to the systems a facilities team already runs, and every record can leave in an open format the day you ask for it.",
  ),
  module: {
    type: "cards",
    items: [
      {
        id: "sign-on",
        span: "third",
        icon: "globe",
        heading: copy("cards-b.sign-on.heading", "Single sign-on for every site"),
        description: copy("cards-b.sign-on.description", "Staff sign in with the work accounts they already have, and leavers lose access the day their account is closed."),
      },
      {
        id: "ledger",
        span: "third",
        icon: "receipt",
        heading: copy("cards-b.ledger.heading", "Purchase orders to your ledger"),
        description: copy("cards-b.ledger.description", "Approved parts orders post to the finance system with their cost code, so spend is never typed in twice."),
      },
      {
        id: "calendars",
        span: "third",
        icon: "calendar",
        heading: copy("cards-b.calendars.heading", "Calendars for every shift"),
        description: copy("cards-b.calendars.description", "Each technician's jobs appear in the calendar they already use, and move when a supervisor reschedules them."),
      },
      {
        id: "roles",
        span: "third",
        icon: "lock",
        heading: copy("cards-b.roles.heading", "Roles that match your sites"),
        description: copy("cards-b.roles.description", "Access is set per site and per role, so a contractor sees only the jobs they were assigned."),
      },
      {
        id: "export",
        span: "two-thirds",
        icon: "layers",
        eyebrow: copy("cards-b.export.eyebrow", "Open by default"),
        heading: copy("cards-b.export.heading", "Every record exports in full"),
        description: copy(
          "cards-b.export.description",
          "Assets, jobs, readings, signatures and attachments export as plain files with their history intact, on demand or on any schedule your team sets.",
        ),
      },
      {
        id: "hosting",
        span: "full",
        icon: "shield-check",
        eyebrow: copy("cards-b.hosting.eyebrow", "Hosting"),
        heading: copy("cards-b.hosting.heading", "Regional hosting, daily backups"),
        description: copy(
          "cards-b.hosting.description",
          "Records are stored in the region you choose, encrypted at rest and in transit, and backed up every day to a second location.",
        ),
      },
    ],
  },
};

const comparisonVisual: SectionedViewContentSection = {
  id: "catalog-comparison-visual",
  kind: "content-section",
  ground: "sunken",
  eyebrow: copy("compare-a.eyebrow", "Before and after"),
  heading: copy("compare-a.heading", "The same week, before and after the record"),
  description: copy("compare-a.description", "One site's inspection week, as it looked in the spreadsheet and as it looks now."),
  module: {
    type: "comparison",
    before: {
      label: copy("compare-a.before.label", "Spreadsheet"),
      description: copy("compare-a.before.description", "Checks live in tabs per month; overdue items are found when someone scrolls past them."),
      visual: {
        id: "sheet",
        title: copy("compare-a.before.title", "Inspections · March tab"),
        status: status("compare-a.before", "neutral", "Unsorted"),
        parts: [
          fields("compare-a.before.fields", [
            ["Rows", "214"],
            ["Owner column", "Mostly blank"],
            ["Overdue", "Unknown"],
            ["Last check", "Not recorded"],
          ]),
        ],
      },
    },
    after: {
      label: copy("compare-a.after.label", "Fieldmark"),
      description: copy("compare-a.after.description", "Checks carry their own due dates; overdue items are listed first, with an owner."),
      visual: {
        id: "record",
        title: copy("compare-a.after.title", "Inspections · Week 11"),
        status: status("compare-a.after", "warning", "1 overdue"),
        parts: [
          {
            id: "due",
            type: "status-rows",
            items: [
              { id: "anchor", label: copy("compare-a.after.anchor", "Roof anchor test"), detail: copy("compare-a.after.anchor.detail", "Due 7 Mar"), status: status("compare-a.after.anchor", "danger", "Overdue") },
              { id: "forklift", label: copy("compare-a.after.forklift", "Forklift pre-use"), detail: copy("compare-a.after.forklift.detail", "Due today"), status: status("compare-a.after.forklift", "warning", "Due") },
              { id: "doors", label: copy("compare-a.after.doors", "Fire door audit"), detail: copy("compare-a.after.doors.detail", "10 Mar"), status: status("compare-a.after.doors", "success", "Done") },
            ],
          },
        ],
        footer: { assignee: { initials: copy("compare-a.after.initials", "AN"), name: copy("compare-a.after.name", "A. Novak") } },
      },
    },
  },
};

const comparisonPoints: SectionedViewContentSection = {
  id: "catalog-comparison-points",
  kind: "content-section",
  ground: "base",
  eyebrow: copy("compare-b.eyebrow", "Handover"),
  heading: copy("compare-b.heading", "What the next shift inherits, with and without the record"),
  description: copy(
    "compare-b.description",
    "A shift handover is where maintenance knowledge gets lost; here is what the incoming technician receives in each case, on the same Monday morning at the same site.",
  ),
  module: {
    type: "comparison",
    before: {
      label: copy("compare-b.before.label", "Without the record"),
      points: [
        copy("compare-b.before.note", "A handwritten note, if the last shift left one"),
        copy("compare-b.before.readings", "Readings kept in a notebook in someone's locker"),
        copy("compare-b.before.parts", "Parts on order known only to the buyer"),
        copy("compare-b.before.overdue", "Overdue checks discovered when an inspector asks for them"),
      ],
    },
    after: {
      label: copy("compare-b.after.label", "With the record"),
      points: [
        copy("compare-b.after.jobs", "Every open job with its last note and owner"),
        copy("compare-b.after.readings", "Every reading filed against its asset, with the time"),
        copy("compare-b.after.parts", "Parts on order shown on the job itself"),
        copy("compare-b.after.overdue", "Overdue checks listed first, each with a named owner"),
      ],
    },
  },
};

const stepsVisual: SectionedViewContentSection = {
  id: "catalog-steps-visual",
  kind: "content-section",
  ground: "sunken",
  eyebrow: copy("steps-visual.eyebrow", "Closing a job"),
  heading: copy("steps-visual.heading", "How a repair is signed off"),
  description: copy("steps-visual.description", "Three people touch a typical repair; each step leaves its evidence in the record."),
  module: {
    type: "steps",
    items: [
      {
        id: "record",
        ordinal: copy("steps-visual.record.ordinal", "01"),
        label: copy("steps-visual.record.actor", "Technician"),
        heading: copy("steps-visual.record.heading", "Record"),
        description: copy("steps-visual.record.description", "Readings, photos and parts used, captured at the asset."),
        visual: {
          id: "readings",
          title: copy("steps-visual.record.title", "WO-2214 · Readings"),
          parts: [
            fields("steps-visual.record.fields", [
              ["Belt tension", "42 Hz"],
              ["Photos", "3 attached"],
              ["Parts", "2 drawn"],
              ["Time on job", "1 h 20 min"],
            ]),
          ],
        },
      },
      {
        id: "review",
        ordinal: copy("steps-visual.review.ordinal", "02"),
        label: copy("steps-visual.review.actor", "Supervisor"),
        heading: copy("steps-visual.review.heading", "Review"),
        description: copy("steps-visual.review.description", "Checks the evidence and returns anything incomplete to the technician."),
        visual: {
          id: "checklist",
          title: copy("steps-visual.review.title", "Review checklist"),
          parts: [
            {
              id: "checks",
              type: "status-rows",
              items: [
                { id: "readings", label: copy("steps-visual.review.readings", "Readings complete"), status: status("steps-visual.review.readings", "success", "Yes") },
                { id: "photos", label: copy("steps-visual.review.photos", "Photos match asset"), status: status("steps-visual.review.photos", "success", "Yes") },
                { id: "parts", label: copy("steps-visual.review.parts", "Parts posted"), status: status("steps-visual.review.parts", "warning", "1 pending") },
              ],
            },
          ],
        },
      },
      {
        id: "sign",
        ordinal: copy("steps-visual.sign.ordinal", "03"),
        label: copy("steps-visual.sign.actor", "Site manager"),
        heading: copy("steps-visual.sign.heading", "Sign off"),
        description: copy("steps-visual.sign.description", "Signs the job closed, and its history is locked."),
        visual: {
          id: "closed",
          title: copy("steps-visual.sign.title", "WO-2214 · Closed"),
          status: status("steps-visual.sign", "success", "Signed"),
          parts: [
            fields(
              "steps-visual.sign.fields",
              [
                ["Signed by", "Site manager"],
                ["Signed at", "6 Mar, 16:05"],
              ],
              1,
            ),
          ],
          footer: { assignee: { initials: copy("steps-visual.sign.initials", "LR"), name: copy("steps-visual.sign.name", "L. Romano"), note: copy("steps-visual.sign.role", "Site manager") } },
        },
      },
    ],
  },
};

const faqItem = (id: string, question: string, answer: string) => ({ id, question: copy(`faq.${id}.question`, question), answer: copy(`faq.${id}.answer`, answer) });

const faqSplit: SectionedViewContentSection = {
  id: "catalog-faq",
  kind: "content-section",
  ground: "base",
  layout: "split",
  eyebrow: copy("faq.eyebrow", "Questions"),
  heading: copy("faq.heading", "What teams ask before they switch"),
  description: copy("faq.description", "Short answers to the questions facilities leads raise most often in a first call."),
  module: {
    type: "faq",
    items: [
      faqItem("offline", "Does it work without a phone signal?", "Yes. Technicians can open their jobs, record readings and take photos offline, and the record syncs as soon as the phone reconnects."),
      faqItem(
        "import",
        "Can we import the asset list we already keep in our spreadsheets?",
        "Yes. You upload the spreadsheet as it is, map its columns to asset fields once, and review every row that is missing a location or a type before anything is created, so the register starts clean rather than inheriting the old gaps from earlier years.",
      ),
      faqItem("contractors", "Who can see contractor records?", "Only people with a role on that site. A contractor sees the jobs assigned to them and nothing else."),
      faqItem("signed", "What happens to a record after it is signed?", "It is locked. Anyone with the right role can add an amendment with a reason, and the original stays visible beside it."),
      faqItem(
        "setup",
        "How long does it take to set up one site?",
        "That depends on how many assets the site has and how complete its existing records are; the import step shows the gaps it found before you schedule anything.",
      ),
      faqItem(
        "export",
        "Can we export everything if we stop using the product later on?",
        "Yes. Every asset, job, reading, signature and attachment exports as plain files with its history intact, at any time and without asking anyone, and the export keeps the links between records so another system can rebuild the same structure from it.",
      ),
    ],
  },
};

// ---------------------------------------------------------------------------
// Document, call to action and captions
// ---------------------------------------------------------------------------

/** The catalog page: the hero, then every band in the order the catalog shows them. */
export const contentCatalogDocument: SectionedViewDocument = {
  id: "publisher-content-catalog",
  sections: [
    hero,
    introMax,
    specimenSingle,
    featuresPlain,
    splitEnd,
    featuresRule,
    splitStart,
    featuresStatement,
    specimenRow,
    featuresPlate,
    specimenStack,
    topicsTwo,
    specimenFlow,
    cardsText,
    comparisonVisual,
    stepsPlain,
    cardsVisual,
    comparisonPoints,
    stepsVisual,
    faqSplit,
  ],
};

/** The closing call-to-action band's id and copy (LandingView renders it from props, not the document). */
export const CONTENT_CATALOG_CALL_TO_ACTION = {
  id: "catalog-close",
  eyebrow: "Next step",
  heading: "See your own sites in the record",
  description: "Bring one site's asset list and we will walk through it with your team.",
  actionLabel: "Book a walkthrough",
  actionHref: "#catalog-hero",
} as const;

/** One caption per band, in page order: the hero, every document band, then the call to action. */
export const CONTENT_CATALOG_CAPTIONS: readonly ContentCatalogCaption[] = [
  { sectionId: "catalog-hero", title: "Hero", detail: "inverse ground · eyebrow, heading, description · one primary action", budget: "max" },
  { sectionId: "catalog-intro", title: "Intro band", detail: "stacked, start-aligned · no module, no media · two text links", budget: "max" },
  { sectionId: "catalog-specimen-single", title: "Specimen, stacked, single", detail: "sunken · one panel: fields (6 rows), status rows, meter with limit, assignee footer", budget: "max" },
  { sectionId: "catalog-features-plain", title: "Features, plain, 3 columns, icons", detail: "base · item emphasis", budget: "typical" },
  { sectionId: "catalog-split-end", title: "Split, text + specimen, media end", detail: "sunken · header and one text link beside a schedule panel", budget: "typical" },
  { sectionId: "catalog-features-rule", title: "Features, rule, 4 columns", detail: "base · no icons (rule takes none)", budget: "max" },
  { sectionId: "catalog-split-start", title: "Split, text + specimen, media start", detail: "sunken · topics in 1 column in the text column · table panel", budget: "max" },
  { sectionId: "catalog-features-statement", title: "Features, statement emphasis", detail: "inverse (the one inverse body band) · centred header · exactly 3 items", budget: "typical" },
  { sectionId: "catalog-specimen-row", title: "Specimen, stacked, row of 3", detail: "sunken · three panels, each a meter and one field", budget: "typical" },
  { sectionId: "catalog-features-plate", title: "Features, plate, 2 columns, icons", detail: "base · 2-column plates take the longest item copy", budget: "max" },
  { sectionId: "catalog-specimen-stack", title: "Specimen, stacked, stack", detail: "sunken · two panels: meter and shares, then a table with a footer note", budget: "typical" },
  { sectionId: "catalog-topics-two", title: "Topics, 2 columns, icons", detail: "base · 8 items", budget: "max" },
  { sectionId: "catalog-specimen-flow", title: "Specimen, stacked, flow", detail: "sunken · two panels with a connector caption", budget: "typical" },
  { sectionId: "catalog-cards-text", title: "Bento cards, text", detail: "base · rows three thirds, third + two-thirds, full · icons and card eyebrows", budget: "max" },
  { sectionId: "catalog-comparison-visual", title: "Comparison with visuals", detail: "sunken · a description and a panel on each side", budget: "typical" },
  { sectionId: "catalog-steps-plain", title: "Steps, 4, actor labels", detail: "base · no visuals", budget: "max" },
  { sectionId: "catalog-cards-visual", title: "Bento cards with visuals", detail: "sunken · rows half + half, two-thirds + third · status rows, shares, table, files", budget: "typical" },
  { sectionId: "catalog-comparison-points", title: "Comparison, points", detail: "base · 4 points a side, no visuals", budget: "max" },
  { sectionId: "catalog-steps-visual", title: "Steps, 3, visuals and actor labels", detail: "sunken · one panel per step", budget: "typical" },
  { sectionId: "catalog-faq", title: "FAQ split band", detail: "base, the closing band · 6 rows beside a top-aligned header", budget: "max" },
  { sectionId: CONTENT_CATALOG_CALL_TO_ACTION.id, title: "Close band", detail: "inverse, fixed by the view · one primary action", budget: "max" },
];

/** Resolves every `CopyRef` in `contentCatalogDocument`. */
export const contentCatalogCopyResolver = createCopyResolver({
  id: "publisher-content-catalog",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "packages/publisher/src/preview/fixture-content-catalog.ts" },
  entries: [...CATALOG_COPY].map(([id, text]) => ({ id, text, context: "content catalog sample copy", status: "approved" as const })),
});
