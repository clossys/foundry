import {
  STANDARD_WEBSITE_INSTANCES,
  STANDARD_WEBSITE_PACK,
  validateInstanceRecords,
} from "@clossys/publisher/core";

const result = validateInstanceRecords(
  STANDARD_WEBSITE_INSTANCES,
  [STANDARD_WEBSITE_PACK],
);
if (result.status === "refused") console.error(result.reason, result.path);
