import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { Scanner } from "@tailwindcss/oxide";
import { compile } from "tailwindcss";

/** Compile the native source against its own standard shadcn contract. */
export async function generateNativeShadcnCss(stylesDir: string): Promise<string> {
  const require = createRequire(import.meta.url);
  const sources = ["badge", "separator", "skeleton", "card", "radio-group"].map(item => ({
    content: readFileSync(resolve(stylesDir, `../src/components/preview-runtime/components/${item}/${item}.tsx`), "utf8"),
    extension: "tsx",
  }));
  const scanner = new Scanner({});
  const candidates = scanner.scanFiles(sources);
  const entry = '@import "tailwindcss/theme";\n'
    + '@import "tailwindcss/utilities" layer(foundry-ui-compiled);\n'
    + readFileSync(resolve(stylesDir, "shadcn-native.css"), "utf8");
  const compiled = await compile(entry, {
    base: stylesDir,
    async loadStylesheet(id, base) {
      const target = id === "tailwindcss/theme" ? require.resolve("tailwindcss/theme.css")
        : id === "tailwindcss/utilities" ? require.resolve("tailwindcss/utilities.css") : resolve(base, id);
      return { path: target, base: dirname(target), content: readFileSync(target, "utf8") };
    },
  });
  // Keep Tailwind's own theme defaults and property registrations unchanged.
  return compiled.build(candidates);
}
