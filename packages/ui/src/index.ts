/**
 * This file is NOT a public entry point — `package.json` deliberately
 * declares no `"."` export. Import from `@vespeneventures/ui/atoms`
 * instead; see the README for why the ladder (atoms → blocks → views) is
 * kept explicit at the import site rather than flattened through a root
 * barrel. This barrel exists only so the same names are reachable from
 * one place for internal tooling (see `scripts/check-readme-parity.mjs`
 * in the repository root, which reads `src/index.ts` as every package's
 * canonical export list); it re-exports exactly what `./atoms/index.js`
 * exports, nothing more.
 */
export { Button, TextField, Badge, Card } from "./atoms/index.js";
export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  TextFieldProps,
  BadgeProps,
  BadgeVariant,
  CardProps,
} from "./atoms/index.js";
