const edit = (): void => {};
const duplicate = (): void => {};
const remove = (): void => {};

import { Menu } from "@clossys/designer/atoms";
import { Button } from "@clossys/designer/atoms";

function RowActionsMenu() {
  return (
    <Menu trigger={<Button variant="ghost">Actions</Button>}>
      <Menu.Item onAction={() => edit()}>Edit</Menu.Item>
      <Menu.Item onAction={() => duplicate()}>Duplicate</Menu.Item>
      <Menu.Separator />
      <Menu.Item onAction={() => remove()} isDestructive>
        Delete
      </Menu.Item>
    </Menu>
  );
}

export default RowActionsMenu;
