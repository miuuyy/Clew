import type { ObsidianGraphExportPackagePayload } from "./types";

export interface ClewDesktop {
  readonly apiBase: string;
  readonly sessionToken: string;
  readonly version: string;
  readonly platform: string;
  openExternal(url: string): Promise<void>;
  exportObsidian(exportPackage: ObsidianGraphExportPackagePayload): Promise<boolean>;
}

declare global {
  interface Window { clewDesktop?: ClewDesktop }
}
