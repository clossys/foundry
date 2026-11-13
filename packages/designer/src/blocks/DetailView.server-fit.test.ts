/** @vitest-environment node */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("keeps compact record actions in the actual server entry without importing a client module", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const script = `import{DetailView}from${JSON.stringify(resolve(root, "dist/blocks/server.js"))};const n=DetailView({title:'Record',fields:[],actions:'Edit',compactActions:'Host menu'});if(n.type!=='section'||n.props.compactActions!==undefined)throw Error('server contract');process.stdout.write('OK');`;
  expect(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000 })).toBe("OK");
  const bundle = await build({ entryPoints: [resolve(root, "src/blocks/DetailView.tsx")], bundle: true, write: false, metafile: true, platform: "node", format: "esm", conditions: ["react-server"], external: ["react", "react/jsx-runtime", "tailwind-merge"] });
  expect(Object.keys(bundle.metafile!.inputs).filter(path => /react-aria|\/Menu\.|\.client\./.test(path))).toEqual([]);
});
