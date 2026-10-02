import type { ObsidianGraphExportPackagePayload } from "./types";

type DirectoryPickerWindow = Window & typeof globalThis & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};

export function supportsObsidianDirectoryExport(): boolean {
  return typeof window !== "undefined" && (!!window.clewDesktop || typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function");
}

export async function writeObsidianExportPackageToDirectory(
  exportPackage: ObsidianGraphExportPackagePayload,
): Promise<boolean> {
  if (window.clewDesktop) {
    return window.clewDesktop.exportObsidian(exportPackage);
  }
  const directoryWindow = window as DirectoryPickerWindow;
  if (typeof directoryWindow.showDirectoryPicker !== "function") {
    throw new Error("Obsidian export requires a browser with folder write access support.");
  }

  let rootHandle: FileSystemDirectoryHandle;
  try { rootHandle = await directoryWindow.showDirectoryPicker(); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") return false;
    throw cause;
  }
  const exportFolderHandle = await rootHandle.getDirectoryHandle(exportPackage.folder_name, { create: true });

  for (const file of exportPackage.files) {
    const parts = file.path.split("/").filter(Boolean);
    if (parts.length === 0) throw new Error("The export contains an empty file path.");

    let directoryHandle = exportFolderHandle;
    for (const segment of parts.slice(0, -1)) {
      directoryHandle = await directoryHandle.getDirectoryHandle(segment, { create: true });
    }

    const fileHandle = await directoryHandle.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(file.body);
    } finally {
      await writable.close();
    }
  }
  return true;
}
