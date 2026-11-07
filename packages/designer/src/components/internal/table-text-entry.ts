import { useContext, useEffect, useRef } from "react";
import { TableStateContext } from "react-aria-components";

/**
 * Inside a react-aria-components Table cell, the grid captures ArrowUp/ArrowDown for row navigation before a
 * text-entry control sees them, so a date segment cannot step its value and a caret cannot move. While this field
 * holds focus it pauses the enclosing table's keyboard navigation and restores it on blur or unmount; outside a
 * table it only forwards the caller's own `onFocusChange`.
 */
export function useTableTextEntry(onFocusChange?: (isFocused: boolean) => void): (isFocused: boolean) => void {
  // The table state object is rebuilt on every render; its setter is a stable useState setter, so the restore
  // runs only on unmount or when the field moves to another table.
  const setDisabled = useContext(TableStateContext)?.setKeyboardNavigationDisabled;
  const paused = useRef(false);
  useEffect(() => () => {
    if (!paused.current) return;
    paused.current = false;
    setDisabled?.(false);
  }, [setDisabled]);
  return isFocused => {
    if (setDisabled && paused.current !== isFocused) {
      paused.current = isFocused;
      setDisabled(isFocused);
    }
    onFocusChange?.(isFocused);
  };
}
