import { describe, expect, it } from 'vitest';
import { designerFill } from '../../studio/lib/designer-fill';

const cell = (fill: unknown) => `---\nid: tokens.example\n---\n\n## Fill\n\n\`\`\`json\n${JSON.stringify(fill)}\n\`\`\`\n`;

describe('Designer fill projection', () => {
  it('flattens nested token groups into dotted steps and never yields an undefined value', () => {
    const fill = designerFill(cell({
      tokens: {
        ramp: {
          neutral: {
            50: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1] }, $extensions: { 'com.clossys.css': { raw: '#ffffff' } } },
            900: { $type: 'color', $value: '#111111' },
          },
          accent: { $type: 'color', $value: '#ff0000' },
          empty: { note: 'no value here' },
        },
      },
    }), 'tokens');
    expect(fill?.tokens.map(token => [token.step, token.value])).toEqual([
      ['neutral.50', '#ffffff'],
      ['neutral.900', '#111111'],
      ['accent', '#ff0000'],
    ]);
    expect(fill?.tokens.every(token => typeof token.value === 'string')).toBe(true);
  });

  it('collects inline SVG asset variants as artwork', () => {
    const fill = designerFill(cell({ assets: { mark: { positive: { $value: '<svg viewBox="0 0 1 1"></svg>' }, url: { $value: 'https://example.com/a.png' } } } }), 'assets');
    expect(fill?.artwork).toEqual([{ variant: 'positive', svg: '<svg viewBox="0 0 1 1"></svg>' }]);
  });
});
