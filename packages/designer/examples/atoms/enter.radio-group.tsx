import { RadioGroup } from "@clossys/designer/atoms";

function DeliverySpeedField() {
  return (
    <RadioGroup label="Delivery speed" defaultValue="standard">
      <RadioGroup.Radio value="standard">Standard</RadioGroup.Radio>
      <RadioGroup.Radio value="express" description="Arrives in 2 days.">
        Express
      </RadioGroup.Radio>
      <RadioGroup.Radio value="overnight" isDisabled>
        Overnight (unavailable in your area)
      </RadioGroup.Radio>
    </RadioGroup>
  );
}

export default DeliverySpeedField;
