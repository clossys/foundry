import { RenderError } from "../../internal/errors.js";
import type { DetailsViewProps } from "./DetailsView.js";

/** Same client-boundary contract as SignInForm and ContactForm. */
export function DetailsView(_props: DetailsViewProps): never {
  throw new RenderError("wrong-channel", "DetailsView is a client component and cannot render under react-server; render it from a client module.");
}
