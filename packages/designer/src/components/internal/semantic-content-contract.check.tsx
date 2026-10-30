import { createRef } from "react";
import { SemanticContent, type SemanticContentProps, type SemanticContentTag } from "../SemanticContent.js";
const tag: SemanticContentTag = "h2";
const heading: SemanticContentProps<"h2"> = { as: tag, id: "title", tabIndex: -1, ref: createRef<HTMLHeadingElement>() };
<SemanticContent {...heading} />;
<SemanticContent as="time" dateTime="2026-01-01" ref={createRef<HTMLTimeElement>()} />;
<SemanticContent as="ul" ref={createRef<HTMLUListElement>()} aria-label="Items" />;
// @ts-expect-error An explicit tag is required.
<SemanticContent>Title</SemanticContent>;
// @ts-expect-error Interactive links are outside this content capability.
<SemanticContent as="a" href="/" />;
// @ts-expect-error Native time attributes do not belong to a div.
<SemanticContent as="div" dateTime="2026-01-01" />;
// @ts-expect-error A list ref cannot target a native time element.
<SemanticContent as="time" ref={createRef<HTMLUListElement>()} />;
// @ts-expect-error Document roots are outside this content capability.
<SemanticContent as="html" />;

import { SemanticContent as ServerContent, type SemanticContentProps as ServerProps } from "../server.js";
import { SemanticContent as PublicContent, type SemanticContentProps as PublicProps } from "../index.js";
const serverHeading: ServerProps<"h2"> = heading;
const publicHeading: PublicProps<"h2"> = heading;
<ServerContent {...serverHeading} />;
<PublicContent {...publicHeading} />;
// @ts-expect-error The server entry preserves native attribute discrimination.
<ServerContent as="div" dateTime="2026-01-01" />;
// @ts-expect-error The normal entry preserves the required explicit tag.
<PublicContent />;

<SemanticContent as="small" ref={createRef<HTMLElement>()} title="Annotation" />;
<SemanticContent as="dl" ref={createRef<HTMLDListElement>()} />;
<SemanticContent as="dt" ref={createRef<HTMLElement>()} id="term" />;
<SemanticContent as="dd" ref={createRef<HTMLElement>()} aria-labelledby="term" />;
// @ts-expect-error Native list numbering is not an attribute of a definition list.
<SemanticContent as="dl" start={1} />;
