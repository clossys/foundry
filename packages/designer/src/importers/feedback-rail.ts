import templates from "./feedback-rail.sources.json" with { type: "json" };
import slots from "../catalog/slots/components.json" with { type: "json" };
import adapter from "../catalog/adapters/shadcn@aria.json" with { type: "json" };
import { sha256 } from "../catalog-core/digest.js";
import { componentDescriptorHash, type ComponentCandidateDocument } from "../catalog-core/resolve-components.js";
import type { SourceBundle } from "../catalog-core/changeset-components.js";
import { rewriteShadcnAria, type RewriteResult, type SourceFile } from "./rewrite.js";

const source = "shadcn@aria", transform = "shadcn-aria-rewrite@2";
const profiles = [
  {item:"spinner", leaf:"spinner", export:"Spinner", upstream:["spinner"], parts:[], members:{"size.sm":"Spinner.size=sm","size.md":"Spinner.size=md","size.lg":"Spinner.size=lg"}},
  {item:"sonner", leaf:"toast", export:"Toaster", upstream:["sonner"], parts:["rail-feedback-copy","rail-toast-primitives","rail-toast-queue"], members:{"tone.success":"Toaster","tone.warning":"Toaster","tone.danger":"Toaster","tone.info":"Toaster",action:"Toaster",timeout:"Toaster"}},
  {item:"status-mark", leaf:"status-mark", export:"StatusMark", upstream:["badge"], parts:["rail-badge"], members:{"tone.success":"StatusMark.tone=success","tone.warning":"StatusMark.tone=warning","tone.danger":"StatusMark.tone=danger","tone.info":"StatusMark.tone=info","tone.neutral":"StatusMark.tone=neutral"}},
  {item:"grid-list", leaf:"grid-list", export:"GridList", upstream:["item"], parts:["rail-item"], members:{"layout.list":"GridList.layout=stack","layout.grid":"GridList.layout=grid",selection:"GridList"}},
] as const;
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const extensionless = (value: string): string => value.replace(/(from\s*["'])(\.[^"']+)\.js(["'])/g,"$1$2$3");

/** Owned RAC adapters reuse authenticated upstream classes; no alternate toast engine is imported. */
export function importFeedbackRail(data: {commit:string; files:readonly {item:string;path:string;content:string;sha256:string}[]}) {
  const byItem = new Map(data.files.map(file => [file.item,file]));
  const style=byItem.get("style")!, license=byItem.get("license")!;
  const fills:ComponentCandidateDocument[]=[], sourceBundles:SourceBundle[]=[], candidates=[];
  const allFiles=new Map<string,SourceFile>(), rewrites:Record<string,RewriteResult>={};
  for (const profile of profiles) {
    const tokens=new Set<string>(), assets=new Set<string>(), components=new Set<string>();
    const issues:RewriteResult["issues"][number][]=[], notes:NonNullable<RewriteResult["notes"]>[number][]=[];
    const files:SourceFile[]=[];
    const rewrite=(item:string, leaf:string, path:string, content:string) => {
      const result=rewriteShadcnAria({item,leaf,files:[{path,content}],styles:style.content,leafByItem:{checkbox:"checkbox",icon:"icon",button:"button"},transformVersion:2,retainRegistryButtonProps:true});
      result.reads.tokens.forEach(read=>tokens.add(read));result.reads.assets.forEach(read=>assets.add(read));result.reads.components.forEach(read=>components.add(read));
      issues.push(...result.issues);notes.push(...result.notes??[]);
      return result.files.map(file=>({...file,content:file.content.replace(/(_parts\/)(?!rail-)([a-z-]+)\//g,"$1rail-$2/")}));
    };
    for(const name of profile.upstream) {
      const upstream=byItem.get(name)!;
      if(!upstream) throw new Error(`feedback-rail: missing pinned ${name}`);
      if(name==="badge" || name==="item") {
        const part=rewrite(name,name,`components/_parts/rail-${name}/${name}.tsx`,upstream.content);
        if(name==="item") part[0]!.content+="\nexport { itemVariants };\n";
        if(!/import\s+(?:\*\s+as\s+React|type\s+\*\s+as\s+React)/.test(part[0]!.content) && /\bReact\./.test(part[0]!.content)) part[0]!.content='import type * as React from "react"\n'+part[0]!.content;
        files.push(...part,{path:`components/_parts/rail-${name}/index.ts`,content:`export { ${name==="badge"?"Badge":"Item"} } from "./${name}";\n`});
      }
    }
    if(profile.item==="sonner") {
      const surface=rewrite("sonner","toast","components/_parts/rail-sonner/index.ts",'export const toastClasses = "cn-toast bg-popover text-popover-foreground border border-border flex items-start gap-2 p-4";\n');
      files.push(...surface);
      tokens.add("tokens.z-index.toast");
    }
    let entry=templates.entries[profile.item];
    if(profile.item==="spinner") {tokens.add("tokens.animation.spin");assets.add("assets.icon-loader");components.add("components.icon");}
    if(profile.item==="status-mark" || profile.item==="sonner") {for(const name of ["success","warning","danger","info"]) assets.add(`assets.icon-${name}`);components.add("components.icon");}
    if(profile.item==="grid-list") components.add("components.checkbox");
    if(profile.item==="sonner") components.add("components.button");
    const entryPath=`components/${profile.leaf}/${profile.item}.tsx`;
    // Upstream's spin token and Icon size are delegated explicitly rather than remapping its size utility to spacing.
    if(profile.item==="spinner") files.push({path:entryPath,content:entry});
    else files.push(...rewrite(profile.item,profile.leaf,entryPath,extensionless(entry)));
    for(const [path,content] of Object.entries(templates.parts)) if(profile.item==="sonner" || profile.item==="spinner" && path.includes("rail-feedback-copy")) files.push({path,content:extensionless(content)});
    const utils='import { clsx, type ClassValue } from "clsx"\nimport { twMerge } from "tailwind-merge"\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }\n';
    files.push({path:"components/_parts/rail-utils/index.ts",content:utils});
    const notice="notices/SHADCN-ARIA-RAIL.md";
    files.push({path:notice,content:`# Third-party notice\n\nSource: ${adapter.pin.url}\nCommit: ${data.commit}\nTransform: ${transform}\n\n${license.content}`});
    const unique=[...new Map(files.map(file=>[file.path,file])).values()].sort((a,b)=>a.path.localeCompare(b.path));
    const pinned=[...profile.upstream.map(name=>byItem.get(name)!),style,license];
    const contract=slots.find(slot=>slot.id===`components.${profile.leaf}`)!.contract;
    const descriptor={slot:`components.${profile.leaf}`,source,root:contract.root,members:Object.keys(profile.members),props:[],propMap:profile.members,
      reads:{tokens:sorted(tokens),assets:sorted(assets),components:sorted(components)},composes:sorted(components),impl:{kind:"source",entry:entryPath,export:profile.export},license:"MIT",
      pin:{url:adapter.pin.url,commit:data.commit,files:pinned.map(({path,sha256})=>({path,sha256}))},notice,transform,item:profile.item,
      deps:[{name:"react",version:"19.3.0",license:"MIT"},{name:"react-aria-components",version:"1.21.1",license:"Apache-2.0"},{name:"class-variance-authority",version:"0.7.1",license:"Apache-2.0"},{name:"clsx",version:"2.1.1",license:"MIT"},{name:"tailwind-merge",version:"3.7.0",license:"MIT"}],
      parts:profile.parts.map(item=>({item})),outputSha256:unique.map(({path,content})=>({path,sha256:sha256(content)})),blockers:issues,rac:{instance:"react-aria-components",range:"^1.21.1",peer:false}};
    const original=byItem.get(profile.upstream[0])!;
    const document={$extensions:{"com.clossys.fill":{id:`${source}/components.${profile.leaf}`,slot:`components.${profile.leaf}`,source,mode:"implementation",sourceAddress:`${adapter.pin.url}/blob/${data.commit}/${original.path}`,relation:"same-contract",builtOn:sorted(components),conforms:[],evidence:[],author:"third-party",trust:"pinned-upstream",license:"MIT",status:"draft",pin:{url:adapter.pin.url,commit:data.commit,sha256:original.sha256},unmapped:[]}},components:{[profile.leaf]:descriptor}} as unknown as ComponentCandidateDocument;
    fills.push(document);const descriptorHash=componentDescriptorHash(Object.values(document.components)[0]!);
    const upstreamFiles=pinned.map(({path,content})=>({path,content}));
    if(!issues.length) sourceBundles.push({slot:descriptor.slot,descriptorHash,transform,upstream:upstreamFiles,files:unique,blockers:[]});
    candidates.push({fill:`${source}/${descriptor.slot}`,slot:descriptor.slot,descriptorHash,transform,upstreamFiles,outputFiles:unique,blockers:issues,status:issues.length?"blocked" as const:"ready" as const});
    rewrites[profile.item]={transform,files:unique,outputSha256:descriptor.outputSha256,reads:descriptor.reads,parts:profile.parts,issues,notes};
    for(const file of unique) {const previous=allFiles.get(file.path);if(previous && previous.content!==file.content) throw new Error(`feedback-rail: conflicting output ${file.path}`);allFiles.set(file.path,file);}
  }
  return {fills,sourceBundles,candidates,rewrites,files:[...allFiles.values()]};
}
