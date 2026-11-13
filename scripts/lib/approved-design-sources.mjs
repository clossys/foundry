import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

const policyPath = "governance/approved-design-sources.json";
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

function exactFile(root, path) {
  if (typeof path !== "string" || !path || isAbsolute(path) || /[\\*?\[\]{}]/.test(path) || path.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("approved source provenanceFile must be an exact repository-relative file");
  }
  const full = join(root, path);
  const rel = relative(realpathSync(root), realpathSync(full));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("approved source provenanceFile escapes the repository");
  return full;
}

function forgeRepository(value) {
  if (typeof value !== "string") return null;
  const match = /^(?:https:\/\/)?github\.com\/([a-z0-9-]+\/[a-z0-9._-]+?)(?:\.git)?(?:@|\/|\s|$)/i.exec(value);
  return match?.[1].toLowerCase() ?? null;
}

/** Only this finite reviewed policy admits design sources; research is not adoption. */
export function loadApprovedDesignSources(root) {
  const file = join(root, policyPath);
  if (!existsSync(file)) return [];
  const policy = JSON.parse(readFileSync(file, "utf8"));
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.sources) || !policy.sources.length) throw new Error("invalid approved design sources policy");
  const seen = new Set();
  return policy.sources.map(entry => {
    if (!object(entry) || typeof entry.registry !== "string" || !entry.registry || typeof entry.name !== "string" || !entry.name || seen.has(entry.registry)) throw new Error("invalid or duplicate approved design source");
    seen.add(entry.registry);
    const url = new URL(entry.url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new Error("approved source URL must be credential-free HTTPS");
    const manifest = JSON.parse(readFileSync(exactFile(root, entry.provenanceFile), "utf8"));
    const registry = manifest.registries?.[entry.registry];
    const items = manifest.items?.filter(item => item.registry === entry.registry && typeof item.name === "string" && typeof item.version === "string" && /^sha256:[a-f0-9]{64}$/.test(item.hash));
    if (!object(registry) || registry.source !== entry.url || !items?.length) throw new Error("approved source has no matching adopted registry provenance");
    return {
      ...entry,
      scope: typeof registry.namespace === "string" && /^@[a-z0-9][a-z0-9._-]*$/.test(registry.namespace) ? registry.namespace.slice(1) : null,
      repository: forgeRepository(registry.upstream),
      items,
    };
  });
}

function sourceForUrl(value, source) {
  if (typeof value !== "string" || /\\|%2e|(?:^|\/)\.\.(?:\/|$)/i.test(value)) return false;
  if (source.repository && forgeRepository(value) === source.repository) return true;
  // Registry URLs must name the approved endpoint, not merely the same host.
  const prefix = source.url.split("{")[0];
  return value === source.url || value.startsWith(prefix) && prefix !== source.url;
}

/** The scanned file itself must carry explicit provenance for this source. */
export function designSourceProvenance(contents, sources) {
  const carried = new Set();
  let document;
  try { document = JSON.parse(contents); } catch { /* Source comments below also carry provenance. */ }
  const visit = value => {
    if (Array.isArray(value)) { for (const row of value) visit(row); return; }
    if (!object(value)) return;
    for (const source of sources) {
      const namedItem = source.items.some(item => value.registry === source.registry && (value.item ?? value.name) === item.name && value.version === item.version && value.hash === item.hash);
      const pinnedUrl = [value.repository, value.sourceAddress, value.url].some(url => sourceForUrl(url, source)) && (
        /^[a-f0-9]{7,40}$/.test(value.commit ?? value.pin?.commit ?? "") ||
        /^sha256:[a-f0-9]{64}$/.test(value.hash ?? "") ||
        /^[a-f0-9]{64}$/.test(value.sha256 ?? value.pin?.sha256 ?? "")
      );
      const registryRecord = object(value.registries?.[source.registry]) && value.registries[source.registry].source === source.url && Array.isArray(value.items) && value.items.some(item => source.items.some(adopted => item.registry === source.registry && item.name === adopted.name && item.version === adopted.version && item.hash === adopted.hash));
      // The policy names its exact adopting record; it does not grant any path an exemption.
      const policyRecord = value.registry === source.registry && value.url === source.url && value.provenanceFile === source.provenanceFile;
      if (namedItem || pinnedUrl || registryRecord || policyRecord) carried.add(source.registry);
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(document);
  for (const line of contents.split("\n")) {
    const comment = /^\s*(?:\/\/|\/\*+|\*)\s*(?:Provenance|Source|Upstream):\s*(.*?)(?:\s*\*\/)?$/i.exec(line);
    if (!comment) continue;
    const declaration = comment[1].trim();
    for (const source of sources) {
      const names = [source.name, source.registry, source.repository, source.scope ? `@${source.scope}` : null];
      if (names.includes(declaration) || sourceForUrl(declaration.split(/\s+/)[0], source)) carried.add(source.registry);
    }
  }
  return carried;
}

/** Provenance for one source cannot clear another source or an unrelated account. */
export function approvedDesignReference(kind, reference, carried, sources) {
  return sources.some(source => carried.has(source.registry) && (
    kind === "forge-slug" ? reference.toLowerCase() === source.repository :
      source.scope !== null && reference.toLowerCase() === `@${source.scope}`
  ));
}
