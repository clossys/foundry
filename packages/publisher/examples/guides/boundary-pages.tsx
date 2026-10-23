import { BoundaryView } from "@clossys/publisher/web";

export function ServerErrorPage({ reference }: { reference: string }) {
  return (
    <BoundaryView
      status={500}
      title="Something went wrong"
      description={
        <>
          Something went wrong. Error: {reference}. You can also{" "}
          <a href="/contact">contact us</a>.
        </>
      }
      action={<a href="/">Try again</a>}
    />
  );
}

export const smokeProps = { reference: "example-reference" } satisfies Parameters<typeof ServerErrorPage>[0];
export default ServerErrorPage;
