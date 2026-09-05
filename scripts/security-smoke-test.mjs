/**
 * Security smoke test for credential sanitization.
 * All values are synthetic fixtures and are not usable provider credentials.
 */

import { sanitizeCredentialsForClient } from "../server/utils/sanitizer.js";

const mockCredentials = [
  {
    id: "cred-1",
    name: "OpenAI-compatible credential",
    type: "openai",
    key: "TEST_SECRET_OPENAI_KEY_DO_NOT_USE",
    key_encrypted: "TEST_FIXTURE_CIPHERTEXT",
    encrypted_value: "TEST_FIXTURE_CIPHERTEXT",
    masked_value: "TEST_SECRET_MASKED_VALUE",
    user_id: "user-fixture-1",
    owner_id: "user-fixture-1",
    created_at: "2026-06-15T21:15:23Z",
    base_url: "https://api.openai.com/v1",
  },
  {
    id: "cred-2",
    name: "DeepSeek-compatible credential",
    type: "deepseek",
    key: "TEST_SECRET_DEEPSEEK_KEY_DO_NOT_USE",
    key_encrypted: "TEST_FIXTURE_CIPHERTEXT",
    encrypted_value: "TEST_FIXTURE_CIPHERTEXT",
    masked_value: "TEST_SECRET_MASKED_VALUE",
    user_id: "user-fixture-2",
    owner_id: "user-fixture-2",
    created_at: "2026-06-14T10:00:00Z",
  },
];

let failedTestsCount = 0;

function assert(condition, testName) {
  if (condition) {
    console.log("[PASS] " + testName);
  } else {
    console.error("[FAIL] " + testName);
    failedTestsCount += 1;
  }
}

console.log("Running credential sanitization smoke tests");

const singleSanitized = sanitizeCredentialsForClient(mockCredentials[0]);
const allSanitized = sanitizeCredentialsForClient(mockCredentials);
const responseStr = JSON.stringify(allSanitized);

assert(!responseStr.includes("TEST_SECRET"), "No synthetic secret fixture values leak in sanitized responses");
assert(allSanitized.every((credential) => credential.key === "••••••••••••••••"), "Raw key is replaced with a fixed mask");
assert(allSanitized.every((credential) => credential.hasSecret === true), "Sanitized credentials report secret presence");
assert(allSanitized.every((credential) => credential.encrypted_value === undefined), "Encrypted value field is removed");
assert(allSanitized.every((credential) => credential.key_encrypted === undefined), "Encrypted key field is removed");
assert(allSanitized.every((credential) => credential.masked_value === undefined), "Stored masked preview field is removed");

const metadataKeys = ["ciphertext", "iv", "authTag", "salt", "maskedKey", "preview", "partialKey", "keyPreview"];
assert(
  allSanitized.every((credential) => metadataKeys.every((key) => credential[key] === undefined)),
  "No cryptographic or preview metadata leaks"
);
assert(singleSanitized.owner_id === "user-fixture-1", "Non-secret owner metadata is retained");

if (failedTestsCount > 0) {
  console.error(failedTestsCount + " security smoke test(s) failed");
  process.exit(1);
}

console.log("All credential sanitization smoke tests passed");
