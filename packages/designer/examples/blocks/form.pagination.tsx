import { Pagination } from "@clossys/designer/blocks";
import { useState } from "react";

function PromptsPagination({ totalPrompts }: { totalPrompts: number }) {
  const [page, setPage] = useState(1);
  const pageSize = 25;
  return (
    <Pagination
      page={page}
      pageCount={Math.max(Math.ceil(totalPrompts / pageSize), 1)}
      onPageChange={setPage}
      totalItems={totalPrompts}
      pageSize={pageSize}
    />
  );
}

export default PromptsPagination;
export const smokeProps = { totalPrompts: 75 } satisfies React.ComponentProps<typeof PromptsPagination>;
