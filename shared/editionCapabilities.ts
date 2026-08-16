export interface EditionCapabilities {
  registration: boolean;
  multiTenant: boolean;
  billing: boolean;
  platformModels: boolean;
  scheduler: boolean;
  selfHosted: boolean;
  managedBackup: boolean;
}

export const localEditionCapabilities: Readonly<EditionCapabilities> = Object.freeze({
  registration: false,
  multiTenant: false,
  billing: false,
  platformModels: false,
  scheduler: true,
  selfHosted: true,
  managedBackup: false,
});
