import type { SectionedViewSection } from '../../core/sectioned-view.js';
import type { CatalogFixture } from './types.js';

export const SAY_FIXTURES = [
{
    "id": "say-hero-display" as const,
    "fn": "Say",
    "axis": "role",
    "value": "hero-display",
    "caption": "Display hero with paired actions",
    "section": {
        "id": "say-hero-display",
        "kind": "hero",
        "ground": "base",
        "heading": {
            "id": "catalog.sample.other.hero.heading"
        },
        "size": "display",
        "actions": [
            {
                "id": "primary",
                "label": {
                    "id": "catalog.sample.example.hero.primary"
                },
                "href": "/sample",
                "emphasis": "primary"
            },
            {
                "id": "secondary",
                "label": {
                    "id": "catalog.sample.example.hero.secondary"
                },
                "href": "/sample-note",
                "emphasis": "secondary"
            }
        ]
    } satisfies SectionedViewSection
},
{
    "id": "say-hero-compact" as const,
    "fn": "Say",
    "axis": "role",
    "value": "hero-compact",
    "caption": "Compact hero",
    "section": {
        "id": "say-hero-compact",
        "kind": "hero",
        "ground": "base",
        "heading": {
            "id": "catalog.sample.other.hero.heading"
        },
        "size": "compact"
    } satisfies SectionedViewSection
},
{
    "id": "say-intro" as const,
    "fn": "Say",
    "axis": "role",
    "value": "intro",
    "caption": "Standard intro with supporting copy and text-only footnote",
    "section": {
        "id": "say-intro",
        "kind": "content-section",
        "ground": "base",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.say-heading.heading"
        },
        "description": {
            "id": "catalog.sample.say-heading.description"
        },
        "eyebrow": {
            "id": "catalog.sample.example.say.eyebrow"
        },
        "footnote": {
            "text": {
                "id": "catalog.sample.say-footnote.text"
            }
        }
    } satisfies SectionedViewSection
},
{
    "id": "say-close" as const,
    "fn": "Say",
    "axis": "role",
    "value": "close",
    "caption": "Display close on inverse ground",
    "section": {
        "id": "say-close",
        "kind": "content-section",
        "ground": "inverse",
        "size": "display",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.say-actions.heading"
        },
        "actions": [
            {
                "id": "start",
                "label": {
                    "id": "catalog.sample.say-actions.action"
                },
                "href": "/sample",
                "emphasis": "primary"
            }
        ]
    } satisfies SectionedViewSection
},
{
    "id": "say-media-stacked" as const,
    "fn": "Say",
    "axis": "role",
    "value": "media-stacked",
    "caption": "Say beside one stacked specimen",
    "section": {
        "id": "say-media-stacked",
        "kind": "content-section",
        "ground": "base",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.media-specimen.heading"
        },
        "media": {
            "type": "specimen",
            "label": {
                "id": "catalog.sample.media-specimen.label"
            },
            "panel": {
                "id": "specimen-panel",
                "title": {
                    "id": "catalog.sample.specimen-panel.title"
                },
                "parts": [
                    {
                        "id": "specimen-fields",
                        "type": "fields",
                        "label": {
                            "id": "catalog.sample.specimen-fields.label"
                        },
                        "items": [
                            {
                                "id": "specimen-fields-row",
                                "label": {
                                    "id": "catalog.sample.specimen-fields.row.label"
                                },
                                "value": {
                                    "id": "catalog.sample.specimen-fields.row.value"
                                }
                            }
                        ]
                    },
                    {
                        "id": "specimen-status",
                        "type": "status-rows",
                        "label": {
                            "id": "catalog.sample.specimen-status.label"
                        },
                        "mobileRows": 3,
                        "items": [
                            {
                                "id": "status-neutral",
                                "label": {
                                    "id": "catalog.sample.status.neutral.label"
                                },
                                "status": {
                                    "tone": "neutral",
                                    "label": {
                                        "id": "catalog.sample.status.neutral.status"
                                    }
                                }
                            },
                            {
                                "id": "status-success",
                                "label": {
                                    "id": "catalog.sample.status.success.label"
                                },
                                "status": {
                                    "tone": "success",
                                    "label": {
                                        "id": "catalog.sample.status.success.status"
                                    }
                                }
                            },
                            {
                                "id": "status-warning",
                                "label": {
                                    "id": "catalog.sample.status.warning.label"
                                },
                                "status": {
                                    "tone": "warning",
                                    "label": {
                                        "id": "catalog.sample.status.warning.status"
                                    }
                                }
                            },
                            {
                                "id": "status-danger",
                                "label": {
                                    "id": "catalog.sample.status.danger.label"
                                },
                                "status": {
                                    "tone": "danger",
                                    "label": {
                                        "id": "catalog.sample.status.danger.status"
                                    }
                                }
                            },
                            {
                                "id": "status-info",
                                "label": {
                                    "id": "catalog.sample.status.info.label"
                                },
                                "status": {
                                    "tone": "info",
                                    "label": {
                                        "id": "catalog.sample.status.info.status"
                                    }
                                }
                            }
                        ]
                    },
                    {
                        "id": "specimen-meter",
                        "type": "meter",
                        "label": {
                            "id": "catalog.sample.meter.label"
                        },
                        "value": 40,
                        "scaleMax": 100,
                        "limit": 80,
                        "direction": "max",
                        "tone": "info",
                        "valueText": {
                            "id": "catalog.sample.meter.value"
                        },
                        "limitText": {
                            "id": "catalog.sample.meter.limit"
                        }
                    }
                ],
                "meta": {
                    "id": "catalog.sample.panel.meta"
                }
            }
        }
    } satisfies SectionedViewSection
},
{
    "id": "say-header-split" as const,
    "fn": "Say",
    "axis": "role",
    "value": "header-split",
    "caption": "Header-only split with secondary action",
    "section": {
        "id": "say-header-split",
        "kind": "content-section",
        "ground": "base",
        "size": "standard",
        "layout": "split-start",
        "heading": {
            "id": "catalog.sample.say-heading.heading"
        },
        "description": {
            "id": "catalog.sample.say-heading.description"
        },
        "actions": [
            {
                "id": "secondary",
                "label": {
                    "id": "catalog.sample.example.action.secondary"
                },
                "href": "/sample-note",
                "emphasis": "secondary"
            }
        ]
    } satisfies SectionedViewSection
},
] satisfies CatalogFixture[];
