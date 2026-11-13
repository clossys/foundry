import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildWiring } from '../../src/pipeline/wiring';
import { studioHomeId, studioPages } from '../generated/studio-map';
import { homeDecisions, homePipeline } from './home-inputs';
import type { PipelineWiringFile } from './pipeline-flow';
import { studioCopy } from './studio-copy';
import { studioReports } from './studio-report';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const head = { title: 'Home' };

describe('Home (owner P3/P4): decisions, then the agents, then the pipeline', () => {
  it('places the pinned page.home sections in that order, each fed by its own loader field', () => {
    const home = studioPages.find(page => page.id === studioHomeId);
    expect(home?.path).toBe('/');
    expect(home?.data.loader).toBe('home');
    expect(home?.sectionIds).toEqual([
      'sections.studio.page-header',
      'sections.module.checks',
      'sections.studio.home',
      'sections.producer.team-strip',
      'sections.producer.pipeline-legend',
      'sections.producer.pipeline-flow',
    ]);
    expect(home?.inputs).toEqual({
      'sections.studio.page-header': 'header', 'sections.module.checks': 'checks', 'sections.studio.home': 'home',
      'sections.producer.team-strip': 'team', 'sections.producer.pipeline-legend': 'legend', 'sections.producer.pipeline-flow': 'flow',
    });
  });

  it('reads the decisions from the open needs Studio loads, and nothing else', () => {
    // A Producer config without a Designer selection, with a theme note (info) and an agent compile error:
    // only the selection need waits on the owner.
    const reports = studioReports({ theme: { source: 'foundry' }, compilation: [{ agent: 'writer', state: 'error' }] });
    expect(reports.map(report => report.id)).toEqual(['selection', 'theme', 'compile:writer']);
    const decisions = homeDecisions(reports);
    expect(decisions.summary).toBe(studioCopy('studio.page-attention-count', { count: 1 }));
    expect(decisions.groups.map(group => group.id)).toEqual(['failing', 'needs']);
    expect(decisions.groups.flatMap(group => group.rows.map(row => row.id))).toEqual(['selection']);
    expect(decisions.groups[1]!.rows[0]).toMatchObject({ title: studioCopy('studio.designer-selection-unavailable'), tone: 'outline' });
  });

  it('says nothing is waiting when no need is open, never a made-up row', () => {
    const decisions = homeDecisions([]);
    expect(decisions.summary).toBe(studioCopy('studio.nothing-is-waiting-on-you'));
    expect(decisions.groups.every(group => group.rows.length === 0)).toBe(true);
  });

  it('feeds the pipeline sections from the Producer wiring, and none before it loads', () => {
    expect(homePipeline(undefined, head, '/')).toEqual({});
    const wiring = buildWiring(repoRoot, { runs: [] }) as unknown as PipelineWiringFile;
    const pipeline = homePipeline(wiring, head, '/');
    expect(Object.keys(pipeline).sort()).toEqual(['flow', 'legend', 'team']);
    expect(pipeline.flow!.graph.nodes.map(node => node.id)).toEqual(wiring.nodes.map(node => node.id));
    // Team cards link back to Home, which now carries the pipeline.
    expect(pipeline.team!.cards.length).toBeGreaterThan(0);
    expect(pipeline.team!.cards.every(card => card.href.startsWith('/?seat='))).toBe(true);
  });
});
