import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Testimonial as ClientTestimonial } from "./Testimonial.js";
import { Testimonial } from "./Testimonial.server.js";

describe("server Testimonial", () => {
  const props = { quote: <>A <em>clear</em> quote.</>, attributorName: "Alex Example", attributorRole: "Designer" };

  it("preserves exact client semantics, classes, text and consumer attributes without an avatar", () => {
    const consumer = { id: "quote", "data-source": "customer", className: "gap-2xl", style: { marginTop: "8px" } };
    const html = renderToStaticMarkup(<Testimonial {...props} {...consumer} />);
    expect(html).toBe(renderToStaticMarkup(<ClientTestimonial {...props} {...consumer} />));
    expect(html).toBe('<figure id="quote" data-source="customer" class="flex flex-col gap-2xl" style="margin-top:8px"><blockquote class="text-blockquote font-display text-ink-primary">A <em>clear</em> quote.</blockquote><figcaption class="flex items-center gap-sm"><div class="flex flex-col"><span class="text-body font-body font-medium text-ink-primary">Alex Example</span><span class="text-body-s text-ink-secondary">Designer</span></div></figcaption></figure>');
  });

  it("omits an absent role and avatar exactly as the client does", () => {
    const html = renderToStaticMarkup(<Testimonial {...props} attributorRole={undefined} />);
    expect(html).toBe(renderToStaticMarkup(<ClientTestimonial {...props} attributorRole={undefined} />));
    const host = document.createElement("div"); host.innerHTML = html;
    expect(host.querySelectorAll("figcaption span")).toHaveLength(1);
    expect(host.querySelector("img")).toBeNull();
  });

  it("preserves initial avatar markup, accessible name and classes", () => {
    const avatar = { avatarSrc: "/avatar.png", avatarAlt: "Alex Example" };
    const html = renderToStaticMarkup(<Testimonial {...props} {...avatar} />);
    expect(html).toBe(renderToStaticMarkup(<ClientTestimonial {...props} {...avatar} />));
    const host = document.createElement("div"); host.innerHTML = html;
    expect(host.querySelector("figcaption img")).toHaveAttribute("src", "/avatar.png");
    expect(host.querySelector("img")).toHaveAttribute("alt", "Alex Example");
    expect(host.querySelector("img")).toHaveClass("h-full", "w-full", "object-cover");
  });
});
