import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DetailView, type DetailViewField } from "./DetailView.js";

const FIELDS: DetailViewField[] = [
  { label: "Owner", value: "Ada Lovelace" },
  { label: "Status", value: "Active" },
];

describe("DetailView", () => {
  it("renders each field's label and value", () => {
    render(<DetailView fields={FIELDS} />);
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders as a description list: a <dl> containing a <dt>/<dd> pair per field", () => {
    const { container } = render(<DetailView fields={FIELDS} />);
    const dl = container.querySelector("dl");
    expect(dl).not.toBeNull();
    expect(dl?.querySelectorAll("dt")).toHaveLength(2);
    expect(dl?.querySelectorAll("dd")).toHaveLength(2);
    const firstDt = dl?.querySelector("dt");
    expect(firstDt?.textContent).toBe("Owner");
    expect(firstDt?.nextElementSibling?.tagName).toBe("DD");
    expect(firstDt?.nextElementSibling?.textContent).toBe("Ada Lovelace");
  });

  it("accepts an arbitrary ReactNode as a field's value, not just a string", () => {
    render(
      <DetailView
        fields={[{ label: "Owner", value: <a href="/ada">Ada Lovelace</a> }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Ada Lovelace" })).toBeInTheDocument();
  });

  it("renders the optional title as a heading", () => {
    render(<DetailView title="Order #1042" fields={FIELDS} />);
    const heading = screen.getByRole("heading", { name: "Order #1042" });
    expect(heading.tagName).toBe("H2");
  });

  it("omits the title region entirely when none is given", () => {
    render(<DetailView fields={FIELDS} />);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders the actions slot's content", () => {
    render(
      <DetailView
        title="Order #1042"
        fields={FIELDS}
        actions={<button type="button">Edit</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("omits the actions slot entirely when none is given", () => {
    render(<DetailView title="Order #1042" fields={FIELDS} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("applies a tablet-and-up column span to a field marked span: 2", () => {
    const { container } = render(
      <DetailView fields={[{ label: "Notes", value: "Long text", span: 2 }]} />,
    );
    const fieldWrapper = container.querySelector("dt")?.parentElement as HTMLElement;
    expect(fieldWrapper.className).toContain("tablet:col-span-2");
  });

  it("does not apply a column span to a field without span: 2", () => {
    const { container } = render(<DetailView fields={FIELDS} />);
    const fieldWrapper = container.querySelector("dt")?.parentElement as HTMLElement;
    expect(fieldWrapper.className).not.toContain("col-span-2");
  });

  it("stacks fields in a single column by default and two columns from the tablet breakpoint up", () => {
    const { container } = render(<DetailView fields={FIELDS} />);
    const dl = container.querySelector("dl") as HTMLElement;
    expect(dl.className).toContain("grid-cols-1");
    expect(dl.className).toContain("tablet:grid-cols-2");
  });

  it("forwards className onto the outer <section>, and the consumer's conflicting class wins the merge", () => {
    const { container } = render(<DetailView fields={FIELDS} className="gap-lg" />);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.className).toContain("gap-lg");
    expect(section.className).not.toContain("gap-md");
  });

  it("forwards a consumer style prop alongside its own", () => {
    const { container } = render(<DetailView fields={FIELDS} style={{ marginTop: "8px" }} />);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.style.marginTop).toBe("8px");
  });
});
