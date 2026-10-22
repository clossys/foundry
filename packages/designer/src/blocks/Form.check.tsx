/** Compile-time form layout contracts; included in the package typecheck. */
import { Form } from "./Form.js";

export const defaultActions = <Form actions={<button>Save</button>}>Fields</Form>;
export const endActions = <Form actionsLayout="end" actions={<button>Save</button>}>Fields</Form>;
export const stretchActions = <Form actionsLayout="stretch" actions={<button>Save</button>}>Fields</Form>;
// @ts-expect-error actionsLayout is a closed end/stretch contract
export const unknownActions = <Form actionsLayout="unknown">Fields</Form>;
