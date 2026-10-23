const people: { id: string; name: string }[] = [{ id: "one", name: "Example User" }];
const setAssignee = (_id: string | number | null): void => {};

import { ComboBox } from "@clossys/designer/atoms";

function AssigneeField() {
  return (
    <ComboBox
      label="Assignee"
      placeholder="Search people"
      options={people.map((p) => ({ id: p.id, label: p.name }))}
      onChange={(id) => setAssignee(id)}
    />
  );
}

export default AssigneeField;
