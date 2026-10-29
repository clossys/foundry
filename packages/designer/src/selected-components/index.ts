/** Selected component facade; original types remain the standalone API. */
export type * from "../components/index.js";
import { selectedComponent } from "#designer-component-selection";
import { Button as StandaloneButton, Icon as StandaloneIcon, Logomark as StandaloneLogomark, Menu as StandaloneMenu, Tooltip as StandaloneTooltip, ToggleButton as StandaloneToggleButton, Banner as StandaloneBanner, Tabs as StandaloneTabs } from "../components/index.js";
export const Button = selectedComponent("Button", StandaloneButton);
export const Icon = selectedComponent("Icon", StandaloneIcon);
export const Logomark = selectedComponent("Logo", StandaloneLogomark);
export const Menu = selectedComponent("Menu", StandaloneMenu);
export const Tooltip = selectedComponent("Tooltip", StandaloneTooltip);
export const ToggleButton = selectedComponent("ToggleButton", StandaloneToggleButton);
export const Banner = selectedComponent("Banner", StandaloneBanner);
export const Tabs = selectedComponent("Tabs", StandaloneTabs);
