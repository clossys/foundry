import type { SectionedViewSection } from '../../core/sectioned-view.js';
import type { CatalogFixture } from './types.js';

export const ITEMS_FIXTURES = [
{
    "id": "items-columns" as const,
    "fn": "Items",
    "axis": "arrangement",
    "value": "columns",
    "caption": "Three columns with statement scale",
    "section": {
        "id": "items-columns",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-statement.heading"
        },
        "block": {
            "type": "items",
            "recipe": "statement",
            "items": [
                {
                    "id": "statement-item-1",
                    "heading": {
                        "id": "catalog.sample.statement.0.heading"
                    },
                    "description": {
                        "id": "catalog.sample.statement.0.description"
                    }
                },
                {
                    "id": "statement-item-2",
                    "heading": {
                        "id": "catalog.sample.statement.1.heading"
                    },
                    "description": {
                        "id": "catalog.sample.statement.1.description"
                    }
                },
                {
                    "id": "statement-item-3",
                    "heading": {
                        "id": "catalog.sample.statement.2.heading"
                    },
                    "description": {
                        "id": "catalog.sample.statement.2.description"
                    }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-rows" as const,
    "fn": "Items",
    "axis": "arrangement",
    "value": "rows",
    "caption": "Even two-column rows",
    "section": {
        "id": "items-rows",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-rows-two.heading"
        },
        "block": {
            "type": "items",
            "arrangement": "rows",
            "columns": 2,
            "items": [
                {
                    "id": "rows-two-item-1",
                    "heading": {
                        "id": "catalog.sample.rows-two.0.heading"
                    },
                    "badge": { "tone": "success", "label": { "id": "catalog.sample.readiness.available" } }
                },
                {
                    "id": "rows-two-item-2",
                    "heading": {
                        "id": "catalog.sample.rows-two.1.heading"
                    },
                    "badge": { "tone": "warning", "label": { "id": "catalog.sample.readiness.partial" } }
                },
                {
                    "id": "rows-two-item-3",
                    "heading": {
                        "id": "catalog.sample.rows-two.2.heading"
                    },
                    "badge": { "tone": "info", "label": { "id": "catalog.sample.readiness.planned" } }
                },
                {
                    "id": "rows-two-item-4",
                    "heading": {
                        "id": "catalog.sample.rows-two.3.heading"
                    },
                    "badge": { "tone": "neutral", "label": { "id": "catalog.sample.readiness.not-offered" } }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-bento" as const,
    "fn": "Items",
    "axis": "arrangement",
    "value": "bento",
    "caption": "Whole rows cover every bento span",
    "section": {
        "id": "items-bento",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-bento.heading"
        },
        "block": {
            "type": "items",
            "recipe": "cards",
            "items": [
                {
                    "id": "bento-item-1",
                    "heading": {
                        "id": "catalog.sample.bento.0.heading"
                    },
                    "span": "half",
                    "meta": {
                        "id": "catalog.sample.bento.0.meta"
                    }
                },
                {
                    "id": "bento-item-2",
                    "heading": {
                        "id": "catalog.sample.bento.1.heading"
                    },
                    "span": "half",
                    "meta": {
                        "id": "catalog.sample.bento.1.meta"
                    }
                },
                {
                    "id": "bento-item-3",
                    "heading": {
                        "id": "catalog.sample.bento.2.heading"
                    },
                    "span": "two-thirds",
                    "meta": {
                        "id": "catalog.sample.bento.2.meta"
                    }
                },
                {
                    "id": "bento-item-4",
                    "heading": {
                        "id": "catalog.sample.bento.3.heading"
                    },
                    "span": "third",
                    "meta": {
                        "id": "catalog.sample.bento.3.meta"
                    }
                },
                {
                    "id": "bento-item-5",
                    "heading": {
                        "id": "catalog.sample.bento.4.heading"
                    },
                    "span": "full",
                    "meta": {
                        "id": "catalog.sample.bento.4.meta"
                    }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-stacked" as const,
    "fn": "Items",
    "axis": "arrangement",
    "value": "stacked",
    "caption": "Stacked specimen recipe",
    "section": {
        "id": "items-stacked",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-stack.heading"
        },
        "block": {
            "type": "items",
            "recipe": "specimen-stack",
            "items": [
                {
                    "id": "stack-item-1",
                    "heading": {
                        "id": "catalog.sample.stack.0.heading"
                    },
                    "visual": {
                        "id": "stack-part-1",
                        "type": "fields",
                        "label": {
                            "id": "catalog.sample.stack-part-1.label"
                        },
                        "items": [
                            {
                                "id": "stack-part-1-row",
                                "label": {
                                    "id": "catalog.sample.stack-part-1.row.label"
                                },
                                "value": {
                                    "id": "catalog.sample.stack-part-1.row.value"
                                }
                            }
                        ]
                    }
                },
                {
                    "id": "stack-item-2",
                    "heading": {
                        "id": "catalog.sample.stack.1.heading"
                    },
                    "visual": {
                        "id": "stack-part-2",
                        "type": "fields",
                        "label": {
                            "id": "catalog.sample.stack-part-2.label"
                        },
                        "items": [
                            {
                                "id": "stack-part-2-row",
                                "label": {
                                    "id": "catalog.sample.stack-part-2.row.label"
                                },
                                "value": {
                                    "id": "catalog.sample.stack-part-2.row.value"
                                }
                            }
                        ]
                    }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-numbered" as const,
    "fn": "Items",
    "axis": "order",
    "value": "numbered",
    "caption": "Numbered rows",
    "section": {
        "id": "items-numbered",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-numbered.heading"
        },
        "block": {
            "type": "items",
            "arrangement": "rows",
            "columns": 1,
            "order": "numbered",
            "items": [
                {
                    "id": "numbered-item-1",
                    "heading": {
                        "id": "catalog.sample.numbered.0.heading"
                    }
                },
                {
                    "id": "numbered-item-2",
                    "heading": {
                        "id": "catalog.sample.numbered.1.heading"
                    }
                },
                {
                    "id": "numbered-item-3",
                    "heading": {
                        "id": "catalog.sample.numbered.2.heading"
                    }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-connected" as const,
    "fn": "Items",
    "axis": "order",
    "value": "connected",
    "caption": "Three connected steps with meta and visual",
    "section": {
        "id": "items-connected",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-connected.heading"
        },
        "block": {
            "type": "items",
            "recipe": "steps",
            "items": [
                {
                    "id": "connected-item-1",
                    "heading": {
                        "id": "catalog.sample.connected.0.heading"
                    },
                    "meta": {
                        "id": "catalog.sample.connected.0.meta"
                    },
                    "visual": {
                        "id": "connected-part-1",
                        "type": "fields",
                        "label": {
                            "id": "catalog.sample.connected-part-1.label"
                        },
                        "items": [
                            {
                                "id": "connected-part-1-row",
                                "label": {
                                    "id": "catalog.sample.connected-part-1.row.label"
                                },
                                "value": {
                                    "id": "catalog.sample.connected-part-1.row.value"
                                }
                            }
                        ]
                    }
                },
                {
                    "id": "connected-item-2",
                    "heading": {
                        "id": "catalog.sample.connected.1.heading"
                    },
                    "meta": {
                        "id": "catalog.sample.connected.1.meta"
                    },
                    "visual": {
                        "id": "connected-part-2",
                        "type": "fields",
                        "label": {
                            "id": "catalog.sample.connected-part-2.label"
                        },
                        "items": [
                            {
                                "id": "connected-part-2-row",
                                "label": {
                                    "id": "catalog.sample.connected-part-2.row.label"
                                },
                                "value": {
                                    "id": "catalog.sample.connected-part-2.row.value"
                                }
                            }
                        ]
                    }
                },
                {
                    "id": "connected-item-3",
                    "heading": {
                        "id": "catalog.sample.connected.2.heading"
                    },
                    "meta": {
                        "id": "catalog.sample.connected.2.meta"
                    },
                    "visual": {
                        "id": "connected-part-3",
                        "type": "fields",
                        "label": {
                            "id": "catalog.sample.connected-part-3.label"
                        },
                        "items": [
                            {
                                "id": "connected-part-3-row",
                                "label": {
                                    "id": "catalog.sample.connected-part-3.row.label"
                                },
                                "value": {
                                    "id": "catalog.sample.connected-part-3.row.value"
                                }
                            }
                        ]
                    }
                }
            ],
            "end": "ends",
            "caption": {
                "id": "catalog.sample.connected.caption"
            }
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-flow-five" as const,
    "fn": "Items",
    "axis": "order",
    "value": "connected",
    "caption": "Five-step flow using exactly two named lanes",
    "section": {
        "id": "items-flow-five",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-lanes.heading"
        },
        "block": {
            "type": "items",
            "recipe": "steps",
            "arrangement": "stacked",
            "lanes": [
                {
                    "id": "sender",
                    "label": {
                        "id": "catalog.sample.lane.sender"
                    }
                },
                {
                    "id": "reviewer",
                    "label": {
                        "id": "catalog.sample.lane.reviewer"
                    }
                }
            ],
            "items": [
                {
                    "id": "flow-item-1",
                    "heading": {
                        "id": "catalog.sample.lanes.0.heading"
                    },
                    "lane": "sender",
                    "meta": {
                        "id": "catalog.sample.lanes.0.meta"
                    }
                },
                {
                    "id": "flow-item-2",
                    "heading": {
                        "id": "catalog.sample.lanes.1.heading"
                    },
                    "lane": "reviewer",
                    "meta": {
                        "id": "catalog.sample.lanes.1.meta"
                    }
                },
                {
                    "id": "flow-item-3",
                    "heading": {
                        "id": "catalog.sample.lanes.2.heading"
                    },
                    "lane": "reviewer",
                    "meta": {
                        "id": "catalog.sample.lanes.2.meta"
                    }
                },
                {
                    "id": "flow-item-4",
                    "heading": {
                        "id": "catalog.sample.lanes.0.heading"
                    },
                    "lane": "sender",
                    "meta": {
                        "id": "catalog.sample.lanes.0.meta"
                    }
                },
                {
                    "id": "flow-item-5",
                    "heading": {
                        "id": "catalog.sample.lanes.1.heading"
                    },
                    "lane": "sender",
                    "meta": {
                        "id": "catalog.sample.lanes.1.meta"
                    }
                }
            ],
            "end": "continues",
            "endLabel": {
                "id": "catalog.sample.lanes.end"
            }
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-disclose" as const,
    "fn": "Items",
    "axis": "reveal",
    "value": "disclose",
    "caption": "Four disclosed answers",
    "section": {
        "id": "items-disclose",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-disclose.heading"
        },
        "block": {
            "type": "items",
            "recipe": "faq",
            "items": [
                {
                    "id": "disclose-item-1",
                    "heading": {
                        "id": "catalog.sample.disclose.0.heading"
                    },
                    "description": {
                        "id": "catalog.sample.disclose.0.description"
                    }
                },
                {
                    "id": "disclose-item-2",
                    "heading": {
                        "id": "catalog.sample.disclose.1.heading"
                    },
                    "description": {
                        "id": "catalog.sample.disclose.1.description"
                    }
                },
                {
                    "id": "disclose-item-3",
                    "heading": {
                        "id": "catalog.sample.disclose.2.heading"
                    },
                    "description": {
                        "id": "catalog.sample.disclose.2.description"
                    }
                },
                {
                    "id": "disclose-item-4",
                    "heading": {
                        "id": "catalog.sample.disclose.3.heading"
                    },
                    "description": {
                        "id": "catalog.sample.disclose.3.description"
                    }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-plain" as const,
    "fn": "Items",
    "axis": "treatment",
    "value": "plain",
    "caption": "Plain columns",
    "section": {
        "id": "items-plain",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-columns.heading"
        },
        "block": {
            "type": "items",
            "recipe": "features",
            "items": [
                {
                    "id": "columns-item-1",
                    "heading": {
                        "id": "catalog.sample.columns.0.heading"
                    },
                    "icon": "clock"
                },
                {
                    "id": "columns-item-2",
                    "heading": {
                        "id": "catalog.sample.columns.1.heading"
                    },
                    "icon": "clock"
                },
                {
                    "id": "columns-item-3",
                    "heading": {
                        "id": "catalog.sample.columns.2.heading"
                    },
                    "icon": "clock"
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-rule" as const,
    "fn": "Items",
    "axis": "treatment",
    "value": "rule",
    "caption": "Two ruled columns",
    "section": {
        "id": "items-rule",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-rule.heading"
        },
        "block": {
            "type": "items",
            "arrangement": "columns",
            "columns": 2,
            "treatment": "rule",
            "items": [
                {
                    "id": "rule-item-1",
                    "heading": {
                        "id": "catalog.sample.rule.0.heading"
                    }
                },
                {
                    "id": "rule-item-2",
                    "heading": {
                        "id": "catalog.sample.rule.1.heading"
                    }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-plate" as const,
    "fn": "Items",
    "axis": "treatment",
    "value": "plate",
    "caption": "Linked plate recipe",
    "section": {
        "id": "items-plate",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-links.heading"
        },
        "block": {
            "type": "items",
            "recipe": "link-index",
            "items": [
                {
                    "id": "links-item-1",
                    "heading": {
                        "id": "catalog.sample.links.0.heading"
                    },
                    "href": "/sample-1"
                },
                {
                    "id": "links-item-2",
                    "heading": {
                        "id": "catalog.sample.links.1.heading"
                    },
                    "href": "/sample-2"
                },
                {
                    "id": "links-item-3",
                    "heading": {
                        "id": "catalog.sample.links.2.heading"
                    },
                    "href": "/sample-3"
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-parallel-columns" as const,
    "fn": "Items",
    "axis": "arrangement",
    "value": "columns",
    "caption": "Three parallel columns",
    "section": {
        "id": "items-parallel-columns",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-parallel-columns.heading"
        },
        "block": {
            "type": "items",
            "arrangement": "columns",
            "items": [
                {
                    "id": "parallel-column-item-1",
                    "heading": {
                        "id": "catalog.sample.parallel-columns.0.heading"
                    }
                },
                {
                    "id": "parallel-column-item-2",
                    "heading": {
                        "id": "catalog.sample.parallel-columns.1.heading"
                    }
                },
                {
                    "id": "parallel-column-item-3",
                    "heading": {
                        "id": "catalog.sample.parallel-columns.2.heading"
                    }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-eyebrow" as const,
    "fn": "Items",
    "axis": "slot",
    "value": "eyebrow",
    "caption": "Feature item eyebrow",
    "section": {
        "id": "items-eyebrow",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-columns.heading"
        },
        "block": {
            "type": "items",
            "recipe": "features",
            "items": [
                {
                    "id": "columns-item-1",
                    "heading": {
                        "id": "catalog.sample.columns.0.heading"
                    },
                    "icon": "clock",
                    "eyebrow": {
                        "id": "catalog.sample.example.item.eyebrow"
                    }
                },
                {
                    "id": "columns-item-2",
                    "heading": {
                        "id": "catalog.sample.columns.1.heading"
                    },
                    "icon": "clock"
                },
                {
                    "id": "columns-item-3",
                    "heading": {
                        "id": "catalog.sample.columns.2.heading"
                    },
                    "icon": "clock"
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-icon-groups" as const,
    "fn": "Items",
    "axis": "slot",
    "value": "icon",
    "caption": "Row icons with partitioned topic groups",
    "section": {
        "id": "items-icon-groups",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-topics.heading"
        },
        "block": {
            "type": "items",
            "recipe": "topics",
            "items": [
                {
                    "id": "topics-item-1",
                    "heading": {
                        "id": "catalog.sample.topics.0.heading"
                    },
                    "icon": "file-text"
                },
                {
                    "id": "topics-item-2",
                    "heading": {
                        "id": "catalog.sample.topics.1.heading"
                    },
                    "icon": "file-text"
                },
                {
                    "id": "topics-item-3",
                    "heading": {
                        "id": "catalog.sample.topics.2.heading"
                    },
                    "icon": "file-text"
                },
                {
                    "id": "topics-item-4",
                    "heading": {
                        "id": "catalog.sample.topics.3.heading"
                    },
                    "icon": "file-text"
                },
                {
                    "id": "topics-item-5",
                    "heading": {
                        "id": "catalog.sample.topics.4.heading"
                    },
                    "icon": "file-text"
                },
                {
                    "id": "topics-item-6",
                    "heading": {
                        "id": "catalog.sample.topics.5.heading"
                    },
                    "icon": "file-text"
                },
                {
                    "id": "topics-item-7",
                    "heading": {
                        "id": "catalog.sample.topics.6.heading"
                    },
                    "icon": "file-text"
                },
                {
                    "id": "topics-item-8",
                    "heading": {
                        "id": "catalog.sample.topics.7.heading"
                    },
                    "icon": "file-text"
                }
            ],
            "groups": [
                {
                    "id": "group-1",
                    "label": {
                        "id": "catalog.sample.topics.group0.label"
                    },
                    "items": [
                        "topics-item-1",
                        "topics-item-2"
                    ]
                },
                {
                    "id": "group-2",
                    "label": {
                        "id": "catalog.sample.topics.group1.label"
                    },
                    "items": [
                        "topics-item-3",
                        "topics-item-4"
                    ]
                },
                {
                    "id": "group-3",
                    "label": {
                        "id": "catalog.sample.topics.group2.label"
                    },
                    "items": [
                        "topics-item-5",
                        "topics-item-6"
                    ]
                },
                {
                    "id": "group-4",
                    "label": {
                        "id": "catalog.sample.topics.group3.label"
                    },
                    "items": [
                        "topics-item-7",
                        "topics-item-8"
                    ]
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-visual" as const,
    "fn": "Items",
    "axis": "slot",
    "value": "visual",
    "caption": "Part visual slot",
    "section": {
        "id": "items-visual",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-stack.heading"
        },
        "block": {
            "type": "items",
            "recipe": "specimen-stack",
            "items": [
                {
                    "id": "stack-item-1",
                    "heading": {
                        "id": "catalog.sample.stack.0.heading"
                    },
                    "visual": {
                        "id": "stack-part-1",
                        "type": "fields",
                        "label": {
                            "id": "catalog.sample.stack-part-1.label"
                        },
                        "items": [
                            {
                                "id": "stack-part-1-row",
                                "label": {
                                    "id": "catalog.sample.stack-part-1.row.label"
                                },
                                "value": {
                                    "id": "catalog.sample.stack-part-1.row.value"
                                }
                            }
                        ]
                    }
                },
                {
                    "id": "stack-item-2",
                    "heading": {
                        "id": "catalog.sample.stack.1.heading"
                    },
                    "visual": {
                        "id": "stack-part-2",
                        "type": "fields",
                        "label": {
                            "id": "catalog.sample.stack-part-2.label"
                        },
                        "items": [
                            {
                                "id": "stack-part-2-row",
                                "label": {
                                    "id": "catalog.sample.stack-part-2.row.label"
                                },
                                "value": {
                                    "id": "catalog.sample.stack-part-2.row.value"
                                }
                            }
                        ]
                    }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-link" as const,
    "fn": "Items",
    "axis": "slot",
    "value": "href",
    "caption": "All items linked to distinct destinations",
    "section": {
        "id": "items-link",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-links.heading"
        },
        "block": {
            "type": "items",
            "recipe": "link-index",
            "items": [
                {
                    "id": "links-item-1",
                    "heading": {
                        "id": "catalog.sample.links.0.heading"
                    },
                    "href": "/sample-1"
                },
                {
                    "id": "links-item-2",
                    "heading": {
                        "id": "catalog.sample.links.1.heading"
                    },
                    "href": "/sample-2"
                },
                {
                    "id": "links-item-3",
                    "heading": {
                        "id": "catalog.sample.links.2.heading"
                    },
                    "href": "/sample-3"
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-badge-meta" as const,
    "fn": "Items",
    "axis": "badgeTone",
    "value": [
        "neutral",
        "success",
        "warning",
        "danger",
        "info"
    ],
    "caption": "Badge plus meta, badge-only, meta-only; same panel has independent status and badge",
    "section": {
        "id": "items-badge-meta",
        "kind": "content-section",
        "size": "standard",
        "layout": "split-end",
        "heading": {
            "id": "catalog.sample.items-badge-meta.heading"
        },
        "block": {
            "type": "items",
            "arrangement": "rows",
            "items": [
                {
                    "id": "badge-item-1",
                    "heading": {
                        "id": "catalog.sample.badge.0.heading"
                    },
                    "badge": {
                        "tone": "neutral",
                        "label": {
                            "id": "catalog.sample.badge.neutral"
                        }
                    },
                    "meta": {
                        "id": "catalog.sample.badge.meta-both"
                    }
                },
                {
                    "id": "badge-item-2",
                    "heading": {
                        "id": "catalog.sample.badge.1.heading"
                    },
                    "badge": {
                        "tone": "success",
                        "label": {
                            "id": "catalog.sample.badge.success"
                        }
                    }
                },
                {
                    "id": "badge-item-3",
                    "heading": {
                        "id": "catalog.sample.badge.2.heading"
                    },
                    "badge": {
                        "tone": "warning",
                        "label": {
                            "id": "catalog.sample.badge.warning"
                        }
                    }
                },
                {
                    "id": "badge-item-4",
                    "heading": {
                        "id": "catalog.sample.badge.3.heading"
                    },
                    "badge": {
                        "tone": "danger",
                        "label": {
                            "id": "catalog.sample.badge.danger"
                        }
                    }
                },
                {
                    "id": "badge-item-5",
                    "heading": {
                        "id": "catalog.sample.badge.4.heading"
                    },
                    "badge": {
                        "tone": "info",
                        "label": {
                            "id": "catalog.sample.badge.info"
                        }
                    }
                },
                {
                    "id": "badge-item-6",
                    "heading": {
                        "id": "catalog.sample.badge.5.heading"
                    },
                    "meta": {
                        "id": "catalog.sample.badge.meta-only"
                    }
                }
            ]
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
                },
                "badge": {
                    "tone": "info",
                    "label": {
                        "id": "catalog.sample.panel.badge"
                    }
                },
                "status": {
                    "tone": "success",
                    "label": {
                        "id": "catalog.sample.example.panel.health"
                    }
                }
            }
        }
    } satisfies SectionedViewSection
},
{
    "id": "items-two-lane-list" as const,
    "fn": "Items",
    "axis": "lanes",
    "value": "two-ids",
    "caption": "Exactly two id/label lane entries, sender/reviewer/sender",
    "section": {
        "id": "items-two-lane-list",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.items-lanes.heading"
        },
        "block": {
            "type": "items",
            "recipe": "steps",
            "arrangement": "stacked",
            "lanes": [
                {
                    "id": "sender",
                    "label": {
                        "id": "catalog.sample.lane.sender"
                    }
                },
                {
                    "id": "reviewer",
                    "label": {
                        "id": "catalog.sample.lane.reviewer"
                    }
                }
            ],
            "items": [
                {
                    "id": "lanes-item-1",
                    "heading": {
                        "id": "catalog.sample.lanes.0.heading"
                    },
                    "lane": "sender",
                    "meta": {
                        "id": "catalog.sample.lanes.0.meta"
                    }
                },
                {
                    "id": "lanes-item-2",
                    "heading": {
                        "id": "catalog.sample.lanes.1.heading"
                    },
                    "lane": "reviewer",
                    "meta": {
                        "id": "catalog.sample.lanes.1.meta"
                    }
                },
                {
                    "id": "lanes-item-3",
                    "heading": {
                        "id": "catalog.sample.lanes.2.heading"
                    },
                    "lane": "sender",
                    "meta": {
                        "id": "catalog.sample.lanes.2.meta"
                    }
                }
            ],
            "end": "continues",
            "endLabel": {
                "id": "catalog.sample.lanes.end"
            }
        }
    } satisfies SectionedViewSection
},
] satisfies CatalogFixture[];
