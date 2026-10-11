import { Item } from "./Item.js";
import { Items } from "./Items.js";

const item = { id: "one", heading: "Title" };
void <Item {...item} treatment="plain" size="standard" ground="base" />;
// @ts-expect-error Standalone items explicitly select their treatment.
void <Item {...item} size="standard" ground="base" />;
// @ts-expect-error Standalone items explicitly select their size.
void <Item {...item} treatment="plain" ground="base" />;
// @ts-expect-error Standalone items explicitly select their ground.
void <Item {...item} treatment="plain" size="standard" />;
// @ts-expect-error Item does not expose a private rendering policy.
void <Item {...item} treatment="plain" size="standard" ground="base" legacy />;
// @ts-expect-error Items does not expose an action callback.
void <Items arrangement="rows" items={[item, { ...item, id: "two" }]} onSelect={() => {}} />;
