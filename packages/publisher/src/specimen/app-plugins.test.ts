import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_PLUGINS, appPluginDirectives } from './build.js';

const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
const json = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

describe('specimen stylesheet Tailwind plugins (R2F-TYPO)', () => {
  it('loads @tailwindcss/typography, resolved from the workspace or this package', () => {
    expect(APP_PLUGINS).toEqual(['@tailwindcss/typography']);
    expect(appPluginDirectives(workspace)).toEqual(['@plugin "@tailwindcss/typography";']);
  });

  it('throws when a plugin resolves from neither, never dropping its @plugin line', () => {
    const missing = () => { throw new Error("Cannot find module '@tailwindcss/typography'"); };
    expect(() => appPluginDirectives('/nowhere', missing)).toThrow(/needs the Tailwind plugin @tailwindcss\/typography, which resolves from neither \/nowhere nor @clossys\/publisher/);
  });

  it('declares the plugin itself, at the exact version the Designer reference manifest records', () => {
    const row = json('../../../designer/references/manifest.json').packages.find((entry: { package: string }) => entry.package === '@tailwindcss/typography');
    expect(row?.version).toBe('0.5.20');
    expect(json('../../package.json').dependencies['@tailwindcss/typography']).toBe(row.version);
  });
});
