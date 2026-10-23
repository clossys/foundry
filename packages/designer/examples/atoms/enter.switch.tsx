const save = (_enabled: boolean): void => {};

import { Switch } from "@clossys/designer/atoms";

function EmailNotificationsToggle() {
  return <Switch onChange={(isOn) => save(isOn)}>Email notifications</Switch>;
}

export default EmailNotificationsToggle;
