import { Dialog, Button } from "@clossys/designer/atoms";
const deleteAccount = (): void => {};

export default function Example() { return <>
<Dialog trigger={<Button variant="secondary">Delete account</Button>}>
  {({ close }) => (
    <>
      <Dialog.Heading>Delete account?</Dialog.Heading>
      <p>This can't be undone.</p>
      <Button variant="danger" onPress={() => { deleteAccount(); close(); }}>
        Delete
      </Button>
    </>
  )}
</Dialog>
</>; }
