export const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'root',
  'system',
  'user',
  'users',
  'guest',
  'owner',
  'moderator',
  'support',
  'security',
  'api',
  'app',
  'apps',
  'web',
  'www',
  'mail',
  'email',
  'billing',
  'payment',
  'payments',
  'official',
  'staff',
  'service',
  'services',
  'help',
  'info',
  'contact',
  'mybay',
  'mybayapp',
  'hermes',
  'agent',
  'agents',
  'null',
  'undefined',
  'test',
  'demo',
  'anonymous',
  'unknown',
  'superuser'
]);

export const RESERVED_PREFIXES = [
  'admin_',
  'root_',
  'system_',
  'mybay_',
  'official_',
  'support_'
];

export const AUTH_CONFIG = {
  PASSWORD_MIN_LENGTH: 12,
  PASSWORD_MAX_LENGTH: 64,
  USERNAME_MIN_LENGTH: 6,
  USERNAME_MAX_LENGTH: 18,
};

export const HIGH_RISK_KEYWORDS = [
  'github',
  'paypal',
  'microsoft',
  'google',
  'openai',
  'claude',
  'anthropic',
  'deepseek',
  'gemini',
  'mybay',
  'hermes'
];

export const WEAK_PASSWORDS = [
  'password123', 'admin123', '1234567890', 'qwertyuiop', 'welcome123',
  'mypassword123', 'iloveyou123', 'testpassword', 'letmein123',
  'password12345', '123456789012', 'administrator123', 'mybay1234567',
  'abc123456789', 'qwerty123456', 'asdfghjkl123', 'zxcvbnm12345'
];

export const SCRYPT_CONFIG = {
  N: 32768,
  r: 8,
  p: 1,
  keylen: 64,
  saltlen: 16,
  // 128 * N * r * p = 33554432 (32MB)
  maxmem: 64 * 1024 * 1024, 
  version: 'v2'
};
