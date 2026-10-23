function SignaturePad(props: React.ComponentProps<"canvas">) { return <canvas {...props} />; }

import { Field } from "@clossys/designer/atoms";

function SignatureField() {
  return (
    <Field label="Signature" description="Draw your signature below.">
      {(fieldProps) => <SignaturePad {...fieldProps} />}
    </Field>
  );
}

export default SignatureField;
