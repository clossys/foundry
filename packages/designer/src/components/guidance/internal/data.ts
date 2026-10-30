/** Shared component selection data. No runtime imports; the public components barrel remains client-only. */
export type ComponentMedium = "web" | "email" | "print" | "video";
export type ComponentMediumState = "implemented" | "planned" | "unsupported" | "not-applicable" | "unassessed";
export type ComponentScalar = string | number | boolean;
export interface ComponentEvidence { readonly source: string; readonly evidence: string }
export interface ComponentOptionGuidance {
  readonly prop: string; readonly label: string; readonly purpose: string;
  readonly values: readonly { readonly value: ComponentScalar; readonly purpose: string }[];
  readonly applicability: string;
  readonly support: { readonly state: "implemented" | "partial" | "unavailable" | "unassessed"; readonly reason: string };
}
export type ComponentCondition = { readonly prop: string; readonly values: readonly ComponentScalar[] }
  | { readonly prop: string; readonly present: boolean }
  | { readonly any: readonly ComponentCondition[] } | { readonly all: readonly ComponentCondition[] };
export interface ComponentConstraint {
  readonly kind: "effective-when" | "paired" | "requires" | "exclusive" | "derived" | "data";
  readonly props: readonly string[]; readonly reason: string;
  readonly effectiveWhen?: ComponentCondition; readonly when?: ComponentCondition;
  readonly requires?: readonly string[]; readonly excludes?: readonly string[];
  readonly presence?: "exactly-one";
  readonly enforcement: "ignored" | "type" | "runtime" | "derived";
  readonly evidence: ComponentEvidence;
}
export interface ComponentWebImplementation {
  readonly exportName: string; readonly entrypoint: "components" | "charts";
  readonly notes: string; readonly options: readonly ComponentOptionGuidance[];
  readonly constraints: readonly ComponentConstraint[];
}
export interface ComponentMediumGuidance {
  readonly state: ComponentMediumState; readonly reason: string; readonly evidence: readonly string[];
  readonly implementation?: ComponentWebImplementation;
}
export interface ComponentGuidance {
  readonly purpose: string; readonly useWhen: string; readonly avoidWhen: string; readonly alternatives: string;
  readonly content: string; readonly anatomy: string; readonly composition: string; readonly accessibility: string;
  readonly media: Readonly<Record<ComponentMedium, ComponentMediumGuidance>>;
  readonly demonstration: { readonly state: "unassessed" | "partial" | "available" | "unavailable"; readonly reason: string };
}
export interface ComponentApiFacts {
  readonly exportName: string; readonly source: string;
  readonly options: readonly {
    readonly prop: string; readonly values: readonly ComponentScalar[];
    readonly default: { readonly kind: "value"; readonly value: ComponentScalar; readonly source: string; readonly evidence: string }
      | { readonly kind: "required" | "omitted" | "peer" | "conditional"; readonly reason: string };
    readonly forwarding: ComponentEvidence;
  }[];
  readonly tokens: {
    readonly coverage: "partial" | "none-owned"; readonly reason: string;
    readonly dependencies: readonly { readonly property: string; readonly kind: "direct" | "transitive";
      readonly source: string; readonly evidence: string; readonly via: readonly ComponentEvidence[] }[];
  };
}

const unassessed = (medium: string): ComponentMediumGuidance => ({
  state: "unassessed",
  reason: `No ${medium} renderer or supported configuration has been assessed for this leaf.`,
  evidence: ["This record documents the existing web component source only; no non-web implementation evidence is recorded."],
});
function entry(stable: Omit<ComponentGuidance, "media" | "demonstration">, implementation: ComponentWebImplementation, source: string): ComponentGuidance {
  return { ...stable,
    media: {
      web: { state: "implemented", reason: "The existing component renders or forwards its documented web implementation in the named source.", evidence: [source], implementation },
      email: unassessed("email"), print: unassessed("print"), video: unassessed("video"),
    },
    demonstration: { state: "unassessed", reason: "Consumer-owned fixtures and interaction evidence have not been assessed here. A supported package option is not proof of a working catalog demonstration." },
  };
}

/** Curated selection semantics, distinct from checked API facts below. */
export const COMPONENT_GUIDANCE: Readonly<Record<string, ComponentGuidance>> = {
  "act.button": entry(
{
  "purpose": "Carry out one named action.",
  "useWhen": "The reader is ready to submit, confirm or change something.",
  "avoidWhen": "The intent is to travel to a destination rather than perform an action.",
  "alternatives": "Use Link for navigation; IconButton for a compact, clearly named secondary control.",
  "content": "Write a short verb phrase that describes the resulting action.",
  "anatomy": "One action label, with an optional subordinate visual cue.",
  "composition": "In a consumer-owned form block, place a submit Button after the fields.",
  "accessibility": "Keep the action name understandable without relying on its fill or icon."
},
{
  "exportName": "Button",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "variant",
      "label": "Style preset",
      "purpose": "Style preset selects the existing Button variant behavior.",
      "values": [
        {
          "value": "primary",
          "purpose": "Accent-filled primary action."
        },
        {
          "value": "secondary",
          "purpose": "Bordered lower-emphasis action."
        },
        {
          "value": "ghost",
          "purpose": "Unfilled action that gains hover emphasis."
        },
        {
          "value": "danger",
          "purpose": "Destructive action with danger treatment."
        },
        {
          "value": "outline",
          "purpose": "Unfilled secondary call to action with an inset edge."
        },
        {
          "value": "tonal",
          "purpose": "Neutral tonal tertiary action responsive to its ground."
        },
        {
          "value": "quiet",
          "purpose": "Unboxed text action with a decorative trailing glyph by default."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "size",
      "label": "Size",
      "purpose": "Size selects the existing Button size behavior.",
      "values": [
        {
          "value": "sm",
          "purpose": "sm size within the existing component scale."
        },
        {
          "value": "md",
          "purpose": "md size within the existing component scale."
        },
        {
          "value": "lg",
          "purpose": "lg size within the existing component scale."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "ground",
      "label": "Surrounding ground",
      "purpose": "Surrounding ground selects the existing Button ground behavior.",
      "values": [
        {
          "value": "base",
          "purpose": "Page ground."
        },
        {
          "value": "sunken",
          "purpose": "Sunken section ground."
        },
        {
          "value": "inverse",
          "purpose": "Inverse section ground."
        }
      ],
      "applicability": "Accepted but ignored outside tonal and quiet.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": [
    {
      "kind": "effective-when",
      "props": [
        "ground",
        "variant"
      ],
      "reason": "ground affects tonal and quiet only; other variants accept it without a visual effect.",
      "enforcement": "ignored",
      "evidence": {
        "source": "src/components/Button.tsx",
        "evidence": "variant === \"quiet\""
      },
      "effectiveWhen": {
        "prop": "variant",
        "values": [
          "tonal",
          "quiet"
        ]
      }
    },
    {
      "kind": "effective-when",
      "props": [
        "trailingIcon",
        "variant"
      ],
      "reason": "trailingIcon applies only to quiet: omission uses ChevronRight and null removes it.",
      "enforcement": "ignored",
      "evidence": {
        "source": "src/components/Button.tsx",
        "evidence": "trailingIcon === undefined ? ChevronRight : trailingIcon"
      },
      "effectiveWhen": {
        "prop": "variant",
        "values": [
          "quiet"
        ]
      }
    }
  ]
}, "src/components/Button.tsx"),
  "act.icon-button": entry(
{
  "purpose": "Carry out a compact action represented by a familiar glyph.",
  "useWhen": "Space is constrained and the action can still be named clearly.",
  "avoidWhen": "The control is the primary action of a page or the glyph needs explanation.",
  "alternatives": "Use Button for a visible verb label; use Link for a destination.",
  "content": "Supply a concise action name and one glyph with the same meaning.",
  "anatomy": "One action glyph and its equivalent accessible name.",
  "composition": "In a consumer-owned carousel block, use named previous and next IconButtons.",
  "accessibility": "The required label names the control; its inner glyph remains decorative."
},
{
  "exportName": "IconButton",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "size",
      "label": "Size",
      "purpose": "Size selects the existing IconButton size behavior.",
      "values": [
        {
          "value": "sm",
          "purpose": "sm size within the existing component scale."
        },
        {
          "value": "md",
          "purpose": "md size within the existing component scale."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "ground",
      "label": "Surrounding ground",
      "purpose": "Surrounding ground selects the existing IconButton ground behavior.",
      "values": [
        {
          "value": "base",
          "purpose": "Page ground."
        },
        {
          "value": "sunken",
          "purpose": "Sunken section ground."
        },
        {
          "value": "inverse",
          "purpose": "Inverse section ground."
        }
      ],
      "applicability": "Select the ground the icon control actually occupies.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "shape",
      "label": "Control shape",
      "purpose": "Control shape selects the existing IconButton shape behavior.",
      "values": [
        {
          "value": "circle",
          "purpose": "Pill-radius control outline."
        },
        {
          "value": "square",
          "purpose": "Control-radius square outline."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/IconButton.tsx"),
  "act.link": entry(
{
  "purpose": "Take the reader to a related destination.",
  "useWhen": "Following a URL is the actual outcome, including a prominent call to action.",
  "avoidWhen": "The operation changes state without navigation.",
  "alternatives": "Use Button for an operation; Breadcrumb for an ordered ancestor trail.",
  "content": "Name the destination or outcome in words that work outside the surrounding sentence.",
  "anatomy": "One destination label and its navigation target.",
  "composition": "In a consumer-owned article-card block, make the title a Link to the full article.",
  "accessibility": "Preserve link semantics even when the link uses a button appearance."
},
{
  "exportName": "Link",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "variant",
      "label": "Text-link treatment",
      "purpose": "Text-link treatment selects the existing Link variant behavior.",
      "values": [
        {
          "value": "default",
          "purpose": "Inline prose link."
        },
        {
          "value": "muted",
          "purpose": "Lower-emphasis secondary link."
        },
        {
          "value": "standalone",
          "purpose": "Standalone linked unit."
        }
      ],
      "applicability": "Ignored when either buttonVariant or buttonSize enables button appearance.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "buttonVariant",
      "label": "Button appearance preset",
      "purpose": "Button appearance preset selects the existing Link buttonVariant behavior.",
      "values": [
        {
          "value": "primary",
          "purpose": "Accent-filled primary navigation."
        },
        {
          "value": "secondary",
          "purpose": "Bordered lower-emphasis navigation."
        },
        {
          "value": "ghost",
          "purpose": "Unfilled navigation that gains hover emphasis."
        },
        {
          "value": "danger",
          "purpose": "Destructive navigation with danger treatment."
        },
        {
          "value": "outline",
          "purpose": "Unfilled secondary call to navigation with an inset edge."
        },
        {
          "value": "tonal",
          "purpose": "Neutral tonal tertiary navigation responsive to its ground."
        },
        {
          "value": "quiet",
          "purpose": "Unboxed quiet navigation classes without an automatic trailing glyph."
        }
      ],
      "applicability": "Either button prop enables this appearance; omitted partner defaults to primary or md. Quiet shares classes, not Button’s auto trailing icon.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "buttonSize",
      "label": "Button appearance size",
      "purpose": "Button appearance size selects the existing Link buttonSize behavior.",
      "values": [
        {
          "value": "sm",
          "purpose": "Small navigation control."
        },
        {
          "value": "md",
          "purpose": "Medium navigation control."
        },
        {
          "value": "lg",
          "purpose": "Large navigation control."
        }
      ],
      "applicability": "Either button prop enables button appearance; buttonSize defaults to md only in that mode.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": [
    {
      "kind": "effective-when",
      "props": [
        "variant",
        "buttonVariant",
        "buttonSize"
      ],
      "reason": "Either button prop selects button appearance and ignores text variant; no auto trailing glyph is added.",
      "enforcement": "ignored",
      "evidence": {
        "source": "src/components/Link.tsx",
        "evidence": "buttonVariant !== undefined || buttonSize !== undefined"
      },
      "effectiveWhen": {
        "all": [
          {
            "prop": "buttonVariant",
            "present": false
          },
          {
            "prop": "buttonSize",
            "present": false
          }
        ]
      }
    }
  ]
}, "src/components/Link.tsx"),
  "act.breadcrumb": entry(
{
  "purpose": "Locate the current page within an ordered hierarchy.",
  "useWhen": "The reader can move to meaningful ancestor destinations.",
  "avoidWhen": "The sequence is a workflow, a history list or a set of unrelated destinations.",
  "alternatives": "Use Tabs for peer panels; use a navigation block for an unordered set of routes.",
  "content": "Author the ancestor names in root-to-current order.",
  "anatomy": "An ordered trail of repeated steps ending at the current location.",
  "composition": "In a consumer-owned detail-header block, place Breadcrumb above the page title.",
  "accessibility": "Give the trail a useful navigation name and identify the final step as current."
},
{
  "exportName": "Breadcrumb",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Breadcrumb.Item carries href and content; the last item is current/inert. The surrounding navigation name defaults to Breadcrumb. There is no separate active-index knob.",
  "options": [],
  "constraints": []
}, "src/components/Breadcrumb.tsx"),
  "act.menu": entry(
{
  "purpose": "Offer a compact collection of actions from one trigger.",
  "useWhen": "Several related commands should be revealed on demand.",
  "avoidWhen": "The content is an input choice set or a rich explanatory panel.",
  "alternatives": "Use Select for choosing a value; Popover for arbitrary panel content.",
  "content": "Name the trigger and each command. Use Menu.Section for a real section heading and separators between groups.",
  "anatomy": "One trigger and a repeated collection of actionable items, optionally grouped in Menu.Section with a real heading.",
  "composition": "AccountMenu composes Menu.Item commands and Menu.Section preference groups with an actor trigger.",
  "accessibility": "Name the trigger and each section. Section headings use the menu primitive's Header; section selection provides menuitemcheckbox preferences. Disabled items and keyboard navigation belong to the primitive."
},
{
  "exportName": "Menu",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Root props forward to MenuTrigger, not the inner menu list. triggerAction forwards to the peer trigger prop; the package supplies no local initializer. Item-level commands use Menu.Item; destructive emphasis is item-level. Menu.Section supplies a real heading through Header and forwards selectionMode, selectedKeys, onSelectionChange and shouldCloseOnSelect to the peer MenuSection. Checkbox preferences use multiple selection with caller-owned keys and callbacks.",
  "options": [
    {
      "prop": "triggerAction",
      "label": "Opening interaction",
      "purpose": "Opening interaction selects the existing Menu triggerAction behavior.",
      "values": [
        {
          "value": "press",
          "purpose": "Press to open."
        },
        {
          "value": "longPress",
          "purpose": "Long press to open."
        },
        {
          "value": "contextMenu",
          "purpose": "Context-menu gesture to open."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Menu.tsx"),
  "enter.text-field": entry(
{
  "purpose": "Collect one line of free-form text.",
  "useWhen": "The answer is a short textual value with optional guidance or validation.",
  "avoidWhen": "The answer needs several paragraphs, date segments or a predefined option list.",
  "alternatives": "Use Textarea for long text, DateField for dates, or Select for fixed choices.",
  "content": "Supply a persistent field label; helper and error text should explain the expected value.",
  "anatomy": "A label, a single value entry and optional supporting messages.",
  "composition": "In a consumer-owned contact-form block, pair a name TextField with submit controls.",
  "accessibility": "A placeholder never replaces the label or its association with the input."
},
{
  "exportName": "TextField",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Availability",
      "purpose": "Availability selects the existing TextField isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Enabled interaction."
        },
        {
          "value": true,
          "purpose": "Disabled interaction."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isInvalid",
      "label": "Validation state",
      "purpose": "Validation state selects the existing TextField isInvalid behavior.",
      "values": [
        {
          "value": false,
          "purpose": "No invalid state requested."
        },
        {
          "value": true,
          "purpose": "Expose validation state and the authored error."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/TextField.tsx"),
  "enter.textarea": entry(
{
  "purpose": "Collect text that may span several lines.",
  "useWhen": "The reader needs room for a message, explanation or description.",
  "avoidWhen": "The value is a single short identifier or a structured selection.",
  "alternatives": "Use TextField for a short value; a consumer-owned editor block for rich document editing.",
  "content": "Label the long answer and describe any length or content requirements.",
  "anatomy": "A labelled multi-line value area with optional helper and error messages.",
  "composition": "In a consumer-owned feedback block, place Textarea above the feedback submission action.",
  "accessibility": "Keep the label and validation messages associated with the multi-line control."
},
{
  "exportName": "Textarea",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. rows defaults to 3 and is forwarded to TextArea; resizing is vertical. Rows is a numeric prop, not an enumerated preset.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Availability",
      "purpose": "Availability selects the existing Textarea isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Enabled interaction."
        },
        {
          "value": true,
          "purpose": "Disabled interaction."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isInvalid",
      "label": "Validation state",
      "purpose": "Validation state selects the existing Textarea isInvalid behavior.",
      "values": [
        {
          "value": false,
          "purpose": "No invalid state requested."
        },
        {
          "value": true,
          "purpose": "Expose validation state and the authored error."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Textarea.tsx"),
  "enter.search-field": entry(
{
  "purpose": "Collect a query that narrows or finds content.",
  "useWhen": "Typing a query and clearing it are part of the same search task.",
  "avoidWhen": "The value is ordinary form data with no search meaning.",
  "alternatives": "Use TextField for stored text; ComboBox for searching a fixed choice set.",
  "content": "Name what can be searched and give helpful query instructions when needed.",
  "anatomy": "A query entry with a clear affordance when the query is nonempty.",
  "composition": "In a consumer-owned results-toolbar block, connect SearchField to the results query.",
  "accessibility": "The clear action must remain keyboard reachable and return attention to the query."
},
{
  "exportName": "SearchField",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Availability",
      "purpose": "Availability selects the existing SearchField isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Enabled interaction."
        },
        {
          "value": true,
          "purpose": "Disabled interaction."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isInvalid",
      "label": "Validation state",
      "purpose": "Validation state selects the existing SearchField isInvalid behavior.",
      "values": [
        {
          "value": false,
          "purpose": "No invalid state requested."
        },
        {
          "value": true,
          "purpose": "Expose validation state and the authored error."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/SearchField.tsx"),
  "enter.date-field": entry(
{
  "purpose": "Collect a calendar-aware date through editable segments.",
  "useWhen": "Direct date entry is appropriate and locale-specific segment order matters.",
  "avoidWhen": "The task requires picking a day from a calendar grid.",
  "alternatives": "Use a consumer-owned date-picker block for a calendar; TextField for unstructured date prose.",
  "content": "Label the date and specify the required granularity and any bounds in the task context.",
  "anatomy": "A date label, ordered calendar segments and optional validation messages.",
  "composition": "In a consumer-owned booking block, use DateField for a directly entered departure date.",
  "accessibility": "Use calendar-aware date values and retain the segments’ keyboard and label wiring."
},
{
  "exportName": "DateField",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Calendar-aware DateValue input supports inherited granularity and bounds; no calendar grid is rendered. Locale ordering belongs to the installed ARIA primitive.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Availability",
      "purpose": "Availability selects the existing DateField isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Enabled interaction."
        },
        {
          "value": true,
          "purpose": "Disabled interaction."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isInvalid",
      "label": "Validation state",
      "purpose": "Validation state selects the existing DateField isInvalid behavior.",
      "values": [
        {
          "value": false,
          "purpose": "No invalid state requested."
        },
        {
          "value": true,
          "purpose": "Expose validation state and the authored error."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/DateField.tsx"),
  "enter.select": entry(
{
  "purpose": "Choose one value from a closed list of options.",
  "useWhen": "The choices are known and scanning a compact dropdown is practical.",
  "avoidWhen": "The reader needs to search a long list or compare every choice at once.",
  "alternatives": "Use ComboBox for filtering; RadioGroup for a small visible choice set.",
  "content": "Give each option a stable ID and readable label; provide plain text for non-text labels.",
  "anatomy": "A labelled current-value trigger and a repeated set of choices.",
  "composition": "In a consumer-owned preferences block, use Select for a compact language choice.",
  "accessibility": "Label the field and associate validation error text with its trigger through the field context."
},
{
  "exportName": "Select",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. options is required data. Placeholder defaults to Select an option. isInvalid forwards to AriaSelect and the trigger is associated with rendered error text.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Availability",
      "purpose": "Availability selects the existing Select isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Enabled interaction."
        },
        {
          "value": true,
          "purpose": "Disabled interaction."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isInvalid",
      "label": "Validation state",
      "purpose": "Validation state selects the existing Select isInvalid behavior.",
      "values": [
        {
          "value": false,
          "purpose": "No invalid state requested."
        },
        {
          "value": true,
          "purpose": "Expose validation state and the authored error."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Select.tsx"),
  "enter.combo-box": entry(
{
  "purpose": "Choose one value by typing to narrow a known option set.",
  "useWhen": "The list is large enough that filtering reduces scanning effort.",
  "avoidWhen": "The task is open-ended search without a selected option identity.",
  "alternatives": "Use Select for a short closed list; SearchField for finding external results.",
  "content": "Provide stable option IDs, readable labels and textValue for complex labels.",
  "anatomy": "A labelled editable query, suggestion trigger and filtered repeated options.",
  "composition": "In a consumer-owned assignment block, use ComboBox to find an assignee from known people.",
  "accessibility": "Keep focus in the input while navigating suggestions and name the suggestion trigger."
},
{
  "exportName": "ComboBox",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. options feeds defaultItems for built-in filtering; triggerLabel defaults to Show suggestions. Content, collection data and callbacks are not scalar configuration axes.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Availability",
      "purpose": "Availability selects the existing ComboBox isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Enabled interaction."
        },
        {
          "value": true,
          "purpose": "Disabled interaction."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isInvalid",
      "label": "Validation state",
      "purpose": "Validation state selects the existing ComboBox isInvalid behavior.",
      "values": [
        {
          "value": false,
          "purpose": "No invalid state requested."
        },
        {
          "value": true,
          "purpose": "Expose validation state and the authored error."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/ComboBox.tsx"),
  "enter.checkbox": entry(
{
  "purpose": "Mark a selection that can be committed with other choices.",
  "useWhen": "One or more independent selections form part of a larger task.",
  "avoidWhen": "A setting should take effect immediately or choices are mutually exclusive.",
  "alternatives": "Use Switch for immediate settings; RadioGroup for choosing exactly one option.",
  "content": "Describe the selection in a visible label rather than only marking the box.",
  "anatomy": "A binary selection mark and its label, optionally a mixed aggregate state.",
  "composition": "In a consumer-owned bulk-actions block, derive checked and mixed state from selected rows.",
  "accessibility": "Mixed is a separate presentational state; it does not set the underlying selection."
},
{
  "exportName": "Checkbox",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Availability",
      "purpose": "Availability selects the existing Checkbox isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Enabled interaction."
        },
        {
          "value": true,
          "purpose": "Disabled interaction."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isSelected",
      "label": "Controlled selection",
      "purpose": "Controlled selection selects the existing Checkbox isSelected behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Unselected controlled state."
        },
        {
          "value": true,
          "purpose": "Selected controlled state."
        }
      ],
      "applicability": "A consumer-controlled value requires a corresponding change handler; a fixed fixture cannot demonstrate toggling.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isIndeterminate",
      "label": "Aggregate state",
      "purpose": "Aggregate state selects the existing Checkbox isIndeterminate behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Ordinary binary presentation."
        },
        {
          "value": true,
          "purpose": "Mixed aggregate presentation independent of isSelected."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Checkbox.tsx"),
  "enter.switch": entry(
{
  "purpose": "Turn an immediately applied setting on or off.",
  "useWhen": "The reader expects the change to take effect as soon as the switch changes.",
  "avoidWhen": "The choice is a pending selection awaiting a separate save action.",
  "alternatives": "Use Checkbox for pending selection; RadioGroup for more than two exclusive choices.",
  "content": "Use a stable setting name that still reads clearly in both states.",
  "anatomy": "An on/off control and the name of the setting it changes.",
  "composition": "In a consumer-owned preferences block, wire Switch changes to the real preference state.",
  "accessibility": "A controlled switch needs a change handler that updates its selected value."
},
{
  "exportName": "Switch",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Controlled isSelected without a state-updating onChange handler stays fixed; this does not mean the package lacks interactive switching.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Availability",
      "purpose": "Availability selects the existing Switch isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Enabled interaction."
        },
        {
          "value": true,
          "purpose": "Disabled interaction."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isSelected",
      "label": "Controlled selection",
      "purpose": "Controlled selection selects the existing Switch isSelected behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Unselected controlled state."
        },
        {
          "value": true,
          "purpose": "Selected controlled state."
        }
      ],
      "applicability": "A consumer-controlled value requires a corresponding change handler; a fixed fixture cannot demonstrate toggling.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Switch.tsx"),
  "enter.radio-group": entry(
{
  "purpose": "Choose one value while keeping a small option set visible.",
  "useWhen": "Side-by-side comparison of mutually exclusive options aids the decision.",
  "avoidWhen": "The list is too large to scan or independent selections are allowed.",
  "alternatives": "Use Select for compact choice; Checkbox for independent options.",
  "content": "Name the group and each choice; optional per-choice descriptions explain differences.",
  "anatomy": "One group label and repeated mutually exclusive labelled choices.",
  "composition": "In a consumer-owned preference-selection block, render at least two RadioGroup.Radio choices.",
  "accessibility": "Use the group’s label and roving keyboard selection; orientation aligns option layout and keyboard navigation."
},
{
  "exportName": "RadioGroup",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Orientation sets the options to a row or column and forwards matching semantics to AriaRadioGroup. A single-option specimen cannot prove selection differences.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Availability",
      "purpose": "Availability selects the existing RadioGroup isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Enabled interaction."
        },
        {
          "value": true,
          "purpose": "Disabled interaction."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isInvalid",
      "label": "Validation state",
      "purpose": "Validation state selects the existing RadioGroup isInvalid behavior.",
      "values": [
        {
          "value": false,
          "purpose": "No invalid state requested."
        },
        {
          "value": true,
          "purpose": "Expose validation state and the authored error."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "orientation",
      "label": "ARIA orientation",
      "purpose": "Orientation aligns the options layout with keyboard semantics.",
      "values": [
        {
          "value": "horizontal",
          "purpose": "Horizontal option layout and keyboard semantics."
        },
        {
          "value": "vertical",
          "purpose": "Vertical option layout and keyboard semantics."
        }
      ],
      "applicability": "Layout and keyboard semantics follow the supplied orientation.",
      "support": {
        "state": "implemented",
        "reason": "The component uses orientation for layout and forwards it to the ARIA primitive."
      }
    }
  ],
  "constraints": []
}, "src/components/RadioGroup.tsx"),
  "enter.file-trigger": entry(
{
  "purpose": "Start device file selection from an authored trigger.",
  "useWhen": "The reader needs to choose local files with native picker behavior.",
  "avoidWhen": "The task requires upload management, file previews or drag-and-drop.",
  "alternatives": "Compose a consumer-owned upload block for progress and preview; use Button as the trigger.",
  "content": "Name the file-selection action and explain accepted files in nearby content.",
  "anatomy": "A pressable trigger leading to the device’s file-choice experience.",
  "composition": "In a consumer-owned attachment block, combine FileTrigger with file state and ProgressBar.",
  "accessibility": "Use a pressable trigger; disabled behavior belongs to that trigger, not a styled picker surface."
},
{
  "exportName": "FileTrigger",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. No local visual surface or camera default is supplied. FileList handling, preview, upload progress and trigger disabled state belong to consumer composition.",
  "options": [
    {
      "prop": "allowsMultiple",
      "label": "Multiple files",
      "purpose": "Multiple files selects the existing FileTrigger allowsMultiple behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Choose one file."
        },
        {
          "value": true,
          "purpose": "Allow multiple file choices."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "defaultCamera",
      "label": "Capture camera",
      "purpose": "Capture camera selects the existing FileTrigger defaultCamera behavior.",
      "values": [
        {
          "value": "user",
          "purpose": "User-facing camera hint."
        },
        {
          "value": "environment",
          "purpose": "Environment-facing camera hint."
        }
      ],
      "applicability": "Omission is supported. A consumer preview choosing a camera does not create a package default.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/FileTrigger.tsx"),
  "enter.field": entry(
{
  "purpose": "Associate a label and supporting messages with a custom control.",
  "useWhen": "The control has no dedicated labelled field component in this package.",
  "avoidWhen": "A supplied TextField, Select or other labelled component already owns this wiring.",
  "alternatives": "Prefer the dedicated input component when available; Field supplies wiring rather than an input.",
  "content": "Write a control label, an optional instruction and a specific validation message.",
  "anatomy": "A label, one custom value control and optional helper and error messages.",
  "composition": "In a consumer-owned signature block, spread Field’s generated wiring onto the actual input control.",
  "accessibility": "The consumer must apply the generated ID and ARIA properties to the correct focusable control."
},
{
  "exportName": "Field",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "isInvalid",
      "label": "Validation state",
      "purpose": "Validation state selects the existing Field isInvalid behavior.",
      "values": [
        {
          "value": false,
          "purpose": "No validation error announced."
        },
        {
          "value": true,
          "purpose": "Associate the authored error with the control."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isRequired",
      "label": "Required state",
      "purpose": "Required state selects the existing Field isRequired behavior.",
      "values": [
        {
          "value": false,
          "purpose": "No required signal supplied."
        },
        {
          "value": true,
          "purpose": "Pass required semantics to the authored control."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Field.tsx"),
  "inform.badge": entry(
{
  "purpose": "Attach a compact static category or status label to content.",
  "useWhen": "A short label helps scanning without becoming another interaction.",
  "avoidWhen": "The reader needs to remove the label or perform an action.",
  "alternatives": "Use Chip for a removable label; StatusMark for a lighter labelled state.",
  "content": "Write the category or state explicitly instead of communicating it through color alone.",
  "anatomy": "One compact label enclosed in a small visual treatment.",
  "composition": "In a consumer-owned result-card block, place Badge beside a release-state title.",
  "accessibility": "Badge is static text; do not present it as a keyboard-operable control."
},
{
  "exportName": "Badge",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "variant",
      "label": "Label tone",
      "purpose": "Label tone selects the existing Badge variant behavior.",
      "values": [
        {
          "value": "default",
          "purpose": "Label tone selects the existing Badge variant behavior."
        },
        {
          "value": "secondary",
          "purpose": "Neutral category."
        },
        {
          "value": "destructive",
          "purpose": "Danger label."
        },
        {
          "value": "outline",
          "purpose": "Label tone selects the existing Badge variant behavior."
        },
        {
          "value": "ghost",
          "purpose": "Label tone selects the existing Badge variant behavior."
        },
        {
          "value": "link",
          "purpose": "Label tone selects the existing Badge variant behavior."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/preview-runtime/components/badge/badge.tsx"),
  "inform.banner": entry(
{
  "purpose": "Deliver a persistent inline message with a meaningful severity.",
  "useWhen": "Information or a warning belongs in the normal content flow until the reader responds.",
  "avoidWhen": "The message is a queued transient notification or neutral content without severity.",
  "alternatives": "Use a consumer-owned toast flow for transient notices; Card for ordinary grouped content.",
  "content": "Write the message so its severity is understandable without its status color.",
  "anatomy": "One persistent message region with an optional dismissal affordance.",
  "composition": "In a consumer-owned form-status block, place Banner above the affected fields and let the owner handle dismissal.",
  "accessibility": "Danger is an assertive alert; other severities are polite status messages, not independently configurable live-region modes."
},
{
  "exportName": "Banner",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "variant",
      "label": "Message severity",
      "purpose": "Message severity selects the existing Banner variant behavior.",
      "values": [
        {
          "value": "info",
          "purpose": "Polite information message."
        },
        {
          "value": "success",
          "purpose": "Polite success message."
        },
        {
          "value": "warning",
          "purpose": "Polite warning message."
        },
        {
          "value": "danger",
          "purpose": "Destructive danger appearance coupled to an assertive alert."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": [
    {
      "kind": "derived",
      "props": [
        "variant"
      ],
      "reason": "danger couples danger appearance with alert/assertive; other severities use status/polite. No independent live-region option.",
      "enforcement": "derived",
      "evidence": {
        "source": "src/components/Banner.tsx",
        "evidence": "aria-live={isAssertive ? \"assertive\" : \"polite\"}"
      }
    }
  ]
}, "src/components/Banner.tsx"),
  "inform.chip": entry(
{
  "purpose": "Represent a compact label with an optional removal action.",
  "useWhen": "A selected filter or entity may be removed as a single unit.",
  "avoidWhen": "The label needs only passive status or opens a separate destination.",
  "alternatives": "Use Badge for static status; Link for a navigable label.",
  "content": "Name the represented item and, when removable, name exactly which item removal affects.",
  "anatomy": "A compact item label plus a conditional remove affordance.",
  "composition": "In a consumer-owned selected-filters block, remove the corresponding filter when Chip requests removal.",
  "accessibility": "Supplying onRemove requires a specific removeLabel in the type contract; disabled removal stays inert."
},
{
  "exportName": "Chip",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Removal availability",
      "purpose": "Removal availability selects the existing Chip isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Removal may be activated when present."
        },
        {
          "value": true,
          "purpose": "Removal is disabled and the label is dimmed."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": [
    {
      "kind": "requires",
      "props": [
        "onRemove",
        "removeLabel"
      ],
      "reason": "onRemove requires an accessible removeLabel in the type contract; this is not a runtime validation guard.",
      "enforcement": "type",
      "evidence": {
        "source": "src/components/Chip.tsx",
        "evidence": "onRemove: () => void;"
      },
      "when": {
        "prop": "onRemove",
        "present": true
      },
      "requires": [
        "removeLabel"
      ]
    }
  ]
}, "src/components/Chip.tsx"),
  "inform.status-mark": entry(
{
  "purpose": "Name one data state with a small distinctive mark.",
  "useWhen": "Several nearby states need a lighter treatment than filled status pills.",
  "avoidWhen": "The content needs a large message, a removable label or a quantitative scale.",
  "alternatives": "Use Badge for a filled static label; Banner for a persistent message; Meter for quantity.",
  "content": "Write the state in words so the mark is a redundant cue.",
  "anatomy": "One state label preceded by a tone-specific symbolic mark.",
  "composition": "In a consumer-owned records block, place StatusMark in a table cell beside the affected record.",
  "accessibility": "Visible state text carries the meaning; its glyph is decorative and tone determines shape."
},
{
  "exportName": "StatusMark",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. tone is required with no package default. Shape follows tone: success circle, warning triangle, danger diamond, info open-circle, neutral dash.",
  "options": [
    {
      "prop": "tone",
      "label": "State tone",
      "purpose": "State tone selects the existing StatusMark tone behavior.",
      "values": [
        {
          "value": "success",
          "purpose": "Success circle."
        },
        {
          "value": "warning",
          "purpose": "Warning triangle."
        },
        {
          "value": "danger",
          "purpose": "Danger diamond."
        },
        {
          "value": "info",
          "purpose": "Information open circle."
        },
        {
          "value": "neutral",
          "purpose": "Neutral dash."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": [
    {
      "kind": "derived",
      "props": [
        "tone"
      ],
      "reason": "State glyph shape is derived from tone and is not an independent configurable prop.",
      "enforcement": "derived",
      "evidence": {
        "source": "src/components/StatusMark.tsx",
        "evidence": "data-shape={SHAPES[tone]}"
      }
    }
  ]
}, "src/components/StatusMark.tsx"),
  "inform.meter": entry(
{
  "purpose": "Explain a measured quantity against a scale and optional limit.",
  "useWhen": "The quantity’s magnitude or distance from a cap or floor matters.",
  "avoidWhen": "The value describes completion progress rather than a measurement.",
  "alternatives": "Use ProgressBar for completion; StatusMark for a state without magnitude.",
  "content": "Author the visible value, optional limit and prior-value text with their real units.",
  "anatomy": "A measured value, a scale track and optional limit and prior-measurement markers.",
  "composition": "In a consumer-owned metric-panel block, pair Meter with a heading and explanatory limit text.",
  "accessibility": "The visible text carries the meaning; decorative geometry cannot replace valueText or previousText."
},
{
  "exportName": "Meter",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. tone is required with no default. scaleMax must be finite and positive; value and limit finite/nonnegative. Value and limit drawing clamp to the scale; previous above scaleMax rejects. direction defaults to max but needs limit for a visible effect.",
  "options": [
    {
      "prop": "tone",
      "label": "Measurement tone",
      "purpose": "Measurement tone selects the existing Meter tone behavior.",
      "values": [
        {
          "value": "success",
          "purpose": "Success state."
        },
        {
          "value": "warning",
          "purpose": "Warning with hatching."
        },
        {
          "value": "danger",
          "purpose": "Danger state."
        },
        {
          "value": "info",
          "purpose": "Information with inset ring."
        },
        {
          "value": "neutral",
          "purpose": "Plain neutral quantity."
        },
        {
          "value": "accent",
          "purpose": "Brand-accent quantity, not a status."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "direction",
      "label": "Limit direction",
      "purpose": "Limit direction selects the existing Meter direction behavior.",
      "values": [
        {
          "value": "max",
          "purpose": "Value should remain at or below the cap."
        },
        {
          "value": "min",
          "purpose": "Value should remain at or above the floor."
        }
      ],
      "applicability": "Accepted without limit but produces no limit zone or tick until limit is supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "emphasis",
      "label": "Value emphasis",
      "purpose": "Value emphasis selects the existing Meter emphasis behavior.",
      "values": [
        {
          "value": "default",
          "purpose": "Compact value row."
        },
        {
          "value": "figure",
          "purpose": "Large focal measurement."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": [
    {
      "kind": "effective-when",
      "props": [
        "direction",
        "limit"
      ],
      "reason": "direction is accepted without limit but has no visible limit zone until limit is supplied.",
      "enforcement": "ignored",
      "evidence": {
        "source": "src/components/Meter.server.tsx",
        "evidence": "limitPct === undefined"
      },
      "effectiveWhen": {
        "prop": "limit",
        "present": true
      }
    },
    {
      "kind": "paired",
      "props": [
        "previous",
        "previousText"
      ],
      "reason": "previous and nonblank previousText must be supplied together; previous is finite, nonnegative and within scaleMax.",
      "enforcement": "runtime",
      "evidence": {
        "source": "src/components/Meter.server.tsx",
        "evidence": "(previous === undefined) !== (previousText === undefined)"
      }
    }
  ]
}, "src/components/Meter.tsx"),
  "inform.progress-bar": entry(
{
  "purpose": "Communicate completion of an ongoing operation.",
  "useWhen": "Progress is known numerically or explicitly unknown while work continues.",
  "avoidWhen": "The quantity is a stable measurement against a threshold.",
  "alternatives": "Use Meter for a measurement; Spinner for compact indeterminate activity.",
  "content": "Name the operation and provide truthful completion values or an indeterminate state.",
  "anatomy": "An operation label and a progress track with an optional value readout.",
  "composition": "In a consumer-owned upload-status block, connect ProgressBar to actual transferred work.",
  "accessibility": "Indeterminate progress must not announce a fabricated numeric completion value."
},
{
  "exportName": "ProgressBar",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "isIndeterminate",
      "label": "Completion knowledge",
      "purpose": "Completion knowledge selects the existing ProgressBar isIndeterminate behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Known numeric completion."
        },
        {
          "value": true,
          "purpose": "Unknown completion; omit the numeric value announcement."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/ProgressBar.tsx"),
  "inform.spinner": entry(
{
  "purpose": "Signal compact indeterminate activity.",
  "useWhen": "Work is ongoing but no useful completion fraction is known.",
  "avoidWhen": "The reader needs a stable measurement or a detailed loading layout.",
  "alternatives": "Use ProgressBar for known progress; Skeleton for a placeholder matching incoming content.",
  "content": "Supply an activity name only when the spinner is the sole loading signal.",
  "anatomy": "One small activity mark with an optional textual equivalent.",
  "composition": "In a consumer-owned save-status block, pair Spinner with visible saving text or its own label.",
  "accessibility": "An unlabelled Spinner is decorative; label it when no other content announces loading."
},
{
  "exportName": "Spinner",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "size",
      "label": "Size",
      "purpose": "Size selects the existing Spinner size behavior.",
      "values": [
        {
          "value": "sm",
          "purpose": "sm size within the existing component scale."
        },
        {
          "value": "md",
          "purpose": "md size within the existing component scale."
        },
        {
          "value": "lg",
          "purpose": "lg size within the existing component scale."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Spinner.tsx"),
  "inform.skeleton": entry(
{
  "purpose": "Reserve the shape of content that is still loading.",
  "useWhen": "The structure of incoming content can be shown without inventing its value.",
  "avoidWhen": "The interface needs to report exact progress or an actual empty state.",
  "alternatives": "Use ProgressBar for completion; a consumer-owned empty-state block when loading has finished.",
  "content": "Choose a placeholder shape corresponding to the expected content.",
  "anatomy": "A text, block or circular placeholder for one incoming content piece.",
  "composition": "In a consumer-owned loading-card block, group title and image Skeletons under one loading announcement.",
  "accessibility": "Label a lone loading placeholder; grouped decorative placeholders need one surrounding announcement."
},
{
  "exportName": "Skeleton",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "shape",
      "label": "Placeholder shape",
      "purpose": "Placeholder shape selects the existing Skeleton shape behavior.",
      "values": [
        {
          "value": "text",
          "purpose": "One text-height line."
        },
        {
          "value": "block",
          "purpose": "Block filling its authored container."
        },
        {
          "value": "circle",
          "purpose": "Circular placeholder requiring authored size."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Skeleton.tsx"),
  "group.card": entry(
{
  "purpose": "Give a small unit of related content a coherent surface.",
  "useWhen": "Content needs a shared ground distinct from its surrounding section.",
  "avoidWhen": "The surface needs interaction semantics supplied automatically.",
  "alternatives": "Use a consumer-owned card block for named heading, body and actions; Link or Button for actual interaction.",
  "content": "Keep the content hierarchy meaningful within the surface rather than relying on the border.",
  "anatomy": "One containing content surface whose treatment follows its context.",
  "composition": "In a consumer-owned summary-card block, compose Card with a heading, metric and action.",
  "accessibility": "A Card is not inherently interactive or a landmark; add appropriate semantics through composition."
},
{
  "exportName": "Card",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "ground",
      "label": "Surrounding ground",
      "purpose": "Surrounding ground selects the existing Card ground behavior.",
      "values": [
        {
          "value": "base",
          "purpose": "Page ground."
        },
        {
          "value": "sunken",
          "purpose": "Sunken section ground."
        },
        {
          "value": "inverse",
          "purpose": "Inverse section ground."
        }
      ],
      "applicability": "Accepted but ignored for raised; read by plate and outline.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "variant",
      "label": "Surface treatment",
      "purpose": "Surface treatment selects the existing Card variant behavior.",
      "values": [
        {
          "value": "raised",
          "purpose": "Raised fill and elevation."
        },
        {
          "value": "plate",
          "purpose": "Opposite ground without an edge."
        },
        {
          "value": "outline",
          "purpose": "Panel edge without a shadow."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": [
    {
      "kind": "effective-when",
      "props": [
        "ground",
        "variant"
      ],
      "reason": "raised ignores ground; plate and outline consume it.",
      "enforcement": "ignored",
      "evidence": {
        "source": "src/components/Card.tsx",
        "evidence": "PLATE_CLASSES[ground]"
      },
      "effectiveWhen": {
        "prop": "variant",
        "values": [
          "plate",
          "outline"
        ]
      }
    }
  ]
}, "src/components/Card.tsx"),
  "group.grid-list": entry({
    purpose: "Work through interactive records with independent selection and actions.",
    useWhen: "Records have flexible content, selection controls or secondary actions within each row.",
    avoidWhen: "Column relationships require a table or content has no row interaction.",
    alternatives: "Use Table for shared columns or ResourceList for an assembled record-list block.",
    content: "Supply a list name, each row’s plain text identity and host-authored checkbox names.",
    anatomy: "A named grid with repeated record rows and optional selection checkboxes.",
    composition: "Compose GridList.Item content with GridList.SelectionCheckbox and named child actions.",
    accessibility: "Space toggles selection and Enter activates onAction during selection; href routing follows the peer’s toggle-selection semantics."
  }, {
    exportName: "GridList", entrypoint: "components",
    notes: "Draft stack layout with toggle selection fixed by the component. The peer supplies collection, keyboard, disabled and action behavior. Supply aria-label or aria-labelledby; each Item requires textValue and each SelectionCheckbox requires its host aria-label. Direct-row Enter adapts onAction during active selection. Href rows route while selection is empty; active-selection row presses toggle selection without navigation.",
    options: [],
    constraints: [{ kind: "data", props: ["aria-label", "aria-labelledby"], reason: "At least one nonblank accessible naming path is required.", enforcement: "runtime", evidence: { source: "src/components/GridList.tsx", evidence: "GridList requires aria-label or aria-labelledby." } }]
  }, "src/components/GridList.tsx"),
  "group.table": entry(
{
  "purpose": "Compare structured records across shared columns.",
  "useWhen": "Each record has the same attributes and row or column relationships matter.",
  "avoidWhen": "The content is a simple unstructured list or needs an already assembled data-grid feature set.",
  "alternatives": "Use a consumer-owned list block for prose items; build sorting and filtering around Table primitives.",
  "content": "Author meaningful column headings, row identities and cell values.",
  "anatomy": "Column headings and repeated records made of corresponding cells.",
  "composition": "In a consumer-owned records block, assemble Table.Header, Table.Body, rows and cells with selection controls.",
  "accessibility": "Name the table and identify row headers; controlled sorting and selection need consumer state."
},
{
  "exportName": "Table",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Compound Header/Column/Body/Row/Cell parts own content. Selection checkboxes reuse Checkbox. Sorting and selection are controlled by consumer state; a one-row fixture is limited demonstration evidence.",
  "options": [
    {
      "prop": "selectionMode",
      "label": "Row selection",
      "purpose": "Row selection selects the existing Table selectionMode behavior.",
      "values": [
        {
          "value": "none",
          "purpose": "No row selection."
        },
        {
          "value": "single",
          "purpose": "Select one row."
        },
        {
          "value": "multiple",
          "purpose": "Select multiple rows."
        }
      ],
      "applicability": "Controlled selectedKeys requires a state-updating handler; multiple rows are needed to demonstrate selection differences.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Table.tsx"),
  "group.separator": entry(
{
  "purpose": "Mark a boundary between neighboring groups of content.",
  "useWhen": "A subtle rule improves grouping without adding another content surface.",
  "avoidWhen": "Spacing alone already explains the structure or the rule is mistaken for content.",
  "alternatives": "Use Card for a containing surface; use spacing within a consumer-owned block for weak grouping.",
  "content": "A separator carries no authored message; the adjacent groups provide its meaning.",
  "anatomy": "One horizontal or vertical boundary, optionally purely decorative.",
  "composition": "In a consumer-owned toolbar block, use decorative Separator between related action groups.",
  "accessibility": "Mark decorative boundaries hidden; a semantic separator keeps the corresponding orientation."
},
{
  "exportName": "Separator",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "orientation",
      "label": "Boundary orientation",
      "purpose": "Boundary orientation selects the existing Separator orientation behavior.",
      "values": [
        {
          "value": "horizontal",
          "purpose": "Horizontal content boundary."
        },
        {
          "value": "vertical",
          "purpose": "Vertical content boundary."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/preview-runtime/components/separator/separator.tsx"),
  "depict.logomark": entry({
    purpose: "Represent a brand with one decorative glyph and an optional shared plate.",
    useWhen: "A surrounding identity link or adjacent text already names the brand.",
    avoidWhen: "The image must communicate an accessible name or act as a standalone control.",
    alternatives: "Use Lockup for a mark beside live text; use Brandmark for the established home link.",
    content: "Supply the light, dark or mono artwork as an image URL, never injected markup.",
    anatomy: "One glyph image, optionally inset inside one rounded square plate.",
    composition: "In Lockup, place Logomark before the live wordmark and center both regions vertically.",
    accessibility: "The image has empty alternative text; its surrounding text or control supplies the name.",
  }, {
    exportName: "Logomark", entrypoint: "components",
    notes: "Size, tone and plate are finite choices. Artwork URLs and optional titles are authored content; artwork contrast remains caller-owned.",
    options: [
      { prop: "size", label: "Size", purpose: "Select the mark height from the existing brandmark scale.",
        values: [{ value: "sm", purpose: "Small mark height." }, { value: "md", purpose: "Medium mark height." }, { value: "lg", purpose: "Large mark height." }],
        applicability: "Always effective; size is required.", support: { state: "implemented", reason: "The mark consumes its size through the shared height bindings." } },
      { prop: "tone", label: "Plate ink", purpose: "Choose shared plate ink to match the surrounding ground.",
        values: [{ value: "auto", purpose: "Primary ink plate." }, { value: "inverse", purpose: "Inverse ink plate." }],
        applicability: "Effective only with a shared plate; self-plated artwork supplies its own paint.", support: { state: "implemented", reason: "The shared plate selects the corresponding existing ink utility." } },
      { prop: "plate", label: "Plate ownership", purpose: "Choose whether the caller artwork already includes a plate.",
        values: [{ value: "self", purpose: "Render the supplied artwork at its natural aspect ratio." }, { value: "shared", purpose: "Inset the glyph in the shared square plate." }],
        applicability: "Always effective for the mark geometry.", support: { state: "implemented", reason: "The component renders either the image alone or the shared plate." } },
    ],
    constraints: [{ kind: "effective-when", props: ["tone"], enforcement: "ignored", effectiveWhen: { prop: "plate", values: ["shared"] },
      reason: "Tone paints the shared plate only; it never rewrites the supplied artwork URL.",
      evidence: { source: "src/components/Logomark.tsx", evidence: 'if (plate !== "shared")' } }],
  }, "src/components/Logomark.tsx"),
  "depict.avatar": entry(
{
  "purpose": "Represent one person or entity with a picture or initials.",
  "useWhen": "A compact identity cue helps readers recognize an associated entity.",
  "avoidWhen": "The image is explanatory content, a general illustration or the only identification text needed.",
  "alternatives": "Use an ordinary content image for illustration; pair Avatar with a visible name in a consumer-owned identity block.",
  "content": "Supply the represented entity’s name and an optional image source.",
  "anatomy": "One identity image or its initials alternative.",
  "composition": "In a consumer-owned author block, place Avatar beside the author name and affiliation.",
  "accessibility": "The same required alt name identifies the image and its load-failure initials fallback."
},
{
  "exportName": "Avatar",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "size",
      "label": "Size",
      "purpose": "Size selects the existing Avatar size behavior.",
      "values": [
        {
          "value": "sm",
          "purpose": "sm size within the existing component scale."
        },
        {
          "value": "md",
          "purpose": "md size within the existing component scale."
        },
        {
          "value": "lg",
          "purpose": "lg size within the existing component scale."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Avatar.tsx"),
  "depict.icon": entry(
{
  "purpose": "Render one symbolic glyph with a consistent visual and naming contract.",
  "useWhen": "A compact symbol supports a labelled control or conveys a named concept.",
  "avoidWhen": "The image needs photographic detail or a string-based glyph lookup.",
  "alternatives": "Use Avatar for entity pictures; IconButton for a named glyph action.",
  "content": "Supply glyph data or inner SVG markup, and decide whether the symbol adds information.",
  "anatomy": "One symbolic image and, when informative, an equivalent name.",
  "composition": "In a consumer-owned benefit block, pair a decorative Icon with a visible benefit heading.",
  "accessibility": "Choose decorative or labelled semantics exclusively, and glyph or children content exclusively."
},
{
  "exportName": "Icon",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "size",
      "label": "Size",
      "purpose": "Size selects the existing Icon size behavior.",
      "values": [
        {
          "value": "sm",
          "purpose": "sm size within the existing component scale."
        },
        {
          "value": "md",
          "purpose": "md size within the existing component scale."
        },
        {
          "value": "lg",
          "purpose": "lg size within the existing component scale."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": [
    {
      "kind": "exclusive",
      "props": [
        "decorative",
        "label"
      ],
      "reason": "decorative true excludes label; informative icons require label with decorative false or omitted.",
      "enforcement": "type",
      "evidence": {
        "source": "src/components/Icon.tsx",
        "evidence": "decorative: true;"
      },
      "when": {
        "prop": "decorative",
        "values": [
          true
        ]
      },
      "excludes": [
        "label"
      ]
    },
    {
      "kind": "exclusive",
      "props": [
        "glyph",
        "children"
      ],
      "reason": "Supply glyph data or inner SVG children, never both; children is content, not a scalar configuration.",
      "enforcement": "type",
      "evidence": {
        "source": "src/components/Icon.tsx",
        "evidence": "glyph: IconNode; children?: undefined"
      },
      "presence": "exactly-one"
    },
    {
      "kind": "requires",
      "props": [
        "label"
      ],
      "reason": "An informative icon needs label when decorative is false or omitted.",
      "enforcement": "type",
      "evidence": {
        "source": "src/components/Icon.tsx",
        "evidence": "label: string;"
      },
      "when": {
        "any": [
          {
            "prop": "decorative",
            "values": [
              false
            ]
          },
          {
            "prop": "decorative",
            "present": false
          }
        ]
      },
      "requires": [
        "label"
      ]
    }
  ]
}, "src/components/Icon.tsx"),
  "reveal.dialog": entry(
{
  "purpose": "Focus attention on a modal task that temporarily suspends the page.",
  "useWhen": "The reader needs to finish or dismiss a bounded task before returning.",
  "avoidWhen": "The information can remain inline or is merely a short description.",
  "alternatives": "Use Disclosure for inline content; Popover for an anchored task; Tooltip for a short description.",
  "content": "Supply a clear dialog heading and purposeful task content through the content slot.",
  "anatomy": "An opening trigger, a modal content surface and a dismissal path.",
  "composition": "In a consumer-owned confirmation block, compose Dialog.Heading, the explanation and explicit action controls.",
  "accessibility": "Retain focus containment, Escape dismissal and focus return; use Dialog.Heading for the content name."
},
{
  "exportName": "Dialog",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [
    {
      "prop": "size",
      "label": "Dialog width",
      "purpose": "Dialog width selects the existing Dialog size behavior.",
      "values": [
        {
          "value": "sm",
          "purpose": "Small modal surface."
        },
        {
          "value": "md",
          "purpose": "Medium modal surface."
        },
        {
          "value": "lg",
          "purpose": "Large modal surface."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "isDismissable",
      "label": "Outside dismissal",
      "purpose": "Outside dismissal selects the existing Dialog isDismissable behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Outside click leaves the dialog open; Escape still closes it."
        },
        {
          "value": true,
          "purpose": "Outside click dismisses the dialog; Escape also closes it."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Dialog.tsx"),
  "reveal.popover": entry(
{
  "purpose": "Reveal an anchored panel for a small contextual task.",
  "useWhen": "A rich preview or compact form should remain visually related to its trigger.",
  "avoidWhen": "A purpose-built menu, choice field or tooltip already matches the content.",
  "alternatives": "Use Menu for commands, Select for choices, Tooltip for short help, or Dialog for a larger modal task.",
  "content": "Name the trigger and give the panel content an understandable task hierarchy.",
  "anatomy": "One contextual trigger and its anchored content panel.",
  "composition": "In a consumer-owned filter block, put several filter fields inside Popover and manage their state outside it.",
  "accessibility": "The panel uses dialog behavior; supply aria-label for its accessible name when there is no visible title heading, and preserve focus entry, outside dismissal and return to the trigger."
},
{
  "exportName": "Popover",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. placement defaults to bottom and offset to 8. The inner AriaDialog supplies dialog behavior; this is not a nonmodal arbitrary HTML tooltip.",
  "options": [],
  "constraints": []
}, "src/components/Popover.tsx"),
  "reveal.tooltip": entry(
{
  "purpose": "Give a short supplementary description of another element.",
  "useWhen": "The trigger already has a name and needs brief contextual explanation.",
  "avoidWhen": "The information is essential instructions, an interactive panel or the control’s only label.",
  "alternatives": "Use visible helper text for essential guidance; Popover for interactive or rich content.",
  "content": "Write a short description that adds to the trigger name rather than repeating it.",
  "anatomy": "A described trigger and its transient explanatory text.",
  "composition": "In a consumer-owned icon-toolbar block, use Tooltip to supplement an already labelled IconButton.",
  "accessibility": "Keep keyboard-focus access and the description association; hover alone cannot provide the information."
},
{
  "exportName": "Tooltip",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. placement defaults to top. triggerAction is forwarded without a local initializer. Any peer timing defaults are separate from package-authored defaults.",
  "options": [
    {
      "prop": "triggerAction",
      "label": "Description interaction",
      "purpose": "Description interaction selects the existing Tooltip triggerAction behavior.",
      "values": [
        {
          "value": "hover",
          "purpose": "Hover and keyboard focus behavior."
        },
        {
          "value": "focus",
          "purpose": "Keyboard focus behavior only."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/components/Tooltip.tsx"),
  "reveal.disclosure": entry(
{
  "purpose": "Reveal or hide one section while retaining its place in the document.",
  "useWhen": "Supplementary content can be expanded without opening a separate overlay.",
  "avoidWhen": "The task needs mutually exclusive panels or a coordinated accordion controller.",
  "alternatives": "Use Tabs for peer panels; a consumer-owned accordion block for coordinated disclosures.",
  "content": "Name the expandable section with a title that predicts its contents.",
  "anatomy": "One persistent section trigger and its expandable content.",
  "composition": "In a consumer-owned FAQ block, repeat Disclosure for independently expandable answers.",
  "accessibility": "Preserve the trigger-to-panel association and expanded state; hidden content remains part of the disclosure."
},
{
  "exportName": "Disclosure",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied.",
  "options": [],
  "constraints": []
}, "src/components/Disclosure.tsx"),
  "reveal.tabs": entry(
{
  "purpose": "Switch among peer panels within the same context.",
  "useWhen": "A small set of related panels can share one location.",
  "avoidWhen": "The controls navigate to unrelated pages or hide essential sequential instructions.",
  "alternatives": "Use Link for route navigation; Disclosure for inline supplementary sections.",
  "content": "Give each tab a distinct label and match it to the corresponding panel identity.",
  "anatomy": "A repeated set of tab labels and one associated panel per label.",
  "composition": "In a consumer-owned account-details block, compose Tabs.List, multiple Tabs.Tab items and matched Tabs.Panel content.",
  "accessibility": "Preserve tab-panel IDs and keyboard selection; orientation aligns the list layout, indicator edge and keyboard navigation."
},
{
  "exportName": "Tabs",
  "entrypoint": "components",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Orientation sets the list to a row with bottom indicators or a column with start-edge indicators and forwards matching semantics to AriaTabs. A single-option specimen cannot prove panel switching.",
  "options": [
    {
      "prop": "isDisabled",
      "label": "Availability",
      "purpose": "Availability selects the existing Tabs isDisabled behavior.",
      "values": [
        {
          "value": false,
          "purpose": "Enabled interaction."
        },
        {
          "value": true,
          "purpose": "Disabled interaction."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "orientation",
      "label": "ARIA orientation",
      "purpose": "Orientation aligns the list layout and indicator edge with keyboard semantics.",
      "values": [
        {
          "value": "horizontal",
          "purpose": "Horizontal list with bottom indicators and keyboard semantics."
        },
        {
          "value": "vertical",
          "purpose": "Vertical list with start-edge indicators and keyboard semantics."
        }
      ],
      "applicability": "Layout and keyboard semantics follow the supplied orientation.",
      "support": {
        "state": "implemented",
        "reason": "The component uses orientation for layout and forwards it to the ARIA primitive."
      }
    }
  ],
  "constraints": []
}, "src/components/Tabs.tsx"),
  "depict.bar-chart": entry(
{
  "purpose": "Compare magnitudes across discrete categories.",
  "useWhen": "A common numeric scale makes category differences easy to judge.",
  "avoidWhen": "The story is continuous change, paired numeric relationships or incompatible units.",
  "alternatives": "Use LineChart for change, ScatterChart for relationships, or separate charts for unlike units.",
  "content": "Supply category labels and aligned series values with stable series identity.",
  "anatomy": "Discrete category marks sharing one magnitude scale and a text alternative.",
  "composition": "In a consumer-owned comparison block, combine BarChart with a question heading and explanatory caption.",
  "accessibility": "Retain the title and table alternative; static marks and fluid sizing are separate choices."
},
{
  "exportName": "BarChart",
  "entrypoint": "charts",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. fit defaults to fixed, marks to interactive. Intrinsic width defaults to 480 for fixed and 360 for fluid; height defaults to 280. Static OR fluid uses token mark geometry, while marks alone controls interaction. No stacking or orientation option exists.",
  "options": [
    {
      "prop": "fit",
      "label": "Sizing behavior",
      "purpose": "Sizing behavior selects the existing BarChart fit behavior.",
      "values": [
        {
          "value": "fixed",
          "purpose": "Intrinsic fixed-size graphic."
        },
        {
          "value": "fluid",
          "purpose": "Fluid fitting of the intrinsic chart."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    },
    {
      "prop": "marks",
      "label": "Mark interaction",
      "purpose": "Mark interaction selects the existing BarChart marks behavior.",
      "values": [
        {
          "value": "interactive",
          "purpose": "Focusable marks with individual labels."
        },
        {
          "value": "static",
          "purpose": "One static graphic with table alternative."
        }
      ],
      "applicability": "Fluid fit changes token mark geometry but retains interaction when marks remains interactive.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/charts/BarChart.tsx"),
  "depict.line-chart": entry(
{
  "purpose": "Show how one or more series change over ordered positions.",
  "useWhen": "Time or another meaningful ordered numeric axis explains the trend.",
  "avoidWhen": "Unordered categories or unrelated measurement scales would imply a misleading connection.",
  "alternatives": "Use BarChart for categories; ScatterChart for numeric association without a connecting sequence.",
  "content": "Supply a shared ordered x domain, aligned series values and stable names.",
  "anatomy": "Ordered connected observations on one x scale and one y scale.",
  "composition": "In a consumer-owned trend block, pair LineChart with an explanation of the shared units and period.",
  "accessibility": "The keyboard inspection overlay must offer the same values as pointer inspection and the table."
},
{
  "exportName": "LineChart",
  "entrypoint": "charts",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Intrinsic width defaults to 480 and height to 280. This component has no fit or marks prop. Pointer and keyboard overlay inspection uses component state; never infer static support from another chart.",
  "options": [],
  "constraints": []
}, "src/charts/LineChart.tsx"),
  "depict.sparkline": entry(
{
  "purpose": "Summarize a small inline sequence as a compact trend.",
  "useWhen": "A nearby number or text supplies context and a full chart would be disproportionate.",
  "avoidWhen": "The reader needs detailed axis reading, multiple series comparison or hover inspection.",
  "alternatives": "Use LineChart for an inspectable trend; plain text for a value with no meaningful sequence.",
  "content": "Provide the sequence and a title that explains its meaning.",
  "anatomy": "One compact trend line with an end marker and a text data alternative.",
  "composition": "In a consumer-owned metric-tile block, place Sparkline beside the current figure and period label.",
  "accessibility": "The required title names the otherwise uncaptioned graphic; its native table remains available."
},
{
  "exportName": "Sparkline",
  "entrypoint": "charts",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Intrinsic dimensions default to 120 by 24. The component owns its SVG title and native table disclosure; it does not use ChartFrame or supply hover, axes or legend.",
  "options": [],
  "constraints": []
}, "src/charts/Sparkline.tsx"),
  "depict.waterfall-chart": entry(
{
  "purpose": "Explain how signed changes connect an opening and closing total.",
  "useWhen": "The reader needs to account for contributions to a cumulative change.",
  "avoidWhen": "The values are unrelated category totals or percentages without a meaningful accumulation.",
  "alternatives": "Use BarChart for independent magnitudes; LineChart for a temporal sequence.",
  "content": "Author opening total, uniquely identified signed steps, closing label and table headings.",
  "anatomy": "Opening and closing totals connected by successive positive or negative changes.",
  "composition": "In a consumer-owned reconciliation block, pair WaterfallChart with the accounting period and units.",
  "accessibility": "Keep signed value labels and the table; a supplied closing value asserts the calculated total."
},
{
  "exportName": "WaterfallChart",
  "entrypoint": "charts",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Fluid fit, width 360 and height 280 are the defaults. All values and accumulated totals must be finite. Step IDs are unique/nonblank. Optional end.value asserts the accumulated closing total. valueFormat receives unsigned magnitude; the chart owns signs. Authored table/category/value labels are required.",
  "options": [
    {
      "prop": "fit",
      "label": "Sizing behavior",
      "purpose": "Sizing behavior selects the existing WaterfallChart fit behavior.",
      "values": [
        {
          "value": "fixed",
          "purpose": "Intrinsic fixed-size graphic."
        },
        {
          "value": "fluid",
          "purpose": "Fluid fitting of the intrinsic chart."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/charts/WaterfallChart.tsx"),
  "depict.range-chart": entry(
{
  "purpose": "Compare intervals against an authored sequence of periods.",
  "useWhen": "Start and end boundaries within known tick periods describe the records accurately.",
  "avoidWhen": "The task requires arbitrary date parsing, overlapping dependency management or an interactive scheduler.",
  "alternatives": "Use a consumer-owned planning block for scheduling; Table for detailed interval records.",
  "content": "Supply nonblank period names and rows with unique IDs, ordered bounds and optional labelled status.",
  "anatomy": "Repeated labelled intervals over a shared ordered period scale.",
  "composition": "In a consumer-owned timeline-summary block, combine RangeChart with the period definition and status explanation.",
  "accessibility": "Retain complete row and status text and the table; status shape follows its tone rather than a separate option."
},
{
  "exportName": "RangeChart",
  "entrypoint": "charts",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Fluid fit and width 360 are defaults; height is derived from complete row/status text. Bounds satisfy 0 <= from < to <= ticks.length. Nonblank tick periods, row IDs and labels are required. Status requires labels.status; shape follows tone. No independent status-shape option.",
  "options": [
    {
      "prop": "fit",
      "label": "Sizing behavior",
      "purpose": "Sizing behavior selects the existing RangeChart fit behavior.",
      "values": [
        {
          "value": "fixed",
          "purpose": "Intrinsic fixed-size graphic."
        },
        {
          "value": "fluid",
          "purpose": "Fluid fitting of the intrinsic chart."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/charts/RangeChart.tsx"),
  "depict.scatter-chart": entry(
{
  "purpose": "Compare the relationship between two numeric measures across observations.",
  "useWhen": "Three to twelve labelled observations can be read on shared numeric axes.",
  "avoidWhen": "The claim implies causation, needs a dense point cloud or exceeds the declared series limit.",
  "alternatives": "Use LineChart for ordered change; a consumer-owned analysis view for dense exploration.",
  "content": "Author point identities and labels, axis names and any declared size or series meaning.",
  "anatomy": "Labelled observations located by two measures, with optional area and series encoding.",
  "composition": "In a consumer-owned analysis block, place ScatterChart beside the question, units and interpretation.",
  "accessibility": "Keep direct labels and the table; area-scaled size needs a truthful named measure for every point."
},
{
  "exportName": "ScatterChart",
  "entrypoint": "charts",
  "notes": "Represented scalar options are a bounded selection; consult the real prop type for content, data, state, callbacks and compound parts. No Cartesian combination support is implied. Fluid fit, width 360 and height 300 are defaults. Requires 3–12 points and at most four declared series. Point series must match the declared domain. Size encoding requires finite nonnegative size on every point and is forbidden without size. Dimensions are at least 240; axis names are at most 32 graphemes and point labels at most 20.",
  "options": [
    {
      "prop": "fit",
      "label": "Sizing behavior",
      "purpose": "Sizing behavior selects the existing ScatterChart fit behavior.",
      "values": [
        {
          "value": "fixed",
          "purpose": "Intrinsic fixed-size graphic."
        },
        {
          "value": "fluid",
          "purpose": "Fluid fitting of the intrinsic chart."
        }
      ],
      "applicability": "Effective for this component when supplied.",
      "support": {
        "state": "implemented",
        "reason": "The component consumes or forwards this existing prop in the cited source."
      }
    }
  ],
  "constraints": []
}, "src/charts/ScatterChart.tsx"),
  "depict.area-chart": entry(
{
  "purpose": "Compare how one or several quantities change or accumulate across ordered categories or time.",
  "useWhen": "Filled magnitude, authored series totals or a normalized percentage composition answer the stated question.",
  "avoidWhen": "Area overlap conceals the comparison, units differ between series or missing observations would be mistaken for zero.",
  "alternatives": "Use LineChart for precise trends without filled areas, BarChart for categorical comparisons or a table for exact values.",
  "content": "Author one consistent x domain, named same-length series and explicit null gaps; normalized and stacked quantities must be nonnegative.",
  "anatomy": "Contiguous filled runs share axes, a named series legend, an inspection crosshair and an equivalent native data table.",
  "composition": "In a consumer-owned trends block, place AreaChart beside period definitions and an explanation of magnitude, stacking or percentages.",
  "accessibility": "Retain visible series names, keyboard inspection and the complete table; explain missing values rather than relying on the filled colour alone."
},
{
  "exportName": "AreaChart",
  "entrypoint": "charts",
  "notes": "Represented scalar options are a bounded source-checked selection; consult the public prop type and chart README for data, labels, callbacks and other supported props. No Cartesian combination support or consumer demonstration is implied. The stacked prop is supported and described in the public chart contract, but is not a represented comparison axis here. Inspection and selection may be controlled; the server export preserves static geometry and table data.",
  "options": [
    {
      "prop": "normalized",
      "label": "Percentage composition",
      "purpose": "Choose whether the visible series use authored magnitude or normalized column totals.",
      "values": [
        {
          "value": false,
          "purpose": "Retain authored magnitudes on one shared value scale."
        },
        {
          "value": true,
          "purpose": "Stack each nonzero column to a total of one hundred percent."
        }
      ],
      "applicability": "Normalization implies stacking; all-zero columns remain zero and null values remain missing.",
      "support": {
        "state": "implemented",
        "reason": "The directly imported shared chart view consumes this implemented boolean; callers still author data and accessible labels."
      }
    },
    {
      "prop": "smooth",
      "label": "Interpolation",
      "purpose": "Choose straight or smooth geometry within each contiguous nonmissing area run.",
      "values": [
        {
          "value": false,
          "purpose": "Connect adjacent samples with straight segments."
        },
        {
          "value": true,
          "purpose": "Use cubic interpolation within each nonmissing run."
        }
      ],
      "applicability": "Smoothing never connects across an explicit null gap and does not change the table data.",
      "support": {
        "state": "implemented",
        "reason": "The directly imported shared chart view consumes this implemented boolean; callers still author data and accessible labels."
      }
    }
  ],
  "constraints": [
    {
      "kind": "derived",
      "props": [
        "normalized",
        "stacked"
      ],
      "reason": "Normalization implies stacking; an unstacked percentage mode is not a separate supported configuration.",
      "enforcement": "derived",
      "evidence": {
        "source": "src/charts/internal/signature-geometry.ts",
        "evidence": "const bottom = stacked || normalized ? bases[index]! : 0;"
      }
    },
    {
      "kind": "data",
      "props": [
        "x",
        "series"
      ],
      "reason": "Every named series supplies one finite number or explicit null for each x; stacking and normalization refuse negative values.",
      "enforcement": "runtime",
      "evidence": {
        "source": "src/charts/internal/signature-geometry.ts",
        "evidence": "AreaChart series must have one value for every x."
      }
    }
  ]
}, "src/charts/AreaChart.tsx"),
  "depict.heatmap": entry(
{
  "purpose": "Compare a rectangular set of magnitudes or categorical identities across named rows and columns.",
  "useWhen": "The question concerns variation across two discrete dimensions and complete values remain available for inspection.",
  "avoidWhen": "An unordered set needs precise rank comparisons, the category count exceeds eight identities or missing cells would be interpreted as zero.",
  "alternatives": "Use BarChart for ranked magnitude, StatusStrip for interval history or a table when the cell values themselves are the primary task.",
  "content": "Provide unique row and column names and a rectangular matrix; sequential data are finite numbers or null, while categorical identities use a stable domain.",
  "anatomy": "A labelled matrix of cells shares a sequential ramp or categorical legend, a focused value readout and a complete native table.",
  "composition": "In a consumer-owned capacity block, place Heatmap beside the meaning of each matrix dimension and its magnitude or identity legend.",
  "accessibility": "Each cell exposes row, column and value in its name; arrow navigation and the native table retain access without colour matching."
},
{
  "exportName": "Heatmap",
  "entrypoint": "charts",
  "notes": "Represented scalar options are a bounded source-checked selection; consult the public prop type and chart README for data, labels, callbacks and other supported props. No Cartesian combination support or consumer demonstration is implied. The categorical domain bounds identity encoding to eight entries. Controlled inspection uses row-major cell indices; the server export retains a static grid and native data table.",
  "options": [
    {
      "prop": "categorical",
      "label": "Encoding mode",
      "purpose": "Choose a single-hue numeric magnitude ramp or stable categorical identity colours.",
      "values": [
        {
          "value": false,
          "purpose": "Map finite numeric magnitudes onto the seven-step sequential ramp."
        },
        {
          "value": true,
          "purpose": "Assign stable colours to at most eight distinct categorical identities."
        }
      ],
      "applicability": "Sequential mode requires numbers or null; categorical mode accepts names or numbers within the declared identity domain.",
      "support": {
        "state": "implemented",
        "reason": "The directly imported shared chart view consumes this implemented boolean; callers still author data and accessible labels."
      }
    }
  ],
  "constraints": [
    {
      "kind": "data",
      "props": [
        "rows",
        "columns",
        "values"
      ],
      "reason": "The matrix dimensions exactly match its unique nonblank row and column labels; null is a missing value rather than numeric zero.",
      "enforcement": "runtime",
      "evidence": {
        "source": "src/charts/internal/signature-views.tsx",
        "evidence": "Heatmap requires one value per row and column."
      }
    }
  ]
}, "src/charts/Heatmap.tsx"),
  "depict.status-strip": entry(
{
  "purpose": "Show a compact chronological history of labelled states with widths proportional to their observed duration.",
  "useWhen": "Uptime or program history consists of nonoverlapping intervals within a known observation window.",
  "avoidWhen": "The task needs dependency editing or scheduling, interval bounds overlap or unobserved time would be presented as healthy operation.",
  "alternatives": "Use RangeChart for authored activity intervals, LineChart for measured numeric trends or a table for detailed incident narratives.",
  "content": "Author finite increasing bounds with ok, warn, error or unknown states; an optional full domain makes leading and trailing unknown periods explicit.",
  "anatomy": "Chronological patterned segments share a time axis, a visible status legend, interval inspection and a gap-inclusive native table.",
  "composition": "In a consumer-owned service-health block, place StatusStrip beside the observation window and the meaning of each operational state.",
  "accessibility": "Every segment is named with its state and interval; distinct patterns, visible labels, keyboard inspection and table rows supplement colour."
},
{
  "exportName": "StatusStrip",
  "entrypoint": "charts",
  "notes": "Represented scalar options are a bounded source-checked selection; consult the public prop type and chart README for data, labels, callbacks and other supported props. No Cartesian combination support or consumer demonstration is implied. No finite scalar configuration axis is represented for this interval-data component. Status keys belong to authored segment data. The server export retains the same chronological intervals, patterns and native table.",
  "options": [],
  "constraints": [
    {
      "kind": "data",
      "props": [
        "segments",
        "domain"
      ],
      "reason": "Intervals must be finite, forward and nonoverlapping inside the observation domain; uncovered intervals are derived unknown segments.",
      "enforcement": "runtime",
      "evidence": {
        "source": "src/charts/internal/signature-geometry.ts",
        "evidence": "StatusStrip intervals overlap or fall outside the domain."
      }
    }
  ]
}, "src/charts/StatusStrip.tsx"),
  "enter.resize-handle": entry({
    purpose: "Adjust the bounded size of one adjacent content pane.",
    useWhen: "A host exposes a user-adjustable inline width or block height.",
    avoidWhen: "The boundary is decorative or no dimension can actually change.",
    alternatives: "Use Separator for a static boundary; ResizablePane for a complete bounded Panel composition.",
    content: "Supply an accessible name identifying the pane being resized, with finite dimensions and a reset value.",
    anatomy: "One focusable separator, a token-bound visible edge and a minimum interactive target.",
    composition: "ResizablePane composes the handle with Panel and owns its uncontrolled or controlled size.",
    accessibility: "Arrow keys adjust, Home and End reach bounds, Enter resets, and Escape cancels an active pointer drag. Horizontal movement follows inherited or explicit RTL.",
  }, {
    exportName: "ResizeHandle", entrypoint: "components",
    notes: "Numeric dimensions, step, reset, names and callbacks are authored inputs. Pointer capture, cancellation and keyboard changes report bounded values through onChange; the Component is controlled and never stores preferences.",
    options: [{
      prop: "orientation", label: "Separator orientation", purpose: "Select the visible separator and its perpendicular movement axis.",
      values: [{ value: "vertical", purpose: "Inline width, moved horizontally with RTL reversal." }, { value: "horizontal", purpose: "Block height, moved vertically without RTL reversal." }],
      applicability: "Effective for both pointer and keyboard movement.",
      support: { state: "implemented", reason: "The component consumes orientation for semantics, visible edge and input axis." },
    }, {
      prop: "dir", label: "Explicit direction", purpose: "Override inherited direction for horizontal movement.",
      values: [{ value: "ltr", purpose: "Right increases inline width." }, { value: "rtl", purpose: "Left increases inline width." }],
      applicability: "Only horizontal movement reverses; omission follows computed or inherited direction.",
      support: { state: "implemented", reason: "The component resolves direction when handling each interaction." },
    }],
    constraints: [{
      kind: "data", props: ["value", "min", "max", "resetValue", "step"],
      reason: "All dimensions must be finite, bounds ordered and step positive; emitted values and the reset are clamped to the supplied bounds.",
      enforcement: "runtime", evidence: { source: "src/components/ResizeHandle.tsx", evidence: "![value, min, max, resetValue, step].every(Number.isFinite)" },
    }, {
      kind: "data", props: ["label"], reason: "An interactive separator requires an authored nonempty string name.",
      enforcement: "runtime", evidence: { source: "src/components/ResizeHandle.tsx", evidence: "typeof label !== \"string\" || !label.trim()" },
    }],
  }, "src/components/ResizeHandle.tsx"),
};

/** Source-checked facts, not a claim to enumerate the whole inherited API or token graph. */
export const COMPONENT_API_FACTS: Readonly<Record<string, ComponentApiFacts>> = {
  "enter.resize-handle": {
    exportName: "ResizeHandle", source: "src/components/ResizeHandle.tsx",
    options: [{
      prop: "orientation", values: ["vertical", "horizontal"],
      default: { kind: "value", value: "vertical", source: "src/components/ResizeHandle.tsx", evidence: "orientation = \"vertical\"" },
      forwarding: { source: "src/components/ResizeHandle.tsx", evidence: "aria-orientation={orientation}" },
    }, {
      prop: "dir", values: ["ltr", "rtl"], default: { kind: "omitted", reason: "Omission follows effective direction at interaction time." },
      forwarding: { source: "src/components/ResizeHandle.tsx", evidence: "dir={dir}" },
    }],
    tokens: { coverage: "partial", reason: "Representative consumed target, edge and native focus-color tokens; not an exhaustive generated utility inventory.", dependencies: [
      { property: "--ui-layout-tap-target", kind: "transitive", source: "src/components/internal/ui-vars.ts", evidence: "var(--ui-layout-tap-target, 44px)", via: [{ source: "src/components/ResizeHandle.tsx", evidence: "minWidth: UI_LAYOUT_TAP_TARGET" }] },
      { property: "--ui-border-hairline", kind: "transitive", source: "src/components/internal/ui-vars.ts", evidence: "var(--ui-border-hairline, 1px)", via: [{ source: "src/components/ResizeHandle.tsx", evidence: "borderWidth: UI_BORDER_HAIRLINE" }] },
      { property: "--color-accent", kind: "transitive", source: "styles/theme-keys.css", evidence: "--color-accent:", via: [{ source: "src/components/ResizeHandle.tsx", evidence: "focus-visible:outline-accent" }] },
    ] },
  },
  "act.button": {
    "exportName": "Button",
    "source": "src/components/Button.tsx",
    "options": [
      {
        "prop": "variant",
        "values": [
          "primary",
          "secondary",
          "ghost",
          "danger",
          "outline",
          "tonal",
          "quiet"
        ],
        "default": {
          "kind": "value",
          "value": "primary",
          "source": "src/components/Button.tsx",
          "evidence": "variant = \"primary\""
        },
        "forwarding": {
          "source": "src/components/Button.tsx",
          "evidence": "buttonClassName(variant, size, ground)"
        }
      },
      {
        "prop": "size",
        "values": [
          "sm",
          "md",
          "lg"
        ],
        "default": {
          "kind": "value",
          "value": "md",
          "source": "src/components/Button.tsx",
          "evidence": "size = \"md\""
        },
        "forwarding": {
          "source": "src/components/Button.tsx",
          "evidence": "buttonClassName(variant, size, ground)"
        }
      },
      {
        "prop": "ground",
        "values": [
          "base",
          "sunken",
          "inverse"
        ],
        "default": {
          "kind": "value",
          "value": "base",
          "source": "src/components/Button.tsx",
          "evidence": "ground = \"base\""
        },
        "forwarding": {
          "source": "src/components/Button.tsx",
          "evidence": "buttonClassName(variant, size, ground)"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/Button.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "act.icon-button": {
    "exportName": "IconButton",
    "source": "src/components/IconButton.tsx",
    "options": [
      {
        "prop": "size",
        "values": [
          "sm",
          "md"
        ],
        "default": {
          "kind": "value",
          "value": "md",
          "source": "src/components/button-classes.ts",
          "evidence": "size = \"md\""
        },
        "forwarding": {
          "source": "src/components/button-classes.ts",
          "evidence": "ICON_SIZE_CLASSES[size]"
        }
      },
      {
        "prop": "ground",
        "values": [
          "base",
          "sunken",
          "inverse"
        ],
        "default": {
          "kind": "value",
          "value": "base",
          "source": "src/components/button-classes.ts",
          "evidence": "ground = \"base\""
        },
        "forwarding": {
          "source": "src/components/button-classes.ts",
          "evidence": "ICON_GROUND_CLASSES[ground]"
        }
      },
      {
        "prop": "shape",
        "values": [
          "circle",
          "square"
        ],
        "default": {
          "kind": "value",
          "value": "circle",
          "source": "src/components/button-classes.ts",
          "evidence": "shape = \"circle\""
        },
        "forwarding": {
          "source": "src/components/button-classes.ts",
          "evidence": "ICON_SHAPE_CLASSES[shape]"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-alpha-disabled",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-alpha-disabled,",
          "via": [
            {
              "source": "src/components/IconButton.tsx",
              "evidence": "opacity: renderProps.isDisabled ? UI_ALPHA_DISABLED : undefined"
            }
          ]
        }
      ]
    }
  },
  "act.link": {
    "exportName": "Link",
    "source": "src/components/Link.tsx",
    "options": [
      {
        "prop": "variant",
        "values": [
          "default",
          "muted",
          "standalone"
        ],
        "default": {
          "kind": "value",
          "value": "default",
          "source": "src/components/Link.tsx",
          "evidence": "variant = \"default\""
        },
        "forwarding": {
          "source": "src/components/Link.tsx",
          "evidence": "VARIANT_CLASSES[variant]"
        }
      },
      {
        "prop": "buttonVariant",
        "values": [
          "primary",
          "secondary",
          "ghost",
          "danger",
          "outline",
          "tonal",
          "quiet"
        ],
        "default": {
          "kind": "conditional",
          "reason": "The default depends on another option; see the implementation notes."
        },
        "forwarding": {
          "source": "src/components/Link.tsx",
          "evidence": "buttonClassName(buttonVariant ?? \"primary\", buttonSize ?? \"md\")"
        }
      },
      {
        "prop": "buttonSize",
        "values": [
          "sm",
          "md",
          "lg"
        ],
        "default": {
          "kind": "conditional",
          "reason": "The default depends on another option; see the implementation notes."
        },
        "forwarding": {
          "source": "src/components/Link.tsx",
          "evidence": "buttonClassName(buttonVariant ?? \"primary\", buttonSize ?? \"md\")"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/Link.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "act.breadcrumb": {
    "exportName": "Breadcrumb",
    "source": "src/components/Breadcrumb.tsx",
    "options": [],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-ink-link",
          "kind": "transitive",
          "source": "styles/theme-keys.css",
          "evidence": "--color-ink-link:",
          "via": [
            {
              "source": "src/components/Breadcrumb.tsx",
              "evidence": "text-ink-link"
            }
          ]
        }
      ]
    }
  },
  "act.menu": {
    "exportName": "Menu",
    "source": "src/components/Menu.tsx",
    "options": [
      {
        "prop": "triggerAction",
        "values": [
          "press",
          "longPress",
          "contextMenu"
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Menu.tsx",
          "evidence": "trigger={triggerAction}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-elevation-floating",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-elevation-floating,",
          "via": [
            {
              "source": "src/components/Menu.tsx",
              "evidence": "boxShadow: UI_ELEVATION_FLOATING"
            }
          ]
        }
      ]
    }
  },
  "enter.text-field": {
    "exportName": "TextField",
    "source": "src/components/TextField.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/TextField.tsx",
          "evidence": "AriaTextField"
        }
      },
      {
        "prop": "isInvalid",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/TextField.tsx",
          "evidence": "<AriaTextField {...rest}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/TextField.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "enter.textarea": {
    "exportName": "Textarea",
    "source": "src/components/Textarea.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Textarea.tsx",
          "evidence": "AriaTextField"
        }
      },
      {
        "prop": "isInvalid",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Textarea.tsx",
          "evidence": "<AriaTextField {...rest}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/Textarea.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "enter.search-field": {
    "exportName": "SearchField",
    "source": "src/components/SearchField.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/SearchField.tsx",
          "evidence": "AriaSearchField"
        }
      },
      {
        "prop": "isInvalid",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/SearchField.tsx",
          "evidence": "<AriaSearchField {...rest}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/SearchField.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "enter.date-field": {
    "exportName": "DateField",
    "source": "src/components/DateField.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/DateField.tsx",
          "evidence": "AriaDateField"
        }
      },
      {
        "prop": "isInvalid",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/DateField.tsx",
          "evidence": "<AriaDateField {...rest}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/DateField.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "enter.select": {
    "exportName": "Select",
    "source": "src/components/Select.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Select.tsx",
          "evidence": "AriaSelect"
        }
      },
      {
        "prop": "isInvalid",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Select.tsx",
          "evidence": "isInvalid={isInvalid}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/Select.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "enter.combo-box": {
    "exportName": "ComboBox",
    "source": "src/components/ComboBox.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/ComboBox.tsx",
          "evidence": "AriaComboBox"
        }
      },
      {
        "prop": "isInvalid",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/ComboBox.tsx",
          "evidence": "isInvalid={isInvalid}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/ComboBox.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "enter.checkbox": {
    "exportName": "Checkbox",
    "source": "src/components/Checkbox.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Checkbox.tsx",
          "evidence": "AriaCheckbox"
        }
      },
      {
        "prop": "isSelected",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Checkbox.tsx",
          "evidence": "<AriaCheckbox\n      {...rest}"
        }
      },
      {
        "prop": "isIndeterminate",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Checkbox.tsx",
          "evidence": "renderProps.isIndeterminate"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/Checkbox.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "enter.switch": {
    "exportName": "Switch",
    "source": "src/components/Switch.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Switch.tsx",
          "evidence": "AriaSwitch"
        }
      },
      {
        "prop": "isSelected",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Switch.tsx",
          "evidence": "<AriaSwitch\n      {...rest}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/Switch.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "enter.radio-group": {
    "exportName": "RadioGroup",
    "source": "src/components/RadioGroup.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/RadioGroup.tsx",
          "evidence": "AriaRadioGroup"
        }
      },
      {
        "prop": "isInvalid",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/RadioGroup.tsx",
          "evidence": "<AriaRadioGroup {...rest}"
        }
      },
      {
        "prop": "orientation",
        "values": [
          "horizontal",
          "vertical"
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/RadioGroup.tsx",
          "evidence": "<AriaRadioGroup {...rest}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/RadioGroup.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "enter.file-trigger": {
    "exportName": "FileTrigger",
    "source": "src/components/FileTrigger.tsx",
    "options": [
      {
        "prop": "allowsMultiple",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/FileTrigger.tsx",
          "evidence": "<AriaFileTrigger {...rest}>"
        }
      },
      {
        "prop": "defaultCamera",
        "values": [
          "user",
          "environment"
        ],
        "default": {
          "kind": "omitted",
          "reason": "Omitted by default; the package supplies no selected value."
        },
        "forwarding": {
          "source": "src/components/FileTrigger.tsx",
          "evidence": "<AriaFileTrigger {...rest}>"
        }
      }
    ],
    "tokens": {
      "coverage": "none-owned",
      "reason": "FileTrigger has no styled visual surface of its own; an authored trigger can consume tokens independently.",
      "dependencies": []
    }
  },
  "enter.field": {
    "exportName": "Field",
    "source": "src/components/Field.tsx",
    "options": [
      {
        "prop": "isInvalid",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "value",
          "value": false,
          "source": "src/components/Field.tsx",
          "evidence": "isInvalid = false"
        },
        "forwarding": {
          "source": "src/components/Field.tsx",
          "evidence": "aria-invalid"
        }
      },
      {
        "prop": "isRequired",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "value",
          "value": false,
          "source": "src/components/Field.tsx",
          "evidence": "isRequired = false"
        },
        "forwarding": {
          "source": "src/components/Field.tsx",
          "evidence": "aria-required"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-ink-secondary",
          "kind": "transitive",
          "source": "styles/theme-keys.css",
          "evidence": "--color-ink-secondary:",
          "via": [
            {
              "source": "src/components/Field.tsx",
              "evidence": "text-ink-secondary"
            }
          ]
        }
      ]
    }
  },
  "inform.badge": {
    "exportName": "Badge",
    "source": "src/components/Badge.types.ts",
    "options": [
      {
        "prop": "variant",
        "values": [
          "default",
          "secondary",
          "destructive",
          "outline",
          "ghost",
          "link"
        ],
        "default": {
          "kind": "value",
          "value": "default",
          "source": "src/components/preview-runtime/components/badge/badge.tsx",
          "evidence": "variant = \"default\""
        },
        "forwarding": {
          "source": "src/components/preview-runtime/components/badge/badge.tsx",
          "evidence": "badgeVariants({ variant })"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-action",
          "kind": "transitive",
          "source": "styles/shadcn-native.css",
          "evidence": "--primary: var(--color-action)",
          "via": [
            {
              "source": "src/components/preview-runtime/components/badge/badge.tsx",
              "evidence": "default: \"cn-badge-variant-default\""
            }
          ]
        }
      ]
    }
  },
  "inform.banner": {
    "exportName": "Banner",
    "source": "src/components/Banner.tsx",
    "options": [
      {
        "prop": "variant",
        "values": [
          "info",
          "success",
          "warning",
          "danger"
        ],
        "default": {
          "kind": "value",
          "value": "info",
          "source": "src/components/Banner.tsx",
          "evidence": "variant = \"info\""
        },
        "forwarding": {
          "source": "src/components/Banner.tsx",
          "evidence": "variant === \"danger\""
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-status-danger-text",
          "kind": "transitive",
          "source": "styles/theme-keys.css",
          "evidence": "--color-status-danger-text:",
          "via": [
            {
              "source": "src/components/Banner.server.tsx",
              "evidence": "text-status-danger-text"
            }
          ]
        }
      ]
    }
  },
  "inform.chip": {
    "exportName": "Chip",
    "source": "src/components/Chip.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "value",
          "value": false,
          "source": "src/components/Chip.tsx",
          "evidence": "isDisabled = false"
        },
        "forwarding": {
          "source": "src/components/Chip.tsx",
          "evidence": "isDisabled={isDisabled}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/Chip.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "inform.status-mark": {
    "exportName": "StatusMark",
    "source": "src/components/StatusMark.tsx",
    "options": [
      {
        "prop": "tone",
        "values": [
          "success",
          "warning",
          "danger",
          "info",
          "neutral"
        ],
        "default": {
          "kind": "required",
          "reason": "Required by the prop type; no package default is supplied."
        },
        "forwarding": {
          "source": "src/components/StatusMark.tsx",
          "evidence": "SHAPES[tone]"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-status-success",
          "kind": "transitive",
          "source": "styles/theme-keys.css",
          "evidence": "--color-status-success:",
          "via": [
            {
              "source": "src/components/StatusMark.tsx",
              "evidence": "fill-status-success"
            }
          ]
        }
      ]
    }
  },
  "inform.meter": {
    "exportName": "Meter",
    "source": "src/components/Meter.tsx",
    "options": [
      {
        "prop": "tone",
        "values": [
          "success",
          "warning",
          "danger",
          "info",
          "neutral",
          "accent"
        ],
        "default": {
          "kind": "required",
          "reason": "Required by the prop type; no package default is supplied."
        },
        "forwarding": {
          "source": "src/components/Meter.server.tsx",
          "evidence": "FILL_CLASSES[tone]"
        }
      },
      {
        "prop": "direction",
        "values": [
          "max",
          "min"
        ],
        "default": {
          "kind": "value",
          "value": "max",
          "source": "src/components/Meter.server.tsx",
          "evidence": "direction = \"max\""
        },
        "forwarding": {
          "source": "src/components/Meter.server.tsx",
          "evidence": "direction === \"max\""
        }
      },
      {
        "prop": "emphasis",
        "values": [
          "default",
          "figure"
        ],
        "default": {
          "kind": "value",
          "value": "default",
          "source": "src/components/Meter.tsx",
          "evidence": "emphasis = \"default\""
        },
        "forwarding": {
          "source": "src/components/Meter.tsx",
          "evidence": "VALUE_ROW_CLASSES[emphasis]"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-border-rule",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-border-rule,",
          "via": [
            {
              "source": "src/components/Meter.server.tsx",
              "evidence": "inset 0 0 0 ${UI_BORDER_RULE} currentColor"
            }
          ]
        }
      ]
    }
  },
  "inform.progress-bar": {
    "exportName": "ProgressBar",
    "source": "src/components/ProgressBar.tsx",
    "options": [
      {
        "prop": "isIndeterminate",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/ProgressBar.tsx",
          "evidence": "<AriaProgressBar {...rest}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-accent",
          "kind": "transitive",
          "source": "styles/theme-keys.css",
          "evidence": "--color-accent:",
          "via": [
            {
              "source": "src/components/ProgressBar.tsx",
              "evidence": "bg-accent"
            }
          ]
        }
      ]
    }
  },
  "inform.spinner": {
    "exportName": "Spinner",
    "source": "src/components/Spinner.tsx",
    "options": [
      {
        "prop": "size",
        "values": [
          "sm",
          "md",
          "lg"
        ],
        "default": {
          "kind": "value",
          "value": "md",
          "source": "src/components/Spinner.tsx",
          "evidence": "size = \"md\""
        },
        "forwarding": {
          "source": "src/components/Spinner.server.tsx",
          "evidence": "SIZE_CLASSES[size]"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-ink-secondary",
          "kind": "transitive",
          "source": "styles/theme-keys.css",
          "evidence": "--color-ink-secondary:",
          "via": [
            {
              "source": "src/components/Spinner.tsx",
              "evidence": "text-ink-secondary"
            }
          ]
        }
      ]
    }
  },
  "inform.skeleton": {
    "exportName": "Skeleton",
    "source": "src/components/Skeleton.tsx",
    "options": [
      {
        "prop": "shape",
        "values": [
          "text",
          "block",
          "circle"
        ],
        "default": {
          "kind": "value",
          "value": "text",
          "source": "src/components/Skeleton.tsx",
          "evidence": "shape = \"text\""
        },
        "forwarding": {
          "source": "src/components/Skeleton.tsx",
          "evidence": "SHAPE_CLASSES[shape]"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-skeleton-fill",
          "kind": "transitive",
          "source": "styles/theme-keys.css",
          "evidence": "--color-skeleton-fill:",
          "via": [
            {
              "source": "src/components/Skeleton.tsx",
              "evidence": "bg-skeleton-fill"
            }
          ]
        }
      ]
    }
  },
  "group.card": {
    "exportName": "Card",
    "source": "src/components/Card.tsx",
    "options": [
      {
        "prop": "ground",
        "values": [
          "base",
          "sunken",
          "inverse"
        ],
        "default": {
          "kind": "value",
          "value": "base",
          "source": "src/components/Card.tsx",
          "evidence": "ground = \"base\""
        },
        "forwarding": {
          "source": "src/components/Card.tsx",
          "evidence": "PLATE_CLASSES[ground]"
        }
      },
      {
        "prop": "variant",
        "values": [
          "raised",
          "plate",
          "outline"
        ],
        "default": {
          "kind": "value",
          "value": "raised",
          "source": "src/components/Card.tsx",
          "evidence": "variant = \"raised\""
        },
        "forwarding": {
          "source": "src/components/Card.tsx",
          "evidence": "variant === \"plate\""
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-border-panel",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-border-panel,",
          "via": [
            {
              "source": "src/components/Card.tsx",
              "evidence": "borderWidth: UI_BORDER_PANEL"
            }
          ]
        }
      ]
    }
  },
  "group.grid-list": {
    exportName: "GridList", source: "src/components/GridList.tsx", options: [],
    tokens: {
      coverage: "partial", reason: "Representative row state dependencies; checkbox styling is composed from the existing component.",
      dependencies: [
        { property: "--ui-layout-tap-target", kind: "transitive", source: "src/components/internal/ui-vars.ts", evidence: "--ui-layout-tap-target", via: [{ source: "src/components/GridList.tsx", evidence: "minBlockSize: UI_LAYOUT_TAP_TARGET" }] },
        { property: "--ui-ring-focus", kind: "transitive", source: "src/components/internal/ui-vars.ts", evidence: "--ui-ring-focus", via: [{ source: "src/components/GridList.tsx", evidence: "UI_RING_FOCUS" }] }
      ]
    }
  },
  "group.table": {
    "exportName": "Table",
    "source": "src/components/Table.tsx",
    "options": [
      {
        "prop": "selectionMode",
        "values": [
          "none",
          "single",
          "multiple"
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Table.tsx",
          "evidence": "<AriaTable\n      {...rest}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/Table.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "group.separator": {
    "exportName": "Separator",
    "source": "src/components/Separator.types.ts",
    "options": [
      {
        "prop": "orientation",
        "values": [
          "horizontal",
          "vertical"
        ],
        "default": {
          "kind": "value",
          "value": "horizontal",
          "source": "src/components/preview-runtime/components/separator/separator.tsx",
          "evidence": "orientation = \"horizontal\""
        },
        "forwarding": {
          "source": "src/components/preview-runtime/components/separator/separator.tsx",
          "evidence": "orientation={orientation}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-line-base",
          "kind": "transitive",
          "source": "styles/shadcn-native.css",
          "evidence": "--border: var(--color-line-base)",
          "via": [
            {
              "source": "src/components/preview-runtime/components/separator/separator.tsx",
              "evidence": "bg-border"
            }
          ]
        }
      ]
    }
  },
  "depict.logomark": {
    exportName: "Logomark", source: "src/components/Logomark.tsx",
    options: [
      { prop: "size", values: ["sm", "md", "lg"], default: { kind: "required", reason: "The caller selects the required height scale." }, forwarding: { source: "src/components/Logomark.tsx", evidence: "HEIGHTS[size]" } },
      { prop: "tone", values: ["auto", "inverse"], default: { kind: "value", value: "auto", source: "src/components/Logomark.tsx", evidence: 'tone = "auto"' }, forwarding: { source: "src/components/Logomark.tsx", evidence: 'tone === "inverse"' } },
      { prop: "plate", values: ["shared", "self"], default: { kind: "value", value: "self", source: "src/components/Logomark.tsx", evidence: 'plate = "self"' }, forwarding: { source: "src/components/Logomark.tsx", evidence: 'plate !== "shared"' } },
    ],
    tokens: { coverage: "partial", reason: "The height binding is representative; plate ink uses the existing primary or inverse ink utilities.", dependencies: [
      { property: "--ui-brandmark-height-md", kind: "transitive", source: "src/internal/brandmark.ts", evidence: '"var(--ui-brandmark-height-md, 36px)"', via: [{ source: "src/components/Logomark.tsx", evidence: "HEIGHTS[size]" }] },
    ] },
  },
  "depict.avatar": {
    "exportName": "Avatar",
    "source": "src/components/Avatar.tsx",
    "options": [
      {
        "prop": "size",
        "values": [
          "sm",
          "md",
          "lg"
        ],
        "default": {
          "kind": "value",
          "value": "md",
          "source": "src/components/Avatar.tsx",
          "evidence": "size = \"md\""
        },
        "forwarding": {
          "source": "src/components/Avatar.tsx",
          "evidence": "AVATAR_SIZE_CLASSES[size]"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-surface-sunken",
          "kind": "transitive",
          "source": "styles/theme-keys.css",
          "evidence": "--color-surface-sunken:",
          "via": [
            {
              "source": "src/components/Avatar.tsx",
              "evidence": "AVATAR_BASE_CLASSES"
            },
            {
              "source": "src/components/Avatar.server.tsx",
              "evidence": "bg-surface-sunken"
            }
          ]
        }
      ]
    }
  },
  "depict.icon": {
    "exportName": "Icon",
    "source": "src/components/Icon.tsx",
    "options": [
      {
        "prop": "size",
        "values": [
          "sm",
          "md",
          "lg"
        ],
        "default": {
          "kind": "value",
          "value": "md",
          "source": "src/components/Icon.tsx",
          "evidence": "size = \"md\""
        },
        "forwarding": {
          "source": "src/components/Icon.tsx",
          "evidence": "SIZE_VARS[size]"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-icon-stroke",
          "kind": "direct",
          "source": "src/components/Icon.tsx",
          "evidence": "var(--ui-icon-stroke, 2)",
          "via": []
        }
      ]
    }
  },
  "reveal.dialog": {
    "exportName": "Dialog",
    "source": "src/components/Dialog.tsx",
    "options": [
      {
        "prop": "size",
        "values": [
          "sm",
          "md",
          "lg"
        ],
        "default": {
          "kind": "value",
          "value": "md",
          "source": "src/components/Dialog.tsx",
          "evidence": "size = \"md\""
        },
        "forwarding": {
          "source": "src/components/Dialog.tsx",
          "evidence": "SIZE_CLASSES[size]"
        }
      },
      {
        "prop": "isDismissable",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "value",
          "value": true,
          "source": "src/components/Dialog.tsx",
          "evidence": "isDismissable = true"
        },
        "forwarding": {
          "source": "src/components/Dialog.tsx",
          "evidence": "isDismissable={isDismissable}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-elevation-floating",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-elevation-floating,",
          "via": [
            {
              "source": "src/components/Dialog.tsx",
              "evidence": "boxShadow: UI_ELEVATION_FLOATING"
            }
          ]
        }
      ]
    }
  },
  "reveal.popover": {
    "exportName": "Popover",
    "source": "src/components/Popover.tsx",
    "options": [],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-elevation-floating",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-elevation-floating,",
          "via": [
            {
              "source": "src/components/Popover.tsx",
              "evidence": "boxShadow: UI_ELEVATION_FLOATING"
            }
          ]
        }
      ]
    }
  },
  "reveal.tooltip": {
    "exportName": "Tooltip",
    "source": "src/components/Tooltip.tsx",
    "options": [
      {
        "prop": "triggerAction",
        "values": [
          "hover",
          "focus"
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Tooltip.tsx",
          "evidence": "trigger={triggerAction}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-elevation-floating",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-elevation-floating,",
          "via": [
            {
              "source": "src/components/Tooltip.tsx",
              "evidence": "boxShadow: UI_ELEVATION_FLOATING"
            }
          ]
        }
      ]
    }
  },
  "reveal.disclosure": {
    "exportName": "Disclosure",
    "source": "src/components/Disclosure.tsx",
    "options": [],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-ink-primary",
          "kind": "transitive",
          "source": "styles/theme-keys.css",
          "evidence": "--color-ink-primary:",
          "via": [
            {
              "source": "src/components/Disclosure.tsx",
              "evidence": "text-ink-primary"
            }
          ]
        }
      ]
    }
  },
  "reveal.tabs": {
    "exportName": "Tabs",
    "source": "src/components/Tabs.tsx",
    "options": [
      {
        "prop": "isDisabled",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Tabs.tsx",
          "evidence": "AriaTabs"
        }
      },
      {
        "prop": "orientation",
        "values": [
          "horizontal",
          "vertical"
        ],
        "default": {
          "kind": "peer",
          "reason": "No local initializer; any inherited default belongs to the installed peer."
        },
        "forwarding": {
          "source": "src/components/Tabs.tsx",
          "evidence": "<AriaTabs {...rest}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-ring-focus",
          "kind": "transitive",
          "source": "src/components/internal/ui-vars.ts",
          "evidence": "var(--ui-ring-focus,",
          "via": [
            {
              "source": "src/components/Tabs.tsx",
              "evidence": "boxShadow: renderProps.isFocusVisible ? UI_RING_FOCUS : undefined"
            }
          ]
        }
      ]
    }
  },
  "depict.bar-chart": {
    "exportName": "BarChart",
    "source": "src/charts/BarChart.tsx",
    "options": [
      {
        "prop": "fit",
        "values": [
          "fixed",
          "fluid"
        ],
        "default": {
          "kind": "value",
          "value": "fixed",
          "source": "src/charts/BarChart.tsx",
          "evidence": "fit = \"fixed\""
        },
        "forwarding": {
          "source": "src/charts/BarChart.tsx",
          "evidence": "fit={fit}"
        }
      },
      {
        "prop": "marks",
        "values": [
          "interactive",
          "static"
        ],
        "default": {
          "kind": "value",
          "value": "interactive",
          "source": "src/charts/BarChart.tsx",
          "evidence": "marks = \"interactive\""
        },
        "forwarding": {
          "source": "src/charts/BarChart.tsx",
          "evidence": "marks === \"interactive\""
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-border-hairline",
          "kind": "transitive",
          "source": "src/charts/internal/marks.ts",
          "evidence": "var(--ui-border-hairline,",
          "via": [
            {
              "source": "src/charts/BarChart.tsx",
              "evidence": "tokenMarks ? CHART_HAIRLINE : 1"
            }
          ]
        }
      ]
    }
  },
  "depict.line-chart": {
    "exportName": "LineChart",
    "source": "src/charts/LineChart.tsx",
    "options": [],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-chart-grid",
          "kind": "transitive",
          "source": "src/charts/internal/chart-vars.ts",
          "evidence": "var(--color-chart-grid,",
          "via": [
            {
              "source": "src/charts/LineChart.tsx",
              "evidence": "stroke={CHART_GRID}"
            }
          ]
        }
      ]
    }
  },
  "depict.sparkline": {
    "exportName": "Sparkline",
    "source": "src/charts/Sparkline.tsx",
    "options": [],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--color-chart-categorical-1",
          "kind": "transitive",
          "source": "src/charts/internal/chart-vars.ts",
          "evidence": "TOKENS[\"--color-chart-categorical-1\"]!.value",
          "via": [
            {
              "source": "src/charts/Sparkline.tsx",
              "evidence": "color ?? assignCategoricalColor(0)"
            }
          ]
        }
      ]
    }
  },
  "depict.waterfall-chart": {
    "exportName": "WaterfallChart",
    "source": "src/charts/WaterfallChart.tsx",
    "options": [
      {
        "prop": "fit",
        "values": [
          "fixed",
          "fluid"
        ],
        "default": {
          "kind": "value",
          "value": "fluid",
          "source": "src/charts/WaterfallChart.tsx",
          "evidence": "fit = \"fluid\""
        },
        "forwarding": {
          "source": "src/charts/WaterfallChart.tsx",
          "evidence": "fit={fit}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-border-hairline",
          "kind": "transitive",
          "source": "src/charts/internal/marks.ts",
          "evidence": "var(--ui-border-hairline,",
          "via": [
            {
              "source": "src/charts/WaterfallChart.tsx",
              "evidence": "strokeWidth={CHART_HAIRLINE}"
            }
          ]
        }
      ]
    }
  },
  "depict.range-chart": {
    "exportName": "RangeChart",
    "source": "src/charts/RangeChart.tsx",
    "options": [
      {
        "prop": "fit",
        "values": [
          "fixed",
          "fluid"
        ],
        "default": {
          "kind": "value",
          "value": "fluid",
          "source": "src/charts/RangeChart.tsx",
          "evidence": "fit = \"fluid\""
        },
        "forwarding": {
          "source": "src/charts/RangeChart.tsx",
          "evidence": "fit={fit}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-border-hairline",
          "kind": "transitive",
          "source": "src/charts/internal/marks.ts",
          "evidence": "var(--ui-border-hairline,",
          "via": [
            {
              "source": "src/charts/RangeChart.tsx",
              "evidence": "strokeWidth={CHART_HAIRLINE}"
            }
          ]
        }
      ]
    }
  },
  "depict.scatter-chart": {
    "exportName": "ScatterChart",
    "source": "src/charts/ScatterChart.tsx",
    "options": [
      {
        "prop": "fit",
        "values": [
          "fixed",
          "fluid"
        ],
        "default": {
          "kind": "value",
          "value": "fluid",
          "source": "src/charts/ScatterChart.tsx",
          "evidence": "fit = \"fluid\""
        },
        "forwarding": {
          "source": "src/charts/ScatterChart.tsx",
          "evidence": "fit={fit}"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "Representative consumed dependencies only; this is not an exhaustive token or generated utility inventory.",
      "dependencies": [
        {
          "property": "--ui-border-hairline",
          "kind": "transitive",
          "source": "src/charts/internal/marks.ts",
          "evidence": "var(--ui-border-hairline,",
          "via": [
            {
              "source": "src/charts/ScatterChart.tsx",
              "evidence": "strokeWidth={CHART_HAIRLINE}"
            }
          ]
        }
      ]
    }
  },
  "depict.area-chart": {
    "exportName": "AreaChart",
    "source": "src/charts/AreaChart.tsx",
    "options": [
      {
        "prop": "normalized",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "value",
          "value": false,
          "source": "src/charts/internal/signature-views.tsx",
          "evidence": "normalized = false"
        },
        "forwarding": {
          "source": "src/charts/internal/signature-views.tsx",
          "evidence": "normalized = false"
        }
      },
      {
        "prop": "smooth",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "value",
          "value": false,
          "source": "src/charts/internal/signature-views.tsx",
          "evidence": "smooth = false"
        },
        "forwarding": {
          "source": "src/charts/internal/signature-views.tsx",
          "evidence": "smooth = false"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "One representative chart colour binding is recorded with its actual helper and view consumption; this is not an exhaustive token inventory.",
      "dependencies": [
        {
          "property": "--color-chart-categorical-1",
          "kind": "transitive",
          "source": "src/charts/internal/chart-vars.ts",
          "evidence": "TOKENS[\"--color-chart-categorical-1\"]",
          "via": [
            {
              "source": "src/charts/internal/signature-views.tsx",
              "evidence": "fill={resolveSeriesColor("
            },
            {
              "source": "src/charts/AreaChart.tsx",
              "evidence": "<AreaView"
            }
          ]
        }
      ]
    }
  },
  "depict.heatmap": {
    "exportName": "Heatmap",
    "source": "src/charts/Heatmap.tsx",
    "options": [
      {
        "prop": "categorical",
        "values": [
          false,
          true
        ],
        "default": {
          "kind": "value",
          "value": false,
          "source": "src/charts/internal/signature-views.tsx",
          "evidence": "categorical = false"
        },
        "forwarding": {
          "source": "src/charts/internal/signature-views.tsx",
          "evidence": "categorical = false"
        }
      }
    ],
    "tokens": {
      "coverage": "partial",
      "reason": "One representative chart colour binding is recorded with its actual helper and view consumption; this is not an exhaustive token inventory.",
      "dependencies": [
        {
          "property": "--color-chart-sequential-100",
          "kind": "transitive",
          "source": "src/charts/internal/chart-vars.ts",
          "evidence": "TOKENS[\"--color-chart-sequential-100\"]",
          "via": [
            {
              "source": "src/charts/internal/signature-views.tsx",
              "evidence": "chartSequentialVar("
            },
            {
              "source": "src/charts/Heatmap.tsx",
              "evidence": "<HeatmapView"
            }
          ]
        }
      ]
    }
  },
  "depict.status-strip": {
    "exportName": "StatusStrip",
    "source": "src/charts/StatusStrip.tsx",
    "options": [],
    "tokens": {
      "coverage": "partial",
      "reason": "One representative chart colour binding is recorded with its actual helper and view consumption; this is not an exhaustive token inventory.",
      "dependencies": [
        {
          "property": "--color-chart-categorical-1",
          "kind": "transitive",
          "source": "src/charts/internal/chart-vars.ts",
          "evidence": "TOKENS[\"--color-chart-categorical-1\"]",
          "via": [
            {
              "source": "src/charts/internal/signature-views.tsx",
              "evidence": "fill={assignCategoricalColor(index)}"
            },
            {
              "source": "src/charts/StatusStrip.tsx",
              "evidence": "<StatusView"
            }
          ]
        }
      ]
    }
  }
};


/** Preferred finite axes; evaluate constraints with complete consumer-authored props. */
export interface ComponentComparison {
  readonly columns: { readonly option: string; readonly values: readonly ComponentScalar[] };
  readonly rows?: ComponentComparison["columns"];
  /** Conservative bound including cells the constraint policy may skip. */
  readonly maxCells: number;
  /** Original rule array, shared by identity with COMPONENT_GUIDANCE. */
  readonly constraints: readonly ComponentConstraint[];
  /** Only requires/exclusive/paired can skip; applicability, derived and data rules cannot. */
  readonly constraintPolicy: "skip-violations";
}

function comparison(id: string, column: string, row?: string): ComponentComparison {
  const api = COMPONENT_API_FACTS[id];
  const constraints = COMPONENT_GUIDANCE[id]?.media.web.implementation?.constraints;
  if (!api || !constraints) throw new Error(`Unknown comparison component: ${id}`);
  const axis = (option: string): ComponentComparison["columns"] => {
    const fact = api.options.find(candidate => candidate.prop === option);
    if (!fact) throw new Error(`Unknown finite comparison option: ${id}.${option}`);
    return Object.freeze({ option, values: Object.freeze([...fact.values]) });
  };
  const columns = axis(column);
  const rows = row === undefined ? undefined : axis(row);
  // Freeze only new containers: existing guidance and rule descriptors stay intact.
  return Object.freeze({
    columns,
    ...(rows ? { rows } : {}),
    maxCells: columns.values.length * (rows?.values.length ?? 1),
    constraints,
    constraintPolicy: "skip-violations",
  });
}

/** Data only: absence means no represented finite comparison; this renders nothing. */
export const COMPONENT_COMPARISON = Object.freeze({
  "act.button": comparison("act.button", "variant", "size"),
  "act.icon-button": comparison("act.icon-button", "shape", "size"),
  "act.link": comparison("act.link", "variant"),
  "act.menu": comparison("act.menu", "triggerAction"),
  "enter.text-field": comparison("enter.text-field", "isInvalid", "isDisabled"),
  "enter.textarea": comparison("enter.textarea", "isInvalid", "isDisabled"),
  "enter.search-field": comparison("enter.search-field", "isInvalid", "isDisabled"),
  "enter.date-field": comparison("enter.date-field", "isInvalid", "isDisabled"),
  "enter.select": comparison("enter.select", "isInvalid", "isDisabled"),
  "enter.combo-box": comparison("enter.combo-box", "isInvalid", "isDisabled"),
  "enter.checkbox": comparison("enter.checkbox", "isSelected", "isDisabled"),
  "enter.switch": comparison("enter.switch", "isSelected", "isDisabled"),
  "enter.radio-group": comparison("enter.radio-group", "orientation", "isDisabled"),
  "enter.file-trigger": comparison("enter.file-trigger", "allowsMultiple", "defaultCamera"),
  "enter.field": comparison("enter.field", "isRequired", "isInvalid"),
  "enter.resize-handle": comparison("enter.resize-handle", "orientation", "dir"),
  "inform.badge": comparison("inform.badge", "variant"),
  "inform.banner": comparison("inform.banner", "variant"),
  "inform.chip": comparison("inform.chip", "isDisabled"),
  "inform.status-mark": comparison("inform.status-mark", "tone"),
  "inform.meter": comparison("inform.meter", "tone", "emphasis"),
  "inform.progress-bar": comparison("inform.progress-bar", "isIndeterminate"),
  "inform.spinner": comparison("inform.spinner", "size"),
  "inform.skeleton": comparison("inform.skeleton", "shape"),
  "group.card": comparison("group.card", "variant"),
  "group.table": comparison("group.table", "selectionMode"),
  "group.separator": comparison("group.separator", "orientation"),
  "depict.avatar": comparison("depict.avatar", "size"),
  "depict.icon": comparison("depict.icon", "size"),
  "depict.logomark": comparison("depict.logomark", "plate", "size"),
  "reveal.dialog": comparison("reveal.dialog", "size", "isDismissable"),
  "reveal.tooltip": comparison("reveal.tooltip", "triggerAction"),
  "reveal.tabs": comparison("reveal.tabs", "orientation", "isDisabled"),
  "depict.bar-chart": comparison("depict.bar-chart", "fit", "marks"),
  "depict.waterfall-chart": comparison("depict.waterfall-chart", "fit"),
  "depict.range-chart": comparison("depict.range-chart", "fit"),
  "depict.scatter-chart": comparison("depict.scatter-chart", "fit"),
  "depict.area-chart": comparison("depict.area-chart", "normalized", "smooth"),
  "depict.heatmap": comparison("depict.heatmap", "categorical"),
});
