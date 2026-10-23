import { FieldGroup } from "@clossys/designer/blocks";
import { TextField } from "@clossys/designer/atoms";

function ShippingAddressGroup() {
  return (
    <FieldGroup
      legend="Shipping address"
      description="Used for delivery only."
      layout="multi"
    >
      <TextField label="Street" />
      <TextField label="City" />
    </FieldGroup>
  );
}

export default ShippingAddressGroup;
