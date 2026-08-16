import * as archiverNamespace from "archiver";

export function resolveArchiverFactory(): any {
  const importedNamespace = archiverNamespace as any;
  const typeOfNamespace = typeof importedNamespace;

  console.log(`[Archiver Diagnostics] namespace keys:`, Object.keys(importedNamespace));
  console.log(`[Archiver Diagnostics] typeof namespace: ${typeOfNamespace}`);

  // In archiver >= 8.0.0, ZipArchive is an exported Class constructor
  if (importedNamespace.ZipArchive && typeof importedNamespace.ZipArchive === "function") {
    console.log("[Archiver Diagnostics] Using modern ZipArchive class constructor factory wrapper");
    return (format: string, options: any) => {
      if (format !== "zip") {
        throw new Error(`Unsupported format in resolveArchiverFactory: ${format}`);
      }
      return new importedNamespace.ZipArchive(options);
    };
  }

  // Fallback for older versions of archiver where it was a factory function
  let factory: any = null;
  if (typeof importedNamespace === "function") {
    factory = importedNamespace;
  } else if (typeof importedNamespace.default === "function") {
    factory = importedNamespace.default;
  }

  if (factory && typeof factory === "function") {
    console.log("[Archiver Diagnostics] Using legacy archiver factory function");
    return factory;
  }

  throw new Error("Unable to resolve archiver factory function for export-archive");
}
