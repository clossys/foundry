import { Breadcrumb } from "@clossys/designer/atoms";

function PromptTrail() {
  return (
    <Breadcrumb>
      <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
      <Breadcrumb.Item href="/prompts">Prompts</Breadcrumb.Item>
      <Breadcrumb.Item>Untitled prompt</Breadcrumb.Item>
    </Breadcrumb>
  );
}

export default PromptTrail;
