/** Test host only: old behavioural assertions retain their recorded source wording. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StudioCopyBinding } from "../copy-binding.js";

const recordPath = [resolve(process.cwd(), "packages/writer/src/catalog/records/admin-voice.r1.en.json"), resolve(process.cwd(), "../writer/src/catalog/records/admin-voice.r1.en.json")].find(existsSync)!;
const source = JSON.parse(readFileSync(recordPath, "utf8")) as {
  reviews: { recordId: string; before: string; after: string }[];
};
export const studioTestCopy: StudioCopyBinding = {
  locale: "en",
  resolver(ref) {
    const row = source.reviews.find(review => review.recordId === ref.id);
    if (!row) return undefined;
    const values = ref.values;
    let text = row.before;
    if (text.includes("=>")) {
      if (values && "errors" in values) text = `${values.errors} errors, ${values.notices} notices`;
      else if (values && "count" in values) text = row.before.includes("members") ? `${values.count} members` : String(values.count);
      else if (values && "value" in values) text = `${Math.round(Number(values.value))}%`;
      else if (values && "name" in values) text = row.after.replace("{name}", String(values.name));
    } else if (values) for (const [key, value] of Object.entries(values)) text = text.replace(`{${key}}`, String(value));
    return { ref, text, servedLocale: ref.locale, chain: [ref.locale!] };
  },
};
