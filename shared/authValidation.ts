import { AUTH_CONFIG, RESERVED_USERNAMES, RESERVED_PREFIXES, WEAK_PASSWORDS, HIGH_RISK_KEYWORDS } from './authConstants';

export { AUTH_CONFIG };

export type ValidationResult = {
  valid: boolean;
  code?: string;
  message?: string;
};

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isReservedUsername(username: string): boolean {
  const normalized = normalizeUsername(username);
  if (RESERVED_USERNAMES.has(normalized)) return true;
  if (RESERVED_PREFIXES.some(prefix => normalized.startsWith(prefix))) return true;
  if (HIGH_RISK_KEYWORDS.some(keyword => normalized.includes(keyword))) return true;
  return false;
}

export function validateUsername(username: string): ValidationResult {
  const trimmed = username.trim();
  
  if (trimmed.length < AUTH_CONFIG.USERNAME_MIN_LENGTH) {
    return { valid: false, code: 'USERNAME_TOO_SHORT', message: `用户名长度至少 ${AUTH_CONFIG.USERNAME_MIN_LENGTH} 个字符` };
  }
  
  if (trimmed.length > AUTH_CONFIG.USERNAME_MAX_LENGTH) {
    return { valid: false, code: 'USERNAME_TOO_LONG', message: `用户名长度最多 ${AUTH_CONFIG.USERNAME_MAX_LENGTH} 个字符` };
  }

  if (!/^[A-Za-z]/.test(trimmed)) {
    return { valid: false, code: 'INVALID_USERNAME_FORMAT', message: '用户名必须以英文字母开头' };
  }

  if (!/^[A-Za-z0-9_]+$/.test(trimmed)) {
    return { valid: false, code: 'INVALID_USERNAME_FORMAT', message: '用户名只能包含英文字母、数字和下划线' };
  }

  if (trimmed.endsWith('_')) {
    return { valid: false, code: 'INVALID_USERNAME_FORMAT', message: '用户名不能以下划线结尾' };
  }

  if (/__+/.test(trimmed)) {
    return { valid: false, code: 'INVALID_USERNAME_FORMAT', message: '用户名不能包含连续的下划线' };
  }

  if (isReservedUsername(trimmed)) {
    return { valid: false, code: 'USERNAME_RESERVED', message: '该用户名属于系统保留名称或包含知名品牌保留词，请更换' };
  }

  return { valid: true };
}

export function validatePassword(password: string, username?: string): ValidationResult {
  if (password.length < AUTH_CONFIG.PASSWORD_MIN_LENGTH) {
    return { valid: false, code: 'PASSWORD_TOO_SHORT', message: `密码长度至少 ${AUTH_CONFIG.PASSWORD_MIN_LENGTH} 个字符` };
  }
  
  if (password.length > AUTH_CONFIG.PASSWORD_MAX_LENGTH) {
    return { valid: false, code: 'PASSWORD_MAX_LENGTH', message: `密码长度最多 ${AUTH_CONFIG.PASSWORD_MAX_LENGTH} 个字符` };
  }

  if (/\s/.test(password)) {
    return { valid: false, code: 'PASSWORD_CONTAINS_WHITESPACE', message: '密码不能包含空格或换行符' };
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, code: 'PASSWORD_MISSING_UPPERCASE', message: '密码必须包含至少一个大写英文字母' };
  }

  if (!/[a-z]/.test(password)) {
    return { valid: false, code: 'PASSWORD_MISSING_LOWERCASE', message: '密码必须包含至少一个小写英文字母' };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, code: 'PASSWORD_MISSING_NUMBER', message: '密码必须包含至少一个数字' };
  }

  if (username && normalizeUsername(password) === normalizeUsername(username)) {
    return { valid: false, code: 'PASSWORD_TOO_SIMILAR_TO_USERNAME', message: '密码不能与用户名相同' };
  }

  const loweredPassword = password.toLowerCase();
  if (WEAK_PASSWORDS.some(weak => loweredPassword.includes(weak.toLowerCase()))) {
    return { valid: false, code: 'PASSWORD_TOO_COMMON', message: '密码过于简单或包含常见弱口令序列，请设置更安全的密码' };
  }

  return { valid: true };
}
