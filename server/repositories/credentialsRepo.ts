import { dbAdapter } from "../db";
import { decrypt } from "../crypto";

// Security helper to construct a masked string for database audits
function getMaskedValue(encryptedKey: string): string {
  try {
    const rawValue = decrypt(encryptedKey);
    if (!rawValue) return "••••";
    if (rawValue.length > 8) {
      return rawValue.substring(0, 4) + "••••" + rawValue.substring(rawValue.length - 4);
    }
    return "••••";
  } catch {
    return "••••";
  }
}

export const credentialsRepo = {
  fromCredentialDbRow(row: any) {
    if (!row) return null;
    const resolvedUserId = row.owner_id || row.user_id;
    const resolvedEncryptedValue = row.encrypted_value || row.key_encrypted;
    
    let decryptedKey = "";
    if (resolvedEncryptedValue) {
      try {
        decryptedKey = decrypt(resolvedEncryptedValue);
      } catch (err) {
        decryptedKey = "";
      }
    }

    return {
      ...row,
      user_id: resolvedUserId,
      owner_id: resolvedUserId,
      key_encrypted: resolvedEncryptedValue,
      encrypted_value: resolvedEncryptedValue,
      key: decryptedKey,
      is_custom: !!row.is_custom,
      createdAt: row.created_at || row.createdAt
    };
  },

  async listByOwner(userId: string) {
    const data = await dbAdapter.getCredentials(userId);
    return (data || [])
      .slice()
      .sort((a: any, b: any) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .map((r: any) => this.fromCredentialDbRow(r));
  },

  async findByIdAndOwner(id: string, userId: string) {
    const data = await dbAdapter.getCredentialById(id, userId);
    return this.fromCredentialDbRow(data);
  },

  async create(cred: any) {
    const userId = cred.owner_id || cred.user_id;
    const encryptedKey = cred.encrypted_value || cred.key_encrypted || cred.key; // Already encrypted by route
    const masked = getMaskedValue(encryptedKey);

    const payload = {
      id: cred.id,
      name: cred.name,
      type: cred.type,
      key_encrypted: encryptedKey,
      encrypted_value: encryptedKey,
      masked_value: masked,
      base_url: cred.base_url || null,
      is_custom: cred.is_custom ? 1 : 0,
      user_id: userId,
      owner_id: userId,
      created_at: cred.created_at || new Date().toISOString()
    };

    return dbAdapter.createCredential(payload);
  },

  async update(id: string, userId: string, updates: any) {
    const payload: any = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.base_url !== undefined) payload.base_url = updates.base_url;
    if (updates.is_custom !== undefined) payload.is_custom = updates.is_custom ? 1 : 0;
    
    const keyVal = updates.encrypted_value || updates.key_encrypted || updates.key;
    if (keyVal !== undefined) {
      payload.key_encrypted = keyVal;
      payload.encrypted_value = keyVal;
      payload.masked_value = getMaskedValue(keyVal);
    }

    await dbAdapter.updateCredential(id, userId, payload);
  },

  async delete(id: string, userId: string) {
    await dbAdapter.deleteCredential(id, userId);
  }
};
