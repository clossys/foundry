import { PageBar, type PageBarProps } from "../PageBar.js";

const props: PageBarProps = {
  root: { label: "Workspace" },
  labels: { breadcrumb: "Trail", collapsedBreadcrumb: "Ancestors", pageInfo: "Information", pageActions: "Actions" },
};
export const stickyPageBar = <PageBar {...props} position="sticky" surface="solid" />;
export const staticPageBar = <PageBar {...props} position="static" surface="transparent" />;
// @ts-expect-error fixed is derived from glass, not a selectable position member
export const fixedPageBar = <PageBar {...props} position="fixed" />;
// @ts-expect-error position is finite vocabulary, not a boolean switch
export const booleanPageBar = <PageBar {...props} position={false} />;
// @ts-expect-error brand is not a PageBar slot; the host mark belongs to the profile Avatar
export const brandedPageBar = <PageBar {...props} brand={<span>Example</span>} />;
export const unrootedPageBar = <PageBar labels={props.labels} page={{ title: "Example" }} />;
