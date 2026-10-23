import { useState } from "react";
import { NewsletterBand, type NewsletterStatus } from "@clossys/designer/blocks";

function NativeNewsletter() {
  return <section>
    <h2 id="native-newsletter">Get product updates</h2>
    <NewsletterBand
      aria-labelledby="native-newsletter"
      layout="stacked"
      action="/subscribe"
      emailLabel="Email address"
      submitLabel="Subscribe"
      pendingLabel="Subscribing"
      sentMessage="Thanks, check your inbox to confirm"
      failedMessage="Something went wrong. Try again."
      privacyNote="Read our privacy notice before signing up."
    />
  </section>;
}

function ControlledNewsletter({ subscribe }: { subscribe: (email: string) => Promise<void> }) {
  const [status, setStatus] = useState<NewsletterStatus>("idle");
  return <section>
    <h2 id="controlled-newsletter">Get product updates</h2>
    <NewsletterBand
      aria-labelledby="controlled-newsletter"
      layout="inline"
      status={status}
      name="address"
      emailLabel="Email address"
      submitLabel="Subscribe"
      pendingLabel="Subscribing"
      sentMessage="Thanks, check your inbox to confirm"
      failedMessage="Something went wrong. Try again."
      hint="Use an address where you can receive a confirmation."
      privacyNote="Read our privacy notice before signing up."
      onSubmit={email => {
        setStatus("pending");
        void subscribe(email).then(
          () => setStatus("sent"),
          () => setStatus("failed"),
        );
      }}
    />
  </section>;
}

export default function Example() { return <><NativeNewsletter /><ControlledNewsletter subscribe={async (_email: string): Promise<void> => {}} /></>; }
