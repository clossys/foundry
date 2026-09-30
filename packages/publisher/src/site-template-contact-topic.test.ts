// @vitest-environment jsdom

/**
 * `/contact?topic=<id>` on the site template preselects a topic (#1773).
 *
 * `resolveInitialTopic` is the one place a query-string value becomes a topic,
 * so it is tested as a pure function with hostile inputs. The page and form
 * are checked by source shape (the template is built by Next.js in a consumer
 * repository, never here), and `ContactView` is rendered with the same props
 * the form builds to show the selection the visitor sees.
 *
 * Every string below is a fictional fixture.
 */

import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ContactView } from "./web/views/ContactView.js";
import {
  CONTACT_TOPICS,
  allContactPageCopyIds,
  contactViewCopy,
  contactViewTopics,
  createMapResolver,
  resolveInitialTopic,
} from "../templates/site/app/site-copy.js";

afterEach(cleanup);

const TEMPLATE_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "templates", "site");
const readTemplate = (path: string): string => readFileSync(join(TEMPLATE_DIR, path), "utf8");

const TIMEOUT = { timeout: 30_000 };

/** The body of the named function: from its opening brace to the matching closing one. */
function functionBody(source: string, name: string): string {
  const declaration = new RegExp(`function\\s+${name}\\b`).exec(source);
  if (declaration === null) throw new Error(`No function named ${name}.`);
  const open = source.indexOf("{", source.indexOf(")", declaration.index));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`Function ${name} is not closed.`);
}

describe("resolveInitialTopic", () => {
  it("accepts only a listed topic id", TIMEOUT, () => {
    expect(CONTACT_TOPICS).toHaveLength(4);
    for (const topic of CONTACT_TOPICS) expect(resolveInitialTopic(topic)).toBe(topic);
  });

  it("refuses everything else", TIMEOUT, () => {
    const refused: (string | readonly string[] | undefined)[] = [
      undefined,
      "",
      "Press",
      "PRESS",
      " press",
      "press ",
      "unknown-topic",
      ["press"],
      ["press", "product"],
      ["product", "press"],
      [],
    ];
    for (const param of refused) expect(resolveInitialTopic(param)).toBeUndefined();
  });

  it("prototype names are not topics", TIMEOUT, () => {
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(resolveInitialTopic(name)).toBeUndefined();
    }
  });

  it("never throws and only ever returns a listed topic", TIMEOUT, () => {
    const hostile: unknown[] = [null, 0, 1, true, {}, [null], [undefined], Symbol("fixture"), () => "press"];
    for (const param of hostile) {
      const result = resolveInitialTopic(param as string);
      expect(result === undefined || (CONTACT_TOPICS as readonly string[]).includes(result)).toBe(true);
    }
  });
});

describe("the contact route", () => {
  it("the client form passes the topic to the view", TIMEOUT, () => {
    const copy = Object.fromEntries(allContactPageCopyIds().map((id) => [id, `${id}~text`]));
    render(
      createElement(ContactView, {
        brand: createElement("a", { href: "/" }, "Fixture brand"),
        legal: { entity: "Fixture entity", links: [{ label: "Fixture link", href: "/terms" }], linksLabel: "Fixture links" },
        resolveCopyId: createMapResolver(copy),
        copy: contactViewCopy(),
        topics: contactViewTopics(),
        initialTopic: resolveInitialTopic("press"),
        onSubmit: async () => ({ status: "accepted" }),
      }),
    );
    const trigger = screen.getByRole("button", { name: /site\.contact\.topic-label~text/ });
    expect(trigger).toHaveTextContent("site.contact.topic.press~text");
    expect(trigger).not.toHaveTextContent("site.contact.topic-placeholder~text");

    const form = readTemplate("app/contact/contact-form.tsx");
    expect(form).toMatch(/initialTopic=\{initialTopic\}/);
  });

  it("the page reads the parameter and keeps the title topic-neutral", TIMEOUT, () => {
    const page = readTemplate("app/contact/page.tsx");
    expect(page).toMatch(/await\s+(?:props\.)?searchParams\b/);
    expect(page).toContain("resolveInitialTopic(");
    const metadata = functionBody(page, "generateMetadata");
    expect(metadata).not.toMatch(/searchParams/i);
    expect(metadata).not.toMatch(/topic/i);
  });
});
