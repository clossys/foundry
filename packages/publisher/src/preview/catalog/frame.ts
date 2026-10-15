import type { SectionedViewSection } from '../../core/sectioned-view.js';
import type { CatalogFixture } from './types.js';

export const FRAME_FIXTURES = [
{
    "id": "frame-ground-base" as const,
    "fn": "Frame",
    "axis": "ground",
    "value": "base",
    "caption": "Ground base",
    "section": {
        "id": "frame-ground-base",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.frame-standard.heading"
        },
    } satisfies SectionedViewSection
},
{
    "id": "frame-ground-sunken" as const,
    "fn": "Frame",
    "axis": "ground",
    "value": "sunken",
    "caption": "Ground sunken",
    "section": {
        "id": "frame-ground-sunken",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.frame-standard.heading"
        },
    } satisfies SectionedViewSection
},
{
    "id": "frame-ground-inverse" as const,
    "fn": "Frame",
    "axis": "ground",
    "value": "inverse",
    "caption": "Ground inverse",
    "section": {
        "id": "frame-ground-inverse",
        "kind": "content-section",
        "ground": "inverse",
        "size": "display",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.frame-display.heading"
        },
    } satisfies SectionedViewSection
},
{
    "id": "frame-size-standard" as const,
    "fn": "Frame",
    "axis": "size",
    "value": "standard",
    "caption": "Standard frame",
    "section": {
        "id": "frame-size-standard",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.frame-size-standard.heading"
        },
    } satisfies SectionedViewSection
},
{
    "id": "frame-split-start" as const,
    "fn": "Frame",
    "axis": "layout",
    "value": "split-start",
    "caption": "Visual at start",
    "section": {
        "id": "frame-split-start",
        "kind": "content-section",
        "size": "standard",
        "layout": "split-start",
        "heading": {
            "id": "catalog.sample.frame-split-start.heading"
        },
        "media": {
            "type": "specimen",
            "label": {
                "id": "catalog.sample.media-key-below.label"
            },
            "panel": {
                "id": "key-below-panel",
                "title": {
                    "id": "catalog.sample.key-below-panel.title"
                },
                "parts": [
                    {
                        "id": "key-files",
                        "type": "files",
                        "label": {
                            "id": "catalog.sample.files.label"
                        },
                        "items": [
                            {
                                "id": "sample-file",
                                "format": {
                                    "id": "catalog.sample.files.format"
                                },
                                "name": {
                                    "id": "catalog.sample.files.name"
                                },
                                "source": {
                                    "id": "catalog.sample.files.source"
                                }
                            }
                        ]
                    }
                ],
                "footer": {
                    "note": {
                        "id": "catalog.sample.key.below.footer"
                    }
                }
            },
            "key": {
                "label": {
                    "id": "catalog.sample.key.below.label"
                },
                "items": [
                    {
                        "id": "below-key-0",
                        "target": "header",
                        "heading": {
                            "id": "catalog.sample.key.below.heading0"
                        },
                        "description": {
                            "id": "catalog.sample.key.below.description0"
                        }
                    },
                    {
                        "id": "below-key-1",
                        "target": "key-files",
                        "heading": {
                            "id": "catalog.sample.key.below.heading1"
                        },
                        "description": {
                            "id": "catalog.sample.key.below.description1"
                        }
                    },
                    {
                        "id": "below-key-2",
                        "target": "footer",
                        "heading": {
                            "id": "catalog.sample.key.below.heading2"
                        },
                        "description": {
                            "id": "catalog.sample.key.below.description2"
                        }
                    }
                ]
            }
        },
        "actions": [
            {
                "id": "sample",
                "label": {
                    "id": "catalog.sample.split-start.action"
                },
                "href": "/sample-split",
                "emphasis": "tertiary"
            }
        ]
    } satisfies SectionedViewSection
},
{
    "id": "frame-split-end" as const,
    "fn": "Frame",
    "axis": "layout",
    "value": "split-end",
    "caption": "Block at end",
    "section": {
        "id": "frame-split-end",
        "kind": "content-section",
        "size": "standard",
        "layout": "split-end",
        "heading": {
            "id": "catalog.sample.frame-split-end.heading"
        },
        "block": {
            "type": "items",
            "arrangement": "rows",
            "items": [
                {
                    "id": "split-end-item-1",
                    "heading": {
                        "id": "catalog.sample.split-end.0.heading"
                    }
                },
                {
                    "id": "split-end-item-2",
                    "heading": {
                        "id": "catalog.sample.split-end.1.heading"
                    }
                }
            ]
        },
        "actions": [
            {
                "id": "sample",
                "label": {
                    "id": "catalog.sample.split-end.action"
                },
                "href": "/sample-split-end",
                "emphasis": "quiet"
            }
        ]
    } satisfies SectionedViewSection
},
{
    "id": "frame-stacked" as const,
    "fn": "Frame",
    "axis": "layout",
    "value": "stacked",
    "caption": "Stacked frame",
    "section": {
        "id": "frame-stacked",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.frame-standard.heading"
        },
    } satisfies SectionedViewSection
},
{
    "id": "frame-actions" as const,
    "fn": "Frame",
    "axis": "actions",
    "value": [
        "primary",
        "tertiary"
    ],
    "caption": "Two actions share one frame size; link-only footnote",
    "section": {
        "id": "frame-actions",
        "kind": "content-section",
        "size": "display",
        "layout": "split-end",
        "heading": {
            "id": "catalog.sample.frame-split-end.heading"
        },
        "block": {
            "type": "items",
            "arrangement": "rows",
            "items": [
                {
                    "id": "split-end-item-1",
                    "heading": {
                        "id": "catalog.sample.split-end.0.heading"
                    }
                },
                {
                    "id": "split-end-item-2",
                    "heading": {
                        "id": "catalog.sample.split-end.1.heading"
                    }
                }
            ]
        },
        "actions": [
            {
                "id": "primary",
                "label": {
                    "id": "catalog.sample.example.action.primary"
                },
                "href": "/sample",
                "emphasis": "primary"
            },
            {
                "id": "tertiary",
                "label": {
                    "id": "catalog.sample.example.action.tertiary"
                },
                "href": "/sample-note",
                "emphasis": "tertiary"
            }
        ],
        "footnote": {
            "link": {
                "label": {
                    "id": "catalog.sample.example.footnote.link"
                },
                "href": "/sample-note"
            }
        }
    } satisfies SectionedViewSection
},
] satisfies CatalogFixture[];
