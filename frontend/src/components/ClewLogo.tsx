export function ClewLogo({ size = 52, className = "" }: { size?: number; className?: string }) {
  return <svg className={`clewLogo ${className}`} width={size} height={size} viewBox="0 0 1254 1254" fill="currentColor" aria-hidden="true">
    <use href="/clew-mark.svg#clewShape" />
  </svg>;
}
