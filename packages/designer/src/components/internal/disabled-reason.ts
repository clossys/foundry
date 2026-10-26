import { useId } from "react";

/** Host-provided description inputs; this helper supplies no message or rendering. */
interface DisabledReasonInputs {
  isDisabled?: boolean;
  disabledReason?: string;
  "aria-describedby"?: string;
}

/** Internal wiring only: callers render the host reason with the returned id. */
export function useDisabledReason({ isDisabled, disabledReason, "aria-describedby": describedBy }: DisabledReasonInputs): {
  reasonId?: string;
  "aria-describedby"?: string;
} {
  const id = useId();
  const reasonId = isDisabled && disabledReason?.trim() ? id : undefined;
  const descriptions = [...new Set([...(describedBy?.trim().split(/\s+/).filter(Boolean) ?? []), ...(reasonId ? [reasonId] : [])])];
  return { reasonId, "aria-describedby": descriptions.length ? descriptions.join(" ") : undefined };
}
