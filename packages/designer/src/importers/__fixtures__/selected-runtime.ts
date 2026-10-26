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
  const pending=new Map<string,Promise<Record<string,unknown>>>();
  const selectedPath=(from:string,specifier:string):string|undefined=>{
    if(packages[specifier])return packages[specifier];
    if(!specifier.startsWith("."))return undefined;
    const target=posix.normalize(posix.join(posix.dirname(from),specifier));
    const resolved=[target,target.replace(/\.js$/,".ts"),target.replace(/\.js$/,".tsx")].find(candidate=>source.has(candidate));
    if(!resolved)throw new Error(`Missing selected import ${specifier} from ${from}`);
    return resolved;
  };
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor as new (...args:string[]) =>
    (require:(specifier:string)=>unknown,exports:Record<string,unknown>,module:{exports:Record<string,unknown>})=>Promise<void>;
  const visitAsync=(path:string,ancestors:ReadonlySet<string>):Promise<Record<string,unknown>>=>{
    const existing=cache.get(path);
    if(ancestors.has(path) && existing)return Promise.resolve(existing.exports);
    const running=pending.get(path);if(running)return running;
    if(existing)return Promise.resolve(existing.exports);
    const code=source.get(path);
    if(code===undefined)return Promise.reject(new Error(`Missing selected module: ${path}`));
    const module={exports:{} as Record<string,unknown>};cache.set(path,module);
    const evaluate=(async()=>{
      const compiled=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
      const original=ts.createSourceFile(path,code,ts.ScriptTarget.ES2022,true);
      const emitted=ts.createSourceFile(path+".js",compiled.outputText,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
      const staticRequires=new Set<string>();
      const collect=(node:ts.Node):void=>{
        // Dynamic import remains inside the emitted promise callback, so its
        // actual optional-peer try/catch executes rather than being preloaded.
        if(ts.isFunctionLike(node))return;
        if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text==="require" &&
          node.arguments.length===1 && ts.isStringLiteral(node.arguments[0]!))staticRequires.add(node.arguments[0]!.text);
        ts.forEachChild(node,collect);
      };
      collect(emitted);
      const lineage=new Set(ancestors);lineage.add(path);
      for(const statement of original.statements) {
        if(!((ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) ||
          (ts.isExportDeclaration(statement) && !statement.isTypeOnly)))continue;
        const specifier=statement.moduleSpecifier;
        if(!specifier || !ts.isStringLiteral(specifier) || !staticRequires.has(specifier.text))continue;
        const target=selectedPath(path,specifier.text);
        if(target!==undefined)await visitAsync(target,lineage);
      }
      const require=(specifier:string):unknown=>{
        const target=selectedPath(path,specifier);
        return target===undefined?nativeRequire(specifier):load(target);
      };
      await new AsyncFunction("require","exports","module",compiled.outputText)(require,module.exports,module);
      return module.exports;
    })();
    const result=evaluate.then(value=>{pending.delete(path);return value;},error=>{pending.delete(path);cache.delete(path);throw error;});
    pending.set(path,result);
    return result;
  };
  // Explicit boundary for selected sources that contain top-level await. The
  // synchronous loader remains available for its existing ordinary-CJS cases.
  const loadAsync=(path:string)=>visitAsync(path,new Set<string>());
  return {load,loadAsync,peer:nativeRequire};
}
