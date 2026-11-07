import { StockItem as Item } from "./StockItem.js";
import { Items } from "./Items.js";
import { FeatureGrid } from "../FeatureGrid.js";

const item = { id: "one", heading: "Title" };
void <Item {...item} />;
void <Item {...item} ground="base" />;
// @ts-expect-error The stock Item owns the look; standalone treatments are retired.
void <Item {...item} treatment="plain" />;
// @ts-expect-error The stock Item owns the look; standalone sizes are retired.
void <Item {...item} size="standard" />;
// @ts-expect-error Item does not expose a private rendering policy.
void <Item {...item} ground="base" legacy />;
// @ts-expect-error Items does not expose an action callback.
void <Items arrangement="rows" items={[item, { ...item, id: "two" }]} onSelect={() => {}} />;

// @ts-expect-error FeatureGrid keeps its published props; catalog columns belong to Items.
void <FeatureGrid items={[item]} columns={4} />;
// @ts-expect-error Canonical Items does not accept the legacy four-column seam.
void <Items arrangement="columns" items={[item]} columns={4} />;
void <Item {...item} ground="base" headingLevel={3} />;
void <Item {...item} ground="base" headingLevel={4} />;
// @ts-expect-error Standalone Item accepts only h3 or h4 when a heading is selected.
void <Item {...item} ground="base" headingLevel={2} />;
// @ts-expect-error Standalone Item accepts only h3 or h4 when a heading is selected.
void <Item {...item} ground="base" headingLevel={5} />;
// @ts-expect-error Heading levels are numeric.
void <Item {...item} ground="base" headingLevel="3" />;

// @ts-expect-error Featured is retired from canonical Item data.
void <Item {...item} ground="base" featured />;
// @ts-expect-error Featured is retired from canonical collection entries.
void <Items arrangement="columns" items={[{ ...item, featured: true }]} />;
