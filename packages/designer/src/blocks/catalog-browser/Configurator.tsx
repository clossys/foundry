import { Button } from "../../components/preview-runtime/components/button/button.js";
import { StockSelect } from "../stock-select.js";
import { Switch } from "../../components/Switch.js";
import { TextField } from "../../components/TextField.js";
import type { CatalogBrowserConfig, CatalogBrowserControl } from "./types.js";

/** One labelled component per control; every change reports the whole resolved configuration. */
export function Configurator({ controls, config, onChange, noControls, resetLabel }: {
  controls: readonly CatalogBrowserControl[]; config: CatalogBrowserConfig;
  onChange: (config: CatalogBrowserConfig) => void; noControls: string; resetLabel: string;
}) {
  if (!controls.length) return <p className="text-body-s text-ink-secondary">{noControls}</p>;
  const set = (id: string, value: string | boolean) => onChange({ ...config, [id]: value });
  return <div className="flex flex-col gap-md">
    {controls.map(control => {
      const value = config[control.id];
      if (control.type === "choice") {
        return <StockSelect key={control.id} label={control.label} options={control.options}
          selectedKey={typeof value === "string" ? value : control.defaultValue}
          onSelectionChange={key => { if (key !== null) set(control.id, String(key)); }} />;
      }
      if (control.type === "toggle") {
        return <Switch key={control.id} isSelected={typeof value === "boolean" ? value : control.defaultValue}
          onChange={selected => set(control.id, selected)}>{control.label}</Switch>;
      }
      return <TextField key={control.id} label={control.label}
        value={typeof value === "string" ? value : control.defaultValue} onChange={text => set(control.id, text)} />;
    })}
    <div>
      <Button variant="link" size="sm"
        onPress={() => onChange(Object.fromEntries(controls.map(control => [control.id, control.defaultValue])))}>{resetLabel}</Button>
    </div>
  </div>;
}
