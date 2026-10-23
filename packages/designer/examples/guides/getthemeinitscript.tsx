import { getThemeInitScript, getStoredThemeInitScript } from "@clossys/designer/theme";

export default function Example() { return <>
<script dangerouslySetInnerHTML={{ __html: getThemeInitScript() }} />
</>; }
export { getStoredThemeInitScript };
