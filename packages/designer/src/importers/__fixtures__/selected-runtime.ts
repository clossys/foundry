import { createRequire } from "node:module";
import { posix } from "node:path";
import ts from "typescript";
import type { SourceFile } from "../rewrite.js";

/** Executes complete selected modules against installed peers; no runtime import is mocked. */
export function selectedRuntime(files: readonly SourceFile[], packages: Readonly<Record<string,string>> = {}) {
  const source=new Map<string,string>();
  for(const file of files) {
    const previous=source.get(file.path);
    if(previous!==undefined && previous!==file.content) throw new Error(`Different selected module bytes: ${file.path}`);
    source.set(file.path,file.content);
  }
  const nativeRequire=createRequire(import.meta.url), cache=new Map<string,{exports:Record<string,unknown>}>();
  const load=(path:string):Record<string,unknown>=>{
    const existing=cache.get(path);if(existing)return existing.exports;
    const code=source.get(path);if(code===undefined)throw new Error(`Missing selected module: ${path}`);
    const compiled=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
    const module={exports:{} as Record<string,unknown>};cache.set(path,module);
    const require=(specifier:string):unknown=>{
      if(packages[specifier])return load(packages[specifier]!);
      if(!specifier.startsWith("."))return nativeRequire(specifier);
      const target=posix.normalize(posix.join(posix.dirname(path),specifier));
      const resolved=[target,target.replace(/\.js$/,".ts"),target.replace(/\.js$/,".tsx")].find(candidate=>source.has(candidate));
      if(!resolved)throw new Error(`Missing selected import ${specifier} from ${path}`);
      return load(resolved);
    };
    try {
      new Function("require","exports","module",compiled.outputText)(require,module.exports,module);
    } catch (error) {
      // Keep the early entry for normal cycles, but never reuse partial exports
      // from a module whose import or evaluation refused.
      cache.delete(path);
      throw error;
    }
    return module.exports;
  };
  return {load,peer:nativeRequire};
}
