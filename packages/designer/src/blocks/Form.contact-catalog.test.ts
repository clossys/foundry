import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function json<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, path), "utf8")) as T;
}

interface Fill {
  $extensions: { "com.clossys.fill": { unmapped?: string[] } };
  sections: { form: { configs: Record<string, string>; propMap: Record<string, string>; slotMap: Record<string, string> } };
}
interface CopyContract { copy: { fields: Record<string, unknown>[] } }

describe("contact form catalog contract", () => {
  it("maps the existing contact member and its host slots through the canonical Form fill", () => {
    const fill = json<Fill>("../catalog/fills/foundry/sections.form.json");
    expect(fill.$extensions["com.clossys.fill"].unmapped ?? []).not.toContain("form.contact");
    const form = fill.sections.form;
    expect(form.configs["form.contact"]).toBe("composition=contact");
    expect(form.propMap["form.contact"]).toBe("./blocks#Form.composition=contact");
    for (const [slot, prop] of [
      ["success", "submitSuccess"], ["error", "submitError"],
      ["honeypot", "honeypot"], ["turnstile", "turnstile"],
    ]) expect(form.slotMap[slot]).toBe(`./blocks#Form.${prop}`);
    const textField = json<{ components: { "text-field": { propMap: Record<string, string> } } }>("../catalog/fills/foundry/components.text-field.json");
    expect(textField.components["text-field"].propMap["line.multiline"]).toBe("./components#Textarea");
    const sections = json<{ id: string; contract: { allowedComposes: string[] } }[]>("../catalog/slots/sections.json");
    const contract = sections.find(row => row.id === "sections.form")!.contract;
    expect(contract.allowedComposes).toContain("components.text-field");
    expect(contract.allowedComposes).not.toContain("components.textarea");
  });

  it("keeps both state messages in the Writer passage with the exact section copy contract", () => {
    const sections = json<{ id: string; contract: CopyContract }[]>("../catalog/slots/sections.json");
    const passages = json<{ id: string; contract: CopyContract }[]>("../../../writer/src/catalog/slots/passages.json");
    const section = sections.find(row => row.id === "sections.form")!.contract;
    const passage = passages.find(row => row.id === "passages.form")!.contract;
    expect(passage.copy).toEqual(section.copy);
    for (const key of ["success.message", "error.message"]) {
      expect(section.copy.fields).toContainEqual({ key, kind: "plain", required: false, maxLength: { en: 480 }, dir: "auto" });
    }
  });
});
