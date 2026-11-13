/**
 * The site template's fresh Publisher install, shared by check:route-parity and check:routes-published
 * (`--surface site-template`). The template ships no route file: its `publish:site` script
 * (`clossys publish --install --site <publication> --next app --bind`) has Publisher write every route
 * file, the assembly, the states and the page modules from the consumer's pinned records. The checks
 * prove that over installed output: they copy a consumer (default: the producer's install-consumer
 * fixture, with the shared Designer slot documents) and the template (as `apps/site`) into a temporary
 * directory, run that same install, and read what it wrote.
 *
 * Items install through `localItemRunner` (the item's own files, nothing fetched), so a check never
 * reaches a registry. Paths in findings are `site/<file>`: the site project, template plus install.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishNext } from '../dist/publish/install-next.js';
import { localItemRunner } from '../dist/publish/install-next-bind.js';

const PRODUCER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The template, relative to a repository root. */
export const SITE_TEMPLATE = 'packages/publisher/templates/site';
/** The consumer a check installs the template for, and the publication it installs. */
export const SITE_CONSUMER = Object.freeze({
  root: path.join(PRODUCER_ROOT, 'src/publish/__fixtures__/install-consumer'),
  designerSlots: path.join(PRODUCER_ROOT, 'src/specimen/__fixtures__/designer-slots'),
  publication: 'example-site',
  selection: 'component-selection.ts',
});
/** Where the site project sits inside the consumer: the template script's `--selection ../../clossys/...` assumes it. */
export const SITE_DIR = 'apps/site';

export const posix = file => file.split(path.sep).join('/');
export function walk(directory, root = directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(file, root));
    else files.push(posix(path.relative(root, file)));
  }
  return files.sort();
}

/** Code, or a file the App Router serves by its name (metadata routes and icons): only Publisher installs these. */
export const isRouteSource = file => /\.[cm]?[jt]sx?$/.test(file)
  || /^(?:icon|apple-icon|opengraph-image|twitter-image|favicon|robots|sitemap|manifest)(?:\d+)?\.[a-z0-9]+$/.test(path.posix.basename(file));

const skipped = /(?:^|\/)(?:node_modules|\.next)(?:\/|$)/;

/**
 * Copy `consumer` and `template` into a fresh temporary directory and run the bound install there;
 * `reinstall()` reruns it as `--check`, which writes nothing and reports drift. The caller removes `scratch`.
 */
export async function installSiteTemplate({ template, consumer = SITE_CONSUMER }) {
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'site-template-')));
  const root = path.join(scratch, 'consumer');
  fs.cpSync(consumer.root, root, { recursive: true });
  if (consumer.designerSlots) fs.cpSync(consumer.designerSlots, path.join(root, 'clossys/agents/designer'), { recursive: true, force: false });
  const site = path.join(root, SITE_DIR);
  fs.mkdirSync(site, { recursive: true });
  if (fs.existsSync(template)) fs.cpSync(template, site, { recursive: true, filter: source => !skipped.test(posix(path.relative(template, source))) });
  const install = check => publishNext({
    root, publication: consumer.publication, app: path.join(site, 'app'), check, out: path.join(scratch, 'out'),
    bind: { selection: { module: path.join(root, consumer.selection) }, runner: localItemRunner },
  });
  const result = await install(false);
  return { scratch, root, site, result, reinstall: () => install(true) };
}
