/** Selected component facade; original types remain the standalone API. */
export type * from "../components/Toast.js";
import { selectedComponent } from "#designer-component-selection";
import { Toast as StandaloneToast, ToastContent as StandaloneToastContent, ToastRegion as StandaloneToastRegion, ToastText as StandaloneToastText } from "../components/Toast.js";
export const Toast = selectedComponent("Toast", StandaloneToast);
export const ToastContent = selectedComponent("ToastContent", StandaloneToastContent);
export const ToastRegion = selectedComponent("ToastRegion", StandaloneToastRegion);
export const ToastText = selectedComponent("ToastText", StandaloneToastText);
