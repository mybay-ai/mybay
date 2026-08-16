import crypto from "crypto";

function getEncryptionKey(): Buffer {
  const keyStr = process.env.ENCRYPTION_KEY;
  const isValidHex = keyStr && keyStr.length === 64 && /^[a-fA-F0-9]{64}$/.test(keyStr);
  
  if (!isValidHex) {
    if (process.env.NODE_ENV === "production") {
      if (!keyStr) {
        throw new Error("CRITICAL: ENCRYPTION_KEY is required in production. Generate one with: openssl rand -hex 32");
      }
      throw new Error("CRITICAL: ENCRYPTION_KEY must be a 64-character hex string in production.");
    }
    console.warn(`[SECURITY] WARNING: ENCRYPTION_KEY is missing or invalid in development. Generated a temporary process-local secret.`);
    const tempKey = crypto.randomBytes(32).toString("hex");
    return Buffer.from(tempKey, 'hex');
  }
  
  return Buffer.from(keyStr, 'hex');
}

const ENCRYPTION_KEY = getEncryptionKey();

const IV_LENGTH = 12; 
const AUTH_TAG_LENGTH = 16;

export function encrypt(text: string): string {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

export function decrypt(text: string): string {
  if (!text) return text;
  const parts = text.split(':');
  if (parts.length < 3) return text; // Fallback or legacy check
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function tryResolvePlainInstancePassword(config: any): string | null {
  if (!config || typeof config !== 'object' || !config.password) {
    return null;
  }
  const rawPassword = config.password;
  if (typeof rawPassword !== 'string') {
    return null;
  }
  const parts = rawPassword.split(':');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = parts[2];
    
    if (iv.length !== 12 || authTag.length !== 16) {
      return null;
    }
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted || null;
  } catch (err) {
    return null;
  }
}

export function isEncryptionKeyConfigured(): boolean {
  const keyStr = process.env.ENCRYPTION_KEY;
  return !!keyStr && keyStr.length === 64 && /^[a-fA-F0-9]{64}$/.test(keyStr);
}

export function getEncryptionKeyFingerprint(): string {
  return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest("hex").substring(0, 8);
}

