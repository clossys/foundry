import type { SectionedViewSection } from '../../core/sectioned-view.js';
import type { CatalogFixture } from './types.js';

export const MATRIX_FIXTURES = [
{
    "id": "matrix-points" as const,
    "fn": "Matrix",
    "axis": "form",
    "value": "points",
    "caption": "Two equal point lists",
    "section": {
        "id": "matrix-points",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.matrix-points.heading"
        },
        "block": {
            "type": "matrix",
            "recipe": "comparison",
            "sides": [
                {
                    "id": "before",
                    "label": {
                        "id": "catalog.sample.matrix.before.label"
                    },
                    "heading": {
                        "id": "catalog.sample.matrix.before.heading"
                    },
                    "points": [
                        {
                            "id": "catalog.sample.matrix.before.point0"
                        },
                        {
                            "id": "catalog.sample.matrix.before.point1"
                        }
                    ]
                },
                {
                    "id": "after",
                    "label": {
                        "id": "catalog.sample.matrix.after.label"
                    },
                    "heading": {
                        "id": "catalog.sample.matrix.after.heading"
                    },
                    "points": [
                        {
                            "id": "catalog.sample.matrix.after.point0"
                        },
                        {
                            "id": "catalog.sample.matrix.after.point1"
                        }
                    ]
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "matrix-visuals" as const,
    "fn": "Matrix",
    "axis": "form",
    "value": "visual",
    "caption": "Two equal panel visual sides",
    "section": {
        "id": "matrix-visuals",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.matrix-visuals.heading"
        },
        "block": {
            "type": "matrix",
            "sides": [
                {
                    "id": "before",
                    "label": {
                        "id": "catalog.sample.matrixv.before.label"
                    },
                    "heading": {
                        "id": "catalog.sample.matrixv.before.heading"
                    },
                    "visual": {
                        "id": "matrixv-before",
                        "title": {
                            "id": "catalog.sample.matrixv-before.title"
                        },
                        "parts": [
                            {
                                "id": "matrixv-before-fields",
                                "type": "fields",
                                "label": {
                                    "id": "catalog.sample.matrixv-before-fields.label"
                                },
                                "items": [
                                    {
                                        "id": "matrixv-before-fields-row",
                                        "label": {
                                            "id": "catalog.sample.matrixv-before-fields.row.label"
                                        },
                                        "value": {
                                            "id": "catalog.sample.matrixv-before-fields.row.value"
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                },
                {
                    "id": "after",
                    "label": {
                        "id": "catalog.sample.matrixv.after.label"
                    },
                    "heading": {
                        "id": "catalog.sample.matrixv.after.heading"
                    },
                    "visual": {
                        "id": "matrixv-after",
                        "title": {
                            "id": "catalog.sample.matrixv-after.title"
                        },
                        "parts": [
                            {
                                "id": "matrixv-after-fields",
                                "type": "fields",
                                "label": {
                                    "id": "catalog.sample.matrixv-after-fields.label"
                                },
                                "items": [
                                    {
                                        "id": "matrixv-after-fields-row",
                                        "label": {
                                            "id": "catalog.sample.matrixv-after-fields.row.label"
                                        },
                                        "value": {
                                            "id": "catalog.sample.matrixv-after-fields.row.value"
                                        }
                                    }
                                ]
                            }
                        ]
                    }
                }
            ]
        }
    } satisfies SectionedViewSection
},
{
    "id": "matrix-featured-points" as const,
    "fn": "Matrix",
    "axis": "form",
    "value": "points",
    "caption": "Featured comparison with description leads",
    "section": {
        "id": "matrix-featured-points",
        "kind": "content-section",
        "size": "standard",
        "layout": "stacked",
        "heading": {
            "id": "catalog.sample.matrix-points.heading"
        },
        "block": {
            "type": "matrix",
            "recipe": "comparison",
            "featured": "after",
            "sides": [
                {
                    "id": "before",
                    "label": {
                        "id": "catalog.sample.matrix.before.label"
                    },
                    "heading": {
                        "id": "catalog.sample.matrix.before.heading"
                    },
                    "description": {
                        "id": "catalog.sample.example.matrix.before.description"
                    },
                    "points": [{ "id": "catalog.sample.matrix.before.point0" }, { "id": "catalog.sample.matrix.before.point1" }]
                },
                {
                    "id": "after",
                    "label": {
                        "id": "catalog.sample.matrix.after.label"
                    },
                    "heading": {
                        "id": "catalog.sample.matrix.after.heading"
                    },
                    "description": {
                        "id": "catalog.sample.example.matrix.after.description"
                    },
                    "points": [{ "id": "catalog.sample.matrix.after.point0" }, { "id": "catalog.sample.matrix.after.point1" }]
                }
            ]
        }
    } satisfies SectionedViewSection
},
] satisfies CatalogFixture[];
