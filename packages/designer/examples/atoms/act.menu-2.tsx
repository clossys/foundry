import { Menu, Button } from "@clossys/designer/atoms";
const edit = (): void => {};

export default function Example() { return <>
<Menu trigger={<Button aria-label="More actions">⋯</Button>}>
  <Menu.Item onAction={() => edit()}>Edit</Menu.Item>
</Menu>
</>; }
