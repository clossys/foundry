/** Test lookups over canvas boards: each is the registered library-board Section inside its structural wrapper. */
import { boardRowLeaf } from "../canvas-boards.js";

/** Every rendered library-board Section under a root. */
export const boardSections = (root: ParentNode = document): HTMLElement[] => [...root.querySelectorAll<HTMLElement>("section[data-library-board]")];
/** A board's row for one leaf (view table row or edit matrix row). */
export const boardRow = (leaf: string, root: ParentNode = document): HTMLElement | undefined =>
  [...root.querySelectorAll<HTMLElement>("section[data-library-board] tr")].find(row => boardRowLeaf(row) === leaf);
/** The library-board Section that holds a leaf, in either mode. */
export const boardOf = (leaf: string, root: ParentNode = document): HTMLElement | undefined =>
  boardSections(root).find(board => boardRow(leaf, board) !== undefined || [...board.querySelectorAll("h4")].some(heading => heading.textContent === leaf));
/** A leaf's place on a board in either mode: its table row, or (a sections or frames board in edit mode) its headed item. */
export const boardItem = (leaf: string, root: ParentNode = document): HTMLElement | undefined =>
  boardRow(leaf, root) ?? [...root.querySelectorAll<HTMLElement>("section[data-library-board] section[aria-label]")].find(item => item.querySelector("h4")?.textContent === leaf || item.getAttribute("aria-label") === leaf);
