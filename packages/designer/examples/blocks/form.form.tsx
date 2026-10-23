import { Form, useFormValidation } from "@clossys/designer/blocks";
import { TextField, Button } from "@clossys/designer/atoms";
import { useState } from "react";

// With useFormValidation: timing, focus and pending state come from the hook.
async function sendMessage(values: { name: string; email: string; phone: string }): Promise<void> {
  // Replace with the product's own request; a failure rejects.
  if (values.email.length === 0) throw new Error("empty");
}

function ContactForm() {
  const [sendFailed, setSendFailed] = useState(false);

  const form = useFormValidation({
    initialValues: { name: "", email: "", phone: "" },
    validators: {
      name: (value) => (value.trim() === "" ? "Enter your name." : undefined),
      email: (value) => {
        if (value.trim() === "") return "Enter your email address.";
        if (!value.includes("@")) return "Enter an email address like name@example.com.";
        return undefined;
      },
    },
    onSubmit: async (values) => {
      setSendFailed(false);
      try {
        await sendMessage(values);
      } catch {
        setSendFailed(true);
      }
    },
  });

  return (
    <Form
      heading="Contact us"
      validation={form}
      errorSummaryMessage={(count) => `${count} ${count === 1 ? "field needs" : "fields need"} attention`}
      submitError={sendFailed ? "We could not send your message. Try again." : undefined}
      actions={
        <Button {...form.getSubmitButtonProps()} variant="primary">
          Send message
        </Button>
      }
    >
      <TextField label="Name" {...form.getFieldProps("name")} />
      <TextField label="Email" type="email" {...form.getFieldProps("email")} />
      <TextField label="Phone (optional)" type="tel" {...form.getFieldProps("phone")} />
    </Form>
  );
}

// Without the hook: errors come from the consumer's own validation.
function ProfileForm() {
  const [errors, setErrors] = useState<{ fieldId: string; message: string }[]>([]);

  return (
    <Form
      heading="Profile"
      errors={errors}
      errorSummaryMessage={(count) => `Fix ${count} ${count === 1 ? "field" : "fields"} to continue`}
      onSubmit={(e) => {
        e.preventDefault();
        setErrors([{ fieldId: "email", message: "Enter a valid email address." }]);
      }}
      actions={<Button type="submit">Save</Button>}
    >
      <TextField id="email" label="Email" />
    </Form>
  );
}

export default function Example() { return <><ContactForm /><ProfileForm /></>; }
