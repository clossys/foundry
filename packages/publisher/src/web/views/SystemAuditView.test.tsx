import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SystemAuditView } from "./SystemAuditView.js";

describe("SystemAuditView", () => {
  it("names the gallery link and sections from message props", () => {
    const html = renderToStaticMarkup(
      <SystemAuditView
        title="Audit"
        galleryHref="/gallery"
        brandOk
        brandFindings={[]}
        contrastFindings={[]}
        galleryLabel="Galería"
        brandSectionLabel="Archivo de marca"
        contrastLabel="Contraste"
      />,
    );
    expect(html).toContain(">Galería</a>");
    expect(html).toContain('aria-label="Archivo de marca"');
    expect(html).toContain('aria-label="Contraste"');
  });

  it("reads the coverage status from coverageDescription", () => {
    const html = renderToStaticMarkup(
      <SystemAuditView
        title="Audit"
        galleryHref="/gallery"
        brandOk={false}
        brandFindings={[]}
        contrastFindings={[]}
        coverageDescription={() => "Cobertura de marca fallida."}
      />,
    );
    expect(html).toContain("Cobertura de marca fallida.");
    expect(html).not.toContain("Brand file coverage failed.");
  });
});
