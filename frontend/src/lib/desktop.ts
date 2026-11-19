import type { ObsidianGraphExportPackagePayload } from "./types";
import type { AppLocale } from "./appLocale";

export interface ClewDesktop {
  readonly apiBase: string;
  readonly sessionToken: string;
  readonly version: string;
  readonly platform: string;
  getLocale(): Promise<AppLocale>;
  setLocale(locale: AppLocale): Promise<void>;
  openExternal(url: string): Promise<void>;
  exportObsidian(exportPackage: ObsidianGraphExportPackagePayload): Promise<boolean>;
}

declare global {
  interface Window { clewDesktop?: ClewDesktop }
}
