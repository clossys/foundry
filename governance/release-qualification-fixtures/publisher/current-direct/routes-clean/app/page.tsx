import { renderWebDocument } from "@clossys/publisher/web";
import surface from "./home.json" with { type: "json" };

export default function Page() {
  const { element } = renderWebDocument(surface, { groups: [] });
  return element;
}
