import type { SectionedViewDocument } from '../../core/sectioned-view.js';
export const CATALOG_COMPOSITIONS: Record<string, SectionedViewDocument> = {
    "recipes-nav-composition": {
        "id": "catalog-recipe-nav-page",
        "sections": [
            {
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
            },
            {
                "id": "recipe-topic-1",
                "kind": "content-section",
                "ground": "base",
                "size": "standard",
                "layout": "stacked",
                "heading": {
                    "id": "catalog.sample.items-topics.heading"
                },
                "block": {
                    "type": "items",
                    "recipe": "topics",
                    "columns": 1,
                    "items": [
                        {
                            "id": "topics-item-1",
                            "heading": {
                                "id": "catalog.sample.topics.0.heading"
                            }
                        },
                        {
                            "id": "topics-item-2",
                            "heading": {
                                "id": "catalog.sample.topics.1.heading"
                            }
                        },
                        {
                            "id": "topics-item-3",
                            "heading": {
                                "id": "catalog.sample.topics.2.heading"
                            }
                        },
                        {
                            "id": "topics-item-4",
                            "heading": {
                                "id": "catalog.sample.topics.3.heading"
                            }
                        },
                        {
                            "id": "topics-item-5",
                            "heading": {
                                "id": "catalog.sample.topics.4.heading"
                            }
                        },
                        {
                            "id": "topics-item-6",
                            "heading": {
                                "id": "catalog.sample.topics.5.heading"
                            }
                        },
                        {
                            "id": "topics-item-7",
                            "heading": {
                                "id": "catalog.sample.topics.6.heading"
                            }
                        },
                        {
                            "id": "topics-item-8",
                            "heading": {
                                "id": "catalog.sample.topics.7.heading"
                            }
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
            },
            {
                "id": "recipes-nav-composition",
                "kind": "content-section",
                "ground": "sunken",
                "size": "standard",
                "layout": "stacked",
                "heading": {
                    "id": "catalog.sample.items-topics.heading"
                },
                "block": {
                    "type": "items",
                    "recipe": "topics",
                    "columns": 1,
                    "items": [
                        {
                            "id": "topics-item-1",
                            "heading": {
                                "id": "catalog.sample.topics.0.heading"
                            }
                        },
                        {
                            "id": "topics-item-2",
                            "heading": {
                                "id": "catalog.sample.topics.1.heading"
                            }
                        },
                        {
                            "id": "topics-item-3",
                            "heading": {
                                "id": "catalog.sample.topics.2.heading"
                            }
                        },
                        {
                            "id": "topics-item-4",
                            "heading": {
                                "id": "catalog.sample.topics.3.heading"
                            }
                        },
                        {
                            "id": "topics-item-5",
                            "heading": {
                                "id": "catalog.sample.topics.4.heading"
                            }
                        },
                        {
                            "id": "topics-item-6",
                            "heading": {
                                "id": "catalog.sample.topics.5.heading"
                            }
                        },
                        {
                            "id": "topics-item-7",
                            "heading": {
                                "id": "catalog.sample.topics.6.heading"
                            }
                        },
                        {
                            "id": "topics-item-8",
                            "heading": {
                                "id": "catalog.sample.topics.7.heading"
                            }
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
                },
                "media": {
                    "type": "scene",
                    "label": {
                        "id": "catalog.sample.approval.label"
                    },
                    "input": {
                        "template": "approval-chain",
                        "seed": "catalog-approval",
                        "disorder": "none",
                        "prepared": {
                            "heading": {
                                "id": "catalog.sample.approval.prepared"
                            }
                        },
                        "findings": [
                            {
                                "id": "finding-0",
                                "fn": {
                                    "id": "catalog.sample.approval.fn0"
                                },
                                "title": {
                                    "id": "catalog.sample.approval.title0"
                                },
                                "subjectOf": {
                                    "id": "catalog.sample.approval.subject0"
                                },
                                "status": {
                                    "tone": "success",
                                    "text": {
                                        "id": "catalog.sample.scene.status"
                                    }
                                },
                                "subject": true
                            },
                            {
                                "id": "finding-1",
                                "fn": {
                                    "id": "catalog.sample.approval.fn1"
                                },
                                "title": {
                                    "id": "catalog.sample.approval.title1"
                                },
                                "subjectOf": {
                                    "id": "catalog.sample.approval.subject1"
                                },
                                "status": {
                                    "tone": "success",
                                    "text": {
                                        "id": "catalog.sample.scene.status"
                                    }
                                }
                            }
                        ],
                        "node": {
                            "label": {
                                "id": "catalog.sample.approval.node"
                            }
                        },
                        "decision": {
                            "title": {
                                "id": "catalog.sample.approval.decision"
                            },
                            "rows": [
                                {
                                    "id": "result-0",
                                    "label": {
                                        "id": "catalog.sample.scene.row0"
                                    },
                                    "value": {
                                        "id": "catalog.sample.scene.value0"
                                    },
                                    "status": "neutral"
                                },
                                {
                                    "id": "result-1",
                                    "label": {
                                        "id": "catalog.sample.scene.row1"
                                    },
                                    "value": {
                                        "id": "catalog.sample.scene.value1"
                                    },
                                    "status": "success"
                                }
                            ],
                            "status": {
                                "tone": "success",
                                "text": {
                                    "id": "catalog.sample.scene.status"
                                }
                            },
                            "person": {
                                "initials": "AA",
                                "name": {
                                    "id": "catalog.sample.scene.person.name"
                                },
                                "note": {
                                    "id": "catalog.sample.scene.person.note"
                                }
                            }
                        }
                    }
                }
            },
            {
                "id": "recipe-topic-3",
                "kind": "content-section",
                "ground": "base",
                "size": "standard",
                "layout": "stacked",
                "heading": {
                    "id": "catalog.sample.items-topics.heading"
                },
                "block": {
                    "type": "items",
                    "recipe": "topics",
                    "columns": 1,
                    "items": [
                        {
                            "id": "topics-item-1",
                            "heading": {
                                "id": "catalog.sample.topics.0.heading"
                            }
                        },
                        {
                            "id": "topics-item-2",
                            "heading": {
                                "id": "catalog.sample.topics.1.heading"
                            }
                        },
                        {
                            "id": "topics-item-3",
                            "heading": {
                                "id": "catalog.sample.topics.2.heading"
                            }
                        },
                        {
                            "id": "topics-item-4",
                            "heading": {
                                "id": "catalog.sample.topics.3.heading"
                            }
                        },
                        {
                            "id": "topics-item-5",
                            "heading": {
                                "id": "catalog.sample.topics.4.heading"
                            }
                        },
                        {
                            "id": "topics-item-6",
                            "heading": {
                                "id": "catalog.sample.topics.5.heading"
                            }
                        },
                        {
                            "id": "topics-item-7",
                            "heading": {
                                "id": "catalog.sample.topics.6.heading"
                            }
                        },
                        {
                            "id": "topics-item-8",
                            "heading": {
                                "id": "catalog.sample.topics.7.heading"
                            }
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
            },
            {
                "id": "recipe-faq",
                "kind": "content-section",
                "ground": "base",
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
            },
            {
                "id": "recipe-close",
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
            }
        ]
    } satisfies SectionedViewDocument,
} satisfies Record<string, SectionedViewDocument>;
