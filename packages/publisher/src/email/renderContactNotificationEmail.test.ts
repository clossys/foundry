import { describe, expect, it } from "vitest";
import { renderContactNotificationEmail } from "./renderContactNotificationEmail.js";

const DOMAIN = "example.com";

/** Sentinel whose contents leak under String(), JSON.stringify and interpolation. */
const MARK = "ZZ-MARK-77";

const full = {
  topic: "general",
  name: "Ada Lovelace",
  email: `ada@${DOMAIN}`,
  phone: "+1 (555) 010-0100",
  message: "Hello there.\nSecond line.",
} as const;

const withoutPhone = {
  topic: full.topic,
  name: full.name,
  email: full.email,
  message: full.message,
} as const;

// Captured from the pre-change handler's plain-text builder, before wiring.
const TEXT_WITH_PHONE = [
  "Topic: general",
  "Name: Ada Lovelace",
  `Email: ada@${DOMAIN}`,
  "Phone: +1 (555) 010-0100",
  "",
  "Hello there.",
  "Second line.",
].join("\n");

const TEXT_WITHOUT_PHONE = [
  "Topic: general",
  "Name: Ada Lovelace",
  `Email: ada@${DOMAIN}`,
  "",
  "Hello there.",
  "Second line.",
].join("\n");

const CELL = "padding:6px 12px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;";
const HEAD = `${CELL}font-weight:bold;text-align:left;vertical-align:top;`;
const BODY_CELL = `${CELL}vertical-align:top;`;
const MESSAGE_CELL = `${CELL}white-space:pre-wrap;`;

function row(label: string, value: string): string {
  return `<tr><th scope="row" style="${HEAD}">${label}</th><td style="${BODY_CELL}">${value}</td></tr>`;
}

function golden(rows: string[]): string {
  return [
    "<!DOCTYPE html>",
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body style="margin:0;padding:16px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tbody>',
    ...rows,
    `<tr><th scope="row" colspan="2" style="${HEAD}">Message</th></tr>`,
    `<tr><td colspan="2" style="${MESSAGE_CELL}">Hello there.<br>Second line.</td></tr>`,
    "</tbody></table>",
    "</body></html>",
  ].join("");
}

const HTML_WITH_PHONE = golden([
  row("Topic", "general"),
  row("Name", "Ada Lovelace"),
  row("Email", `ada@${DOMAIN}`),
  row("Phone", "+1 (555) 010-0100"),
]);

const HTML_WITHOUT_PHONE = golden([row("Topic", "general"), row("Name", "Ada Lovelace"), row("Email", `ada@${DOMAIN}`)]);

function tags(html: string): string[] {
  return html.match(/<[^>]*>/g) ?? [];
}

function refusal(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    return (error as TypeError).message;
  }
  throw new Error("expected a throw");
}

describe("golden bytes", () => {
  it("renders the exact html and text for a full submission", () => {
    expect(renderContactNotificationEmail(full)).toStrictEqual({ html: HTML_WITH_PHONE, text: TEXT_WITH_PHONE });
  });

  it("omits the phone row and line when phone is absent", () => {
    expect(renderContactNotificationEmail(withoutPhone)).toStrictEqual({
      html: HTML_WITHOUT_PHONE,
      text: TEXT_WITHOUT_PHONE,
    });
    expect(renderContactNotificationEmail({ ...withoutPhone, phone: undefined }).text).toBe(TEXT_WITHOUT_PHONE);
  });

  it("renders the same bytes on every call", () => {
    expect(renderContactNotificationEmail(full)).toStrictEqual(renderContactNotificationEmail(full));
  });

  it("turns CRLF, lone CR and LF in the message into br after escaping, and leaves text untouched", () => {
    const message = "a\r\nb\rc\nd";
    const rendered = renderContactNotificationEmail({ ...full, message });
    expect(rendered.html).toContain(">a<br>b<br>c<br>d</td>");
    expect(rendered.text.endsWith(`\n\n${message}`)).toBe(true);
  });

  it("keeps a tab in the message and never produces a raw newline in the message cell", () => {
    const rendered = renderContactNotificationEmail({ ...full, message: "a\tb\nc" });
    expect(rendered.html).toContain(">a\tb<br>c</td>");
  });
});

describe("labels", () => {
  it("uses the documented English defaults", () => {
    const rendered = renderContactNotificationEmail(full, { labels: {} });
    expect(rendered).toStrictEqual(renderContactNotificationEmail(full));
  });

  it("uses a supplied label in both bodies", () => {
    const rendered = renderContactNotificationEmail(full, {
      labels: { topic: "T", name: "N", email: "E", phone: "P", message: "M" },
    });
    expect(rendered.text).toBe(
      ["T: general", "N: Ada Lovelace", `E: ada@${DOMAIN}`, "P: +1 (555) 010-0100", "", "Hello there.", "Second line."].join(
        "\n",
      ),
    );
    expect(rendered.html).toContain(row("T", "general"));
    expect(rendered.html).toContain(">M</th>");
  });

  it("escapes a label exactly once", () => {
    const rendered = renderContactNotificationEmail(full, { labels: { name: `<b>&"'` } });
    expect(rendered.html).toContain("&lt;b&gt;&amp;&quot;&#39;</th>");
    expect(rendered.html).not.toContain("<b>");
  });

  it("refuses a non-string label without echoing it", () => {
    for (const label of ["topic", "name", "email", "phone", "message"] as const) {
      for (const bad of [7 as unknown as string, { toString: () => MARK }, [MARK], { leaked: MARK }]) {
        const message = refusal(() => renderContactNotificationEmail(full, { labels: { [label]: bad } }));
        expect(message).toContain(`labels.${label}`);
        expect(message).not.toContain(MARK);
      }
    }
  });

  it("refuses a non-string field without echoing it", () => {
    for (const field of ["topic", "name", "email", "phone", "message"] as const) {
      for (const bad of [7 as unknown as string, { toString: () => MARK }, [MARK], { leaked: MARK }]) {
        const message = refusal(() => renderContactNotificationEmail({ ...full, [field]: bad } as never));
        expect(message).toContain(field);
        expect(message).not.toContain(MARK);
      }
    }
  });

  it("refuses every C1 control character in each single-line field", () => {
    for (const field of ["topic", "name", "email", "phone"] as const) {
      for (let code = 0x80; code <= 0x9f; code += 1) {
        const message = refusal(() =>
          renderContactNotificationEmail({ ...full, [field]: `${MARK}${String.fromCharCode(code)}${MARK}` }),
        );
        expect(message).toContain(field);
        expect(message).not.toContain(MARK);
      }
    }
  });

  it("refuses an options value that is not an object, and a labels value that is not an object", () => {
    expect(() => renderContactNotificationEmail(full, null as never)).toThrow(TypeError);
    expect(() => renderContactNotificationEmail(full, "x" as never)).toThrow(TypeError);
    expect(() => renderContactNotificationEmail(full, { labels: "x" as never })).toThrow(TypeError);
    expect(() => renderContactNotificationEmail(full, { labels: null as never })).toThrow(TypeError);
  });
});

describe("untrusted input escaping", () => {
  const hostile = [
    "<script>alert(1)</script>",
    '"><img src=x onerror=y>',
    "&lt;",
    `a "double" and 'single' quotes`,
    "<!--[if mso]>",
    "-->",
    "]]>",
    "javascript:alert(1)",
  ];
  const singleLineFields = ["topic", "name", "email", "phone"] as const;

  for (const field of [...singleLineFields, "message"] as const) {
    for (const value of hostile) {
      it(`keeps the tag sequence fixed for ${JSON.stringify(value)} in ${field}`, () => {
        const benign = renderContactNotificationEmail(full);
        // A message keeps its second line so the benign and hostile renders share one line count (one `br`).
        const submitted = field === "message" ? `${value}\nSecond line.` : value;
        const rendered = renderContactNotificationEmail({ ...full, [field]: submitted });
        expect(tags(rendered.html)).toStrictEqual(tags(benign.html));
        expect(rendered.html).not.toMatch(/<a[\s>]/i);
        expect(rendered.html).not.toMatch(/<img/i);
        expect(rendered.html).not.toMatch(/<script/i);
        expect(rendered.html).not.toContain("<!--");
        expect(rendered.html).not.toMatch(/<[^>]*\s(href|src)=/i);
      });
    }
  }

  it("escapes every HTML-significant character exactly once", () => {
    const rendered = renderContactNotificationEmail({ ...full, name: `&lt; <>"'` });
    expect(rendered.html).toContain(row("Name", "&amp;lt; &lt;&gt;&quot;&#39;"));
  });

  it("does not turn a submitted address or url into a link or a remote reference", () => {
    const rendered = renderContactNotificationEmail({
      ...full,
      message: "see https://example.com/x and mailto:a@example.com",
    });
    expect(rendered.html).not.toMatch(/<a[\s>]/i);
    expect(rendered.html).not.toMatch(/\s(href|src|background)=/i);
    expect(rendered.html).not.toMatch(/url\(/i);
  });

  it("puts the submitted values only in text nodes", () => {
    const rendered = renderContactNotificationEmail({ ...full, message: 'x" onmouseover="y\nSecond line.' });
    expect(tags(rendered.html)).toStrictEqual(tags(renderContactNotificationEmail(full).html));
    expect(rendered.html).toContain("x&quot; onmouseover=&quot;y");
  });

  it("leaves text unescaped, exactly as the handler wrote it before", () => {
    const rendered = renderContactNotificationEmail({ ...full, name: "<b>&</b>" });
    expect(rendered.text).toContain("Name: <b>&</b>\n");
  });

  it.each([
    ["topic", "Topic"],
    ["name", "Name"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["message", null],
  ] as const)("leaves text unescaped for every field ($0)", (field, label) => {
    const rendered = renderContactNotificationEmail({ ...full, [field]: "<b>&</b>" });
    if (label === null) {
      expect(rendered.text.endsWith("\n\n<b>&</b>")).toBe(true);
    } else {
      expect(rendered.text).toContain(`${label}: <b>&</b>\n`);
    }
  });
});

describe("refusals", () => {
  const singleLine = ["topic", "name", "email", "phone"] as const;
  const separators: readonly [string, string][] = [
    ["CR", "\r"],
    ["LF", "\n"],
    ["NUL", "\u0000"],
    ["U+0085", "\u0085"],
    ["U+2028", " "],
    ["U+2029", " "],
    ["TAB", "\t"],
    ["DEL", "\u007f"],
  ];
  const MARK = "ZZ-MARK-77";

  for (const field of singleLine) {
    for (const [name, character] of separators) {
      it(`refuses ${name} in ${field} without echoing the value`, () => {
        const message = refusal(() => renderContactNotificationEmail({ ...full, [field]: `${MARK}${character}${MARK}` }));
        expect(message).toContain(field);
        expect(message).not.toContain(MARK);
      });
    }
  }

  for (const label of ["topic", "name", "email", "phone", "message"] as const) {
    for (const [name, character] of separators) {
      it(`refuses ${name} in labels.${label} without echoing the value`, () => {
        const message = refusal(() =>
          renderContactNotificationEmail(full, { labels: { [label]: `${MARK}${character}${MARK}` } }),
        );
        expect(message).toContain(`labels.${label}`);
        expect(message).not.toContain(MARK);
      });
    }
  }

  it("accepts tab, LF and CR in message", () => {
    expect(() => renderContactNotificationEmail({ ...full, message: "a\tb\nc\rd" })).not.toThrow();
  });

  it("refuses NUL and every other Cc character in message", () => {
    for (let code = 0; code <= 0x9f; code += 1) {
      if (code > 0x1f && code < 0x7f) continue;
      const character = String.fromCharCode(code);
      const allowed = code === 0x09 || code === 0x0a || code === 0x0d;
      const call = () => renderContactNotificationEmail({ ...full, message: `${MARK}${character}` });
      if (allowed) expect(call).not.toThrow();
      else expect(refusal(call)).not.toContain(MARK);
    }
  });

  it("accepts U+2028 and U+2029 in message, as the handler does", () => {
    expect(() => renderContactNotificationEmail({ ...full, message: "a b c" })).not.toThrow();
  });

  it("refuses a non-string field, naming it and never the value", () => {
    for (const field of ["topic", "name", "email", "phone", "message"] as const) {
      for (const bad of [7, null, {}, [], true, Symbol("x")]) {
        const message = refusal(() => renderContactNotificationEmail({ ...full, [field]: bad } as never));
        expect(message).toContain(field);
      }
    }
  });

  it("refuses a missing required field", () => {
    for (const field of ["topic", "name", "email", "message"] as const) {
      const input: Record<string, unknown> = { ...full };
      delete input[field];
      expect(refusal(() => renderContactNotificationEmail(input as never))).toContain(field);
    }
  });

  it("refuses an input that is not an object", () => {
    for (const bad of [undefined, null, "x", 7, []]) {
      expect(() => renderContactNotificationEmail(bad as never)).toThrow(TypeError);
    }
  });

  it("reads only own properties", () => {
    const input = Object.create({ ...full }) as never;
    expect(() => renderContactNotificationEmail(input)).toThrow(TypeError);
  });

  it("ignores unknown keys", () => {
    const rendered = renderContactNotificationEmail({ ...full, html: "<b>x</b>", extra: "ZZ" } as never);
    expect(rendered).toStrictEqual(renderContactNotificationEmail(full));
  });
});
