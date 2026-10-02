import React from "react";

/**
 * Brand loader that traces the Clew logo path and reveals waypoint dots in sequence.
 * Size scales via `size`; the theme sets the logo color through `currentColor`.
 */

let uidCounter = 0;
function nextUid(): string {
  uidCounter += 1;
  return `clewLoader-${uidCounter}`;
}

export function ClewLoader({ size = 48, label = "Loading" }: { size?: number; label?: string }): React.JSX.Element {
  // Stable unique ids prevent multiple loaders from colliding in SVG defs.
  const idRef = React.useRef<string | null>(null);
  if (!idRef.current) idRef.current = nextUid();
  const maskId = `${idRef.current}-mask`;
  return (
    <span className="clewChatLoader" role="status" aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox="0 0 1254 1254" aria-hidden="true">
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x={-500} y={-500} width={2254} height={2254}>
            <rect x={-500} y={-500} width={2254} height={2254} fill="black" />
            <use href="/clew-mark.svg#clewShape" className="clewLaunchMaskStroke" />
          </mask>
        </defs>
        <use href="/clew-mark.svg#clewShape" className="clewLaunchFillPath" mask={`url(#${maskId})`} />
      </svg>
    </span>
  );
}
