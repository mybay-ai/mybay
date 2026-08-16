import crypto from 'crypto';
import { SCRYPT_CONFIG } from '../../shared/authConstants';

/**
 * Enhanced Scrypt Hashing with versioning support
 * Format: scrypt$<version>$N=<N>$r=<r>$p=<p>$<salt>$<hash>
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SCRYPT_CONFIG.saltlen).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_CONFIG.keylen, {
    N: SCRYPT_CONFIG.N,
    r: SCRYPT_CONFIG.r,
    p: SCRYPT_CONFIG.p,
    maxmem: SCRYPT_CONFIG.maxmem
  }).toString("hex");

  return `scrypt$${SCRYPT_CONFIG.version}$N=${SCRYPT_CONFIG.N}$r=${SCRYPT_CONFIG.r}$p=${SCRYPT_CONFIG.p}$${salt}$${hash}`;
}

export function verifyPassword(password: string, storedHash: string): { match: boolean; needsRehash: boolean } {
  // 1. Handle Versioned Format (New)
  if (storedHash.startsWith('scrypt$')) {
    const parts = storedHash.split('$');
    // Format: scrypt | v2 | N=32768 | r=8 | p=1 | <salt> | <hash>
    if (parts.length === 7) {
      const version = parts[1];
      const paramsStr = parts.slice(2, 5); // ["N=32768", "r=8", "p=1"]
      const salt = parts[5];
      const hash = parts[6];

      const params: any = {};
      paramsStr.forEach(p => {
        const [k, v] = p.split('=');
        params[k] = parseInt(v, 10);
      });

      try {
        const hashedBuffer = crypto.scryptSync(password, salt, SCRYPT_CONFIG.keylen, {
          N: params.N || SCRYPT_CONFIG.N,
          r: params.r || SCRYPT_CONFIG.r,
          p: params.p || SCRYPT_CONFIG.p,
          maxmem: SCRYPT_CONFIG.maxmem
        });
        
        const keyBuffer = Buffer.from(hash, "hex");
        const match = crypto.timingSafeEqual(hashedBuffer, keyBuffer);
        
        // Check if parameters are outdated compared to current config
        const needsRehash = version !== SCRYPT_CONFIG.version || 
                            params.N !== SCRYPT_CONFIG.N || 
                            params.r !== SCRYPT_CONFIG.r;

        return { match, needsRehash };
      } catch (err) {
        console.error(`[Security] Scrypt verification failed for versioned hash:`, err);
        return { match: false, needsRehash: false };
      }
    }
  }

  // 2. Handle Legacy Format (salt:hash)
  const parts = storedHash.split(":");
  if (parts.length === 2) {
    const [salt, key] = parts;
    
    // Legacy Check: salt should be 32 chars and key 128 chars (hex)
    if (salt.length !== 32 || key.length !== 128) {
      console.warn(`[Security] Stored legacy hash has invalid format: salt_len=${salt.length}, key_len=${key.length}`);
      return { match: false, needsRehash: false };
    }

    try {
      // Historical generation: scryptSync(password, salt_hex_string, 64)
      // Uses Node defaults: N=16384, r=8, p=1
      let actual = crypto.scryptSync(password, salt, 64, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 32 * 1024 * 1024
      });
      const expected = Buffer.from(key, "hex");
      
      let match = crypto.timingSafeEqual(actual, expected);

      // If string salt fails, try buffer salt (some versions might have used Buffer.from(salt, 'hex'))
      if (!match) {
        const actualWithBufferSalt = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64, {
          N: 16384,
          r: 8,
          p: 1,
          maxmem: 32 * 1024 * 1024
        });
        match = crypto.timingSafeEqual(actualWithBufferSalt, expected);
        if (match) {
          console.log(`[Security] Legacy verification succeeded using Buffer salt fallback.`);
        }
      }

      console.log(`[Security] Legacy verification attempt: match=${match}, format=legacy, params=N16384/r8/p1/keylen64`);

      return { match, needsRehash: match }; // If match, we MUST rehash
    } catch (e) {
      console.error(`[Security] Scrypt verification failed for legacy hash:`, e);
      return { match: false, needsRehash: false };
    }
  }

  return { match: false, needsRehash: false };
}
