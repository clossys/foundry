import type { SectionedViewSection } from '../../core/sectioned-view.js';
import type { CatalogFixture } from './types.js';

export const MEDIA_FIXTURES = [
{
    "id": "media-specimen" as const,
    "fn": "Media",
    "axis": "type",
    "value": "specimen",
    "caption": "Single specimen without previous marker",
    "section": {
        "id": "media-specimen",
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
    "id": "media-key" as const,
    "fn": "Media",
    "axis": "keySide",
    "value": "end",
    "caption": "Labeled key targets in reading order",
    "section": {
        "id": "media-key",
        "kind": "content-section",
        "ground": "base",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.media-key-end.heading"
        },
        "media": {
            "type": "specimen",
            "label": {
                "id": "catalog.sample.media-key-end.label"
            },
            "panel": {
                "id": "key-panel",
                "title": {
                    "id": "catalog.sample.key-panel.title"
                },
                "parts": [
                    {
                        "id": "key-table",
                        "type": "table",
                        "label": {
                            "id": "catalog.sample.key-table.label"
                        },
                        "caption": {
                            "id": "catalog.sample.key-table.caption"
                        },
                        "columns": [
                            {
                                "id": "label",
                                "label": {
                                    "id": "catalog.sample.table.column.label"
                                }
                            },
                            {
                                "id": "value",
                                "label": {
                                    "id": "catalog.sample.table.column.value"
                                }
                            }
                        ],
                        "rows": [
                            {
                                "id": "sample-row",
                                "cells": [
                                    {
                                        "text": {
                                            "id": "catalog.sample.table.row"
                                        }
                                    },
                                    {
                                        "text": {
                                            "id": "catalog.sample.table.value"
                                        }
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        "id": "key-schedule",
                        "type": "schedule",
                        "label": {
                            "id": "catalog.sample.schedule.label"
                        },
                        "items": [
                            {
                                "id": "sample-date",
                                "date": {
                                    "id": "catalog.sample.schedule.date"
                                },
                                "label": {
                                    "id": "catalog.sample.schedule.item"
                                }
                            }
                        ]
                    },
                    {
                        "id": "key-shares",
                        "type": "shares",
                        "label": {
                            "id": "catalog.sample.shares.label"
                        },
                        "items": [
                            {
                                "id": "first-share",
                                "name": {
                                    "id": "catalog.sample.shares.first"
                                },
                                "share": 50,
                                "shareText": {
                                    "id": "catalog.sample.shares.first-text"
                                }
                            },
                            {
                                "id": "second-share",
                                "name": {
                                    "id": "catalog.sample.shares.second"
                                },
                                "share": 50,
                                "shareText": {
                                    "id": "catalog.sample.shares.second-text"
                                }
                            }
                        ]
                    }
                ],
                "footer": {
                    "note": {
                        "id": "catalog.sample.key.footer"
                    }
                }
            },
            "key": {
                "label": {
                    "id": "catalog.sample.key.end.label"
                },
                "side": "end",
                "items": [
                    {
                        "id": "key-0",
                        "target": "header",
                        "heading": {
                            "id": "catalog.sample.key.end.heading0"
                        },
                        "description": {
                            "id": "catalog.sample.key.end.description0"
                        }
                    },
                    {
                        "id": "key-1",
                        "target": "key-table",
                        "heading": {
                            "id": "catalog.sample.key.end.heading1"
                        },
                        "description": {
                            "id": "catalog.sample.key.end.description1"
                        }
                    },
                    {
                        "id": "key-2",
                        "target": "footer",
                        "heading": {
                            "id": "catalog.sample.key.end.heading2"
                        },
                        "description": {
                            "id": "catalog.sample.key.end.description2"
                        }
                    }
                ]
            }
        }
    } satisfies SectionedViewSection
},
{
    "id": "media-record-one" as const,
    "fn": "Media",
    "axis": "columns",
    "value": 1,
    "caption": "One-column record",
    "section": {
        "id": "media-record-one",
        "kind": "content-section",
        "ground": "base",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.media-record.heading"
        },
        "media": {
            "type": "record",
            "id": "sample-record",
            "head": {
                "title": {
                    "id": "catalog.sample.record.title"
                },
                "meta": {
                    "id": "catalog.sample.record.meta"
                },
                "status": {
                    "tone": "success",
                    "label": {
                        "id": "catalog.sample.record.head.status"
                    }
                }
            },
            "columns": 1,
            "caption": {
                "id": "catalog.sample.record.caption"
            },
            "flagLabel": {
                "id": "catalog.sample.record.flag"
            },
            "groups": [
                {
                    "id": "rows",
                    "label": {
                        "id": "catalog.sample.record.rows"
                    },
                    "rows": [
                        {
                            "id": "record-row",
                            "label": {
                                "id": "catalog.sample.record.row"
                            },
                            "detail": {
                                "id": "catalog.sample.record.detail"
                            },
                            "flag": true
                        }
                    ]
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "media-record-three" as const,
    "fn": "Media",
    "axis": "columns",
    "value": 3,
    "caption": "Three columns with final owner",
    "section": {
        "id": "media-record-three",
        "kind": "content-section",
        "ground": "base",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.media-record.heading"
        },
        "media": {
            "type": "record",
            "id": "sample-record",
            "head": {
                "title": {
                    "id": "catalog.sample.record.title"
                },
                "meta": {
                    "id": "catalog.sample.record.meta"
                },
                "status": {
                    "tone": "success",
                    "label": {
                        "id": "catalog.sample.record.head.status"
                    }
                }
            },
            "columns": 3,
            "caption": {
                "id": "catalog.sample.record.caption"
            },
            "flagLabel": {
                "id": "catalog.sample.record.flag"
            },
            "groups": [
                {
                    "id": "rows",
                    "label": {
                        "id": "catalog.sample.record.rows"
                    },
                    "rows": [
                        {
                            "id": "record-row",
                            "label": {
                                "id": "catalog.sample.record.row"
                            },
                            "detail": {
                                "id": "catalog.sample.record.detail"
                            },
                            "flag": true
                        }
                    ]
                },
                {
                    "id": "second-rows",
                    "label": {
                        "id": "catalog.sample.record.rows"
                    },
                    "rows": [
                        {
                            "id": "second-row",
                            "label": {
                                "id": "catalog.sample.record.row"
                            },
                            "detail": {
                                "id": "catalog.sample.record.detail"
                            }
                        }
                    ]
                },
                {
                    "id": "owner",
                    "label": {
                        "id": "catalog.sample.record.owner-label"
                    },
                    "owner": {
                        "initials": {
                            "id": "catalog.sample.record.initials"
                        },
                        "name": {
                            "id": "catalog.sample.record.owner"
                        },
                        "note": {
                            "id": "catalog.sample.record.owner-note"
                        }
                    }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "media-converge" as const,
    "fn": "Media",
    "axis": "sceneTemplate",
    "value": "converge",
    "caption": "Seven source formats with declared relations",
    "section": {
        "id": "media-converge",
        "kind": "content-section",
        "ground": "base",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.media-converge.heading"
        },
        "media": {
            "type": "scene",
            "label": {
                "id": "catalog.sample.converge.label"
            },
            "relationLabel": {
                "id": "catalog.sample.converge.relation"
            },
            "input": {
                "template": "converge",
                "seed": "catalog-converge",
                "disorder": "medium",
                "sources": {
                    "heading": {
                        "id": "catalog.sample.converge.sources"
                    },
                    "items": [
                        {
                            "id": "source-0",
                            "format": "pdf",
                            "title": {
                                "id": "catalog.sample.converge.source0"
                            }
                        },
                        {
                            "id": "source-1",
                            "format": "email",
                            "title": {
                                "id": "catalog.sample.converge.source1"
                            }
                        },
                        {
                            "id": "source-2",
                            "format": "sheet",
                            "title": {
                                "id": "catalog.sample.converge.source2"
                            }
                        },
                        {
                            "id": "source-3",
                            "format": "doc",
                            "title": {
                                "id": "catalog.sample.converge.source3"
                            }
                        },
                        {
                            "id": "source-4",
                            "format": "note",
                            "title": {
                                "id": "catalog.sample.converge.source4"
                            }
                        },
                        {
                            "id": "source-5",
                            "format": "scan",
                            "title": {
                                "id": "catalog.sample.converge.source5"
                            }
                        },
                        {
                            "id": "source-6",
                            "format": "calendar",
                            "title": {
                                "id": "catalog.sample.converge.source6"
                            }
                        }
                    ]
                },
                "target": {
                    "heading": {
                        "id": "catalog.sample.converge.target"
                    },
                    "title": {
                        "id": "catalog.sample.converge.title"
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
                        },
                        {
                            "id": "result-2",
                            "label": {
                                "id": "catalog.sample.scene.row2"
                            },
                            "value": {
                                "id": "catalog.sample.scene.value2"
                            },
                            "status": "warning"
                        },
                        {
                            "id": "result-3",
                            "label": {
                                "id": "catalog.sample.scene.row3"
                            },
                            "value": {
                                "id": "catalog.sample.scene.value3"
                            },
                            "status": "danger"
                        },
                        {
                            "id": "result-4",
                            "label": {
                                "id": "catalog.sample.scene.row4"
                            },
                            "value": {
                                "id": "catalog.sample.scene.value4"
                            },
                            "status": "info"
                        }
                    ]
                },
                "relations": [
                    {
                        "from": "source-0",
                        "to": "result-0"
                    },
                    {
                        "from": "source-1",
                        "to": "result-1"
                    },
                    {
                        "from": "source-2",
                        "to": "result-2"
                    },
                    {
                        "from": "source-3",
                        "to": "result-3"
                    },
                    {
                        "from": "source-4",
                        "to": "result-4"
                    },
                    {
                        "from": "source-5",
                        "to": "result-0"
                    },
                    {
                        "from": "source-6",
                        "to": "result-1"
                    }
                ]
            }
        }
    } satisfies SectionedViewSection
},
{
    "id": "media-evidence" as const,
    "fn": "Media",
    "axis": "sceneTemplate",
    "value": "evidence-trail",
    "caption": "Source citations join declared result rows",
    "section": {
        "id": "media-evidence",
        "kind": "content-section",
        "ground": "base",
        "size": "standard",
        "layout": "split-end",
        "heading": {
            "id": "catalog.sample.media-evidence.heading"
        },
        "media": {
            "type": "scene",
            "label": {
                "id": "catalog.sample.evidence.label"
            },
            "input": {
                "template": "evidence-trail",
                "seed": "catalog-evidence",
                "disorder": "low",
                "sources": [
                    {
                        "id": "evidence-0",
                        "format": "pdf",
                        "title": {
                            "id": "catalog.sample.evidence.source0"
                        },
                        "cites": "result-0",
                        "cite": {
                            "id": "catalog.sample.evidence.cite0"
                        }
                    },
                    {
                        "id": "evidence-1",
                        "format": "pdf",
                        "title": {
                            "id": "catalog.sample.evidence.source1"
                        },
                        "cites": "result-1",
                        "cite": {
                            "id": "catalog.sample.evidence.cite1"
                        }
                    }
                ],
                "result": {
                    "title": {
                        "id": "catalog.sample.evidence.title"
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
    } satisfies SectionedViewSection
},
{
    "id": "media-meter-previous" as const,
    "fn": "Media",
    "axis": "previous",
    "value": "paired",
    "caption": "Prior 30, current 40, limit 80 on scale 100; matching text alternatives",
    "section": {
        "id": "media-meter-previous",
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
                        },
                        "previous": 30,
                        "previousText": {
                            "id": "catalog.sample.meter.previous"
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
] satisfies CatalogFixture[];
