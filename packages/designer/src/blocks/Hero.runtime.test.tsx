import { expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderHeroSection, heroInputs } from "../runtime/sections/hero.js";
import type { SectionRenderInput } from "../runtime/sections/group-a-content.js";
const art={slot:'backdrop',purpose:'decorative',alt:'',width:1600,height:900,aspect:'16:9',fit:'cover',loading:'lazy',bytes:100_000,backgroundToken:'--color-surface-base',source:{format:'webp',src:'/art/runtime.webp'}};
function input(members:string[],value:unknown=art):SectionRenderInput {
 return {fill:{leaf:'sections.hero',slots:heroInputs.slots,members:heroInputs.members},selection:{leaf:'sections.hero',members},content:{header:{value:{heading:'Runtime heading'}},backdrop:{value}}} as unknown as SectionRenderInput;
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
