import { AppNavigation, getAppNavigationBreadcrumbs, type AppNavigationNode } from "@clossys/designer/blocks";
import { Button } from "@clossys/designer/atoms";

const navigation: readonly AppNavigationNode[] = [
  { id: "catalogs", label: "Catalogs", href: "/catalogs", children: [
    { id: "blocks", label: "Blocks", href: "/catalogs/blocks" },
  ] },
];

export function NavigationExample() {
  const crumbs = getAppNavigationBreadcrumbs(navigation, { id: "blocks" });
  return <AppNavigation tree={navigation} activeId={crumbs.at(-1)?.id}
    footer={<Button variant="ghost">Example profile</Button>} />;
}

export default NavigationExample;
