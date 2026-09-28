import { ErrorView } from "@clossys/publisher/web";

/** @default "Page not found" */
const title = "Page not found";
/** @default "The page you're looking for doesn't exist or has moved." */
const description = "The page you're looking for doesn't exist or has moved.";
/** @default "Back to home" */
const backToHomeLabel = "Back to home";

export default function NotFound() {
  return (
    <ErrorView
      status={404}
      title={title}
      description={description}
      action={<a href="/">{backToHomeLabel}</a>}
    />
  );
}
