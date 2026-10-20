import { RenderError } from "../../internal/errors.js";
import type { IndexViewProps } from "./IndexView.js";

/** Same client-boundary contract as SignInForm and ContactForm. */
export function IndexView<Row>(_props: IndexViewProps<Row>): never {
  throw new RenderError("wrong-channel", "IndexView is a client component and cannot render under react-server; render it from a client module.");
}
