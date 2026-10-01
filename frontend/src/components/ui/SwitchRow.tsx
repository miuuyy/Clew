import React from "react";

/** A labelled on/off row. The whole row toggles; the switch carries the state for assistive tech. */
export function SwitchRow({ title, help, checked, onChange }: {
  title: React.ReactNode;
  help?: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <label className="uiSwitchRow" htmlFor={id}>
      <span className="uiSwitchRowCopy">
        <span className="uiSwitchRowTitle">{title}</span>
        {help ? <span className="uiHelp">{help}</span> : null}
      </span>
      <button id={id} className={`uiSwitch${checked ? " uiSwitchOn" : ""}`} onClick={() => onChange(!checked)} type="button" role="switch" aria-checked={checked}>
        <span />
      </button>
    </label>
  );
}
