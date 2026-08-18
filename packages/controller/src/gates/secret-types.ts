export interface SecretGateFinding {
  rule: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
}

export interface RawSecretReadOptions {
  sensitiveNames?: readonly string[];
  allowedNames?: readonly string[];
  exempt?: boolean;
}

export interface SecretCatalogGateEntry {
  key: string;
  required: boolean;
  description?: string;
  group?: string;
}

export interface SecretCatalogGateDocument {
  version: 1;
  entries: readonly SecretCatalogGateEntry[];
}

export interface SecretReadinessObservation {
  key: string;
  present: boolean;
}

export interface CredentialInventoryEntry {
  id: string;
  secretKey: string;
  provider: string;
  surfaces: readonly string[];
}

export interface CredentialInventory {
  version: 1;
  credentials: readonly CredentialInventoryEntry[];
}

export interface CredentialSurfaceObservation {
  credentialId: string;
  surface: string;
}

export interface LocalFileObservation {
  path: string;
  tracked: boolean;
}

export interface LocalSecretFileOptions {
  allowedPaths?: readonly string[];
}

export interface ProviderResourceObservation {
  provider: string;
  kind: string;
  name: string;
  path?: string;
}

export interface ProviderResourceNamingRule {
  provider: string;
  kind?: string;
  pattern: string;
}
