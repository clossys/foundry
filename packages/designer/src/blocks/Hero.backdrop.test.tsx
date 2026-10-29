import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { colorAlpha, contrastRatioEncodedBlend } from "../tokens/color.js";
import { parseDeclarationsForSelector, parseRootDeclarations } from "../tokens/internal/parse-css.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { stillBackdropPolicy } from "./hero/StillBackdrop.js";
import { Hero } from "./Hero.js";
import { checkBackdropElement } from "../backdrop/contract.js";
import type { ConsumerArtContract } from "../backdrop/consumer-art.js";

const art = {
  slot: "backdrop", purpose: "decorative", alt: "", width: 1600, height: 900,
  aspect: "16:9", fit: "cover", loading: "lazy", bytes: 100_000,
  backgroundToken: "--color-surface-base", source: { format: "webp", src: "/art/still.webp" },
} as const satisfies ConsumerArtContract;
afterEach(() => vi.unstubAllGlobals());

describe("Hero checked still backdrop", () => {
  it("renders checked art behind its own message as an inert decorative layer", () => {
    const { container } = render(<Hero heading="Heading" description="Support" backdrop={art} composition="full-bleed" />);
    const layer = container.querySelector('[data-hero-backdrop]')!;
    expect(layer).not.toBeNull();
    expect(checkBackdropElement(layer)).toMatchObject({ ok: true });
    expect(layer.querySelector('img')).toHaveAttribute('src', art.source.src);
    expect(layer.querySelector('img')).toHaveAttribute('loading', 'lazy');
    expect(screen.getByRole('heading')).toHaveStyle({color:'var(--color-neutral-50)'});
    expect(screen.getByText('Support')).toHaveStyle({color:'var(--color-neutral-50)'});
    expect(container.querySelector('section')).toHaveClass('relative', 'isolate', 'overflow-hidden');
  });
  it.each([false, true])("retains the same still resource when reduced motion is %s", reduced => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener() {}, removeEventListener() {} })));
    const { container } = render(<Hero heading="Heading" backdrop={art} />);
    expect(container.querySelector('[data-hero-backdrop] img')).toHaveAttribute('src', art.source.src);
    expect(container.querySelector('video,canvas,iframe,source')).toBeNull();
  });
  it("fails closed on motion formats, eager loading and wrong placement", () => {
    for (const invalid of [{...art, loading:'eager'}, {...art,slot:'media'}, {...art,source:{format:'gif',src:'/moving.gif'}}]) {
      expect(() => render(<Hero heading="Heading" backdrop={invalid as typeof art} />)).toThrow();
    }
  });
  it("the rendered element checker rejects loss of its actual aria, pointer or focus guarantees", () => {
    const { container } = render(<Hero heading="Heading" backdrop={art} />);
    const layer = container.querySelector('[data-hero-backdrop]')!;
    expect(layer).not.toBeNull();
    layer.removeAttribute('aria-hidden');
    expect(checkBackdropElement(layer).findings).toContainEqual(expect.objectContaining({rule:'element-aria-hidden'}));
    layer.setAttribute('aria-hidden','true');
    (layer as HTMLElement).style.pointerEvents='auto';
    expect(checkBackdropElement(layer).findings).toContainEqual(expect.objectContaining({rule:'element-pointer-events'}));
    (layer as HTMLElement).style.pointerEvents='none';
    layer.appendChild(document.createElement('button'));
    expect(checkBackdropElement(layer).findings).toContainEqual(expect.objectContaining({rule:'element-focusable-descendant'}));
  });
});


const tokenCss=readFileSync(resolve(import.meta.dirname,'../../styles/tokens.css'),'utf8');
const rootTokens=parseRootDeclarations(tokenCss);
const darkTokens=new Map([...rootTokens,...parseDeclarationsForSelector(tokenCss,':root[data-theme="dark"]')]);
describe('actual Hero scrim composition',()=>{
  it('binds the conservative computed scalar scrim proof to the art declaration',()=>{
    expect(stillBackdropPolicy(art,'light').report).toMatchObject({ok:true});
    expect(()=>render(<Hero heading="Heading" backdrop={{...art,tokens:{'--color-overlay-scrim':'transparent'}} as typeof art}/>)).toThrow();
  });
  it.each(['light','strong'] as const)('%s treatment protects heading and body in both themes and section grounds',scrim=>{
    for(const ground of ['base','inverse'] as const) {
      const {container,unmount}=render(<Hero heading="Heading" description="Support" ground={ground} backdrop={art} backdropScrim={scrim}/>);
      expect(screen.getByRole('heading').style.color).toBe('var(--color-neutral-50)');
      expect(screen.getByText('Support').style.color).toBe('var(--color-neutral-50)');
      const gradient=container.querySelector('[data-hero-gradient]') as HTMLElement;
      expect(gradient.style.backgroundImage).toBe('var(--gradient-media-scrim)');
      const layers=[...container.querySelectorAll<HTMLElement>('[data-hero-scrim]')];
      expect(layers).toHaveLength(scrim==='light'?4:5);
      for(const layer of layers) expect(layer.style.backgroundColor).toBe('var(--color-overlay-scrim)');
      for(const declarations of [rootTokens,darkTokens]) {
        expect(declarations.get('--color-neutral-50')).toBeDefined();
        const alpha=colorAlpha(declarations.get('--color-overlay-scrim')!);
        expect(alpha).toBeGreaterThan(0);
        const effective=1-(1-alpha!)**layers.length;
        const ratio=contrastRatioEncodedBlend(declarations.get('--color-neutral-50')!,`oklch(0 0 0 / ${effective})`,'#ffffff');
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
      unmount();
    }
  });
  it('renders token-painted SVG as the same inert static resource',()=>{
    const vector={...art,source:{format:'svg' as const,paths:[{d:'M0 0H1600V900H0Z',fillToken:'--color-accent'}]}};
    const {container}=render(<Hero heading="Heading" backdrop={vector}/>);
    expect(container.querySelector('[data-hero-backdrop] svg')).toHaveAttribute('focusable','false');
    expect(container.querySelector('path')).toHaveAttribute('fill','var(--color-accent)');
    expect(checkBackdropElement(container.querySelector('[data-hero-backdrop]')!)).toMatchObject({ok:true});
  });
});
