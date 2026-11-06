import { expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderHeroSection } from "../runtime/sections/hero.js";
import type { SectionRenderInput } from "../runtime/sections/group-a-content.js";
import type { HeroBackdrop } from "./hero/hero-backdrop.js";
import { heroSpecimenInput } from "../studio/hero-specimen.js";
const art={slot:'backdrop',purpose:'decorative',alt:'',width:1600,height:900,aspect:'16:9',fit:'cover',loading:'lazy',bytes:100_000,backgroundToken:'--color-surface-base',source:{format:'webp',src:'/art/runtime.webp'}};
// The registered runtime input: full fill/selection/content rows and the Hero host's resolved
// Writer copy port (E5), with this test's backdrop art in the backdrop cell.
function input(members:string[],value:unknown=art):SectionRenderInput {
 return heroSpecimenInput(members, value as HeroBackdrop) as unknown as SectionRenderInput;
}
it('wires actual cell art and full-bleed/scrim members through the registered runtime renderer',()=>{
 const {container}=render(<>{renderHeroSection(input(['layout.full-bleed','backdrop.scrim.strong','ground.inverse']))}</>);
 expect(container.querySelector('[data-hero-backdrop] img')).toHaveAttribute('src','/art/runtime.webp');
 expect(container.querySelectorAll('[data-hero-scrim="strong"]')).toHaveLength(5);
 expect(container.querySelector('section')).toHaveClass('w-full','bg-surface-inverse');
});
it('refuses an invalid runtime art source rather than silently ignoring its slot',()=>{
 expect(()=>render(<>{renderHeroSection(input([], {...art,source:{format:'gif',src:'/moving.gif'}}))}</>)).toThrow(/backdrop/);
});
