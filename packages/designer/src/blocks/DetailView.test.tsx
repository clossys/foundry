import { renderToStaticMarkup as renderS4Server } from "react-dom/server";
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

it("S4-3 preserves title presence, titleless trailing actions and original section attributes", () => {
  let clicks = 0;
  const view = render(<DetailView id="record" dir="rtl" data-host="record" className="gap-lg" style={{ marginTop: 9 }} onClick={() => clicks++} fields={FIELDS} actions={<button>Edit</button>} />);
  const root = view.container.firstElementChild as HTMLElement;
  expect(root.tagName).toBe("SECTION");
  expect(root).toHaveAttribute("id", "record");
  expect(root).toHaveAttribute("dir", "rtl");
  expect(root.style.marginTop).toBe("9px");
  expect(root).toHaveClass("gap-lg");
  expect(root.querySelector("h2")).toBeNull();
  expect(view.getByRole("button").parentElement).toHaveClass("ms-auto");
  root.click(); expect(clicks).toBe(1);
  for (const title of [null, false, 0]) {
    view.rerender(<DetailView fields={FIELDS} title={title} />);
    expect(view.container.querySelectorAll("h2")).toHaveLength(1);
    expect(view.container.querySelector("h2")?.textContent).toBe(title === 0 ? "0" : "");
  }
  for (const actions of [null, false, 0]) {
    view.rerender(<DetailView fields={FIELDS} actions={actions} />);
    expect(view.container.firstElementChild?.firstElementChild?.querySelector(".ms-auto")).not.toBeNull();
  }
});

it("S4 server-renders the supplied title through the real shared Header", () => {
  const markup = renderS4Server(<DetailView title="Title" fields={FIELDS} />);
  expect(markup).toContain("<h2");
  expect(markup).toContain("Title</h2>");
});
