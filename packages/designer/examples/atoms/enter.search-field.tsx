const setQuery = (_value: string): void => {};

import { SearchField } from "@clossys/designer/atoms";

function PromptSearch() {
  return <SearchField label="Search prompts" onChange={(value) => setQuery(value)} />;
}

export default PromptSearch;
