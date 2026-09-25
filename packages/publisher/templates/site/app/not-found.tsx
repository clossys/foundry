import { ErrorView } from "@clossys/publisher/web";

export default function NotFound() {
  return (
    <ErrorView
      status={404}
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      action={<a href="/">Back to home</a>}
    />
  );
}
