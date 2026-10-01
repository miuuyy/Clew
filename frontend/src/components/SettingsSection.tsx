import React from "react";

export function SectionHead({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }): React.JSX.Element {
  return <div className="stSectionHead">
    <div>
      <div className="stEyebrow">{eyebrow}</div>
      <h3 className="stTitle">{title}</h3>
    </div>
    {action}
  </div>;
}
