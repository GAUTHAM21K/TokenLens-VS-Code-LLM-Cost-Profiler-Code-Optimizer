/**
 * Tests: secret-scan.test.js.
 *
 * Exports: none (test suite)
 * Feature: tooling
 */
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanDirectory, scanRepo } from "../scripts/secret-scan.js";

test("secret-scan scanner detects all credential patterns and respects ignore lists (Finding 9)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "secret-scan-test-"));

  try {
    // 1. Clean file
    fs.writeFileSync(
      path.join(tmpDir, "clean.ts"),
      `export const config = { timeout: 5000, provider: "anthropic" };`
    );
    const cleanViolations = scanDirectory(tmpDir);
    assert.strictEqual(cleanViolations.length, 0, "Clean directory should have 0 violations");

    // 2. File with MongoDB URI
    fs.writeFileSync(
      path.join(tmpDir, "dirty-mongo.ts"),
      `const uri = "mongodb+srv://user:pass@cluster0.mongodb.net/test";`
    );

    // 3. File with sk- secret
    fs.writeFileSync(
      path.join(tmpDir, "dirty-sk.ts"),
      `const key = "sk-1234567890abcdef1234567890abcdef";`
    );

    // 4. File with password assignment
    fs.writeFileSync(
      path.join(tmpDir, "dirty-pass.ts"),
      `const password = "mySuperSecretPassword123";`
    );

    // 5. File with api_key assignment
    fs.writeFileSync(
      path.join(tmpDir, "dirty-apikey.ts"),
      `const api_key = "secret_value_here_12345";`
    );

    // 6. File with Google AIza key (AIza + 35 chars = 39 chars total)
    fs.writeFileSync(
      path.join(tmpDir, "dirty-aiza.ts"),
      `const googleKey = "AIzaSyD12345678901234567890123456789012";`
    );

    // 7. File with Groq key
    fs.writeFileSync(
      path.join(tmpDir, "dirty-groq.ts"),
      `const groq = "gsk_1234567890abcdef1234567890abcdef";`
    );

    // 8. File with xAI key
    fs.writeFileSync(
      path.join(tmpDir, "dirty-xai.ts"),
      `const xai = "xai-1234567890abcdef1234567890abcdef";`
    );

    // 9. File with private key block
    fs.writeFileSync(
      path.join(tmpDir, "dirty-keyblock.ts"),
      `const pem = "-----BEGIN RSA PRIVATE KEY-----...";`
    );

    // 10. File with Bearer token
    fs.writeFileSync(
      path.join(tmpDir, "dirty-bearer.ts"),
      `const auth = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ90123456789";`
    );

    const allViolations = scanDirectory(tmpDir);
    assert.strictEqual(allViolations.length, 9, "Should catch all 9 dirty patterns");

    // Check ignore directory
    const ignoredDir = path.join(tmpDir, "node_modules");
    fs.mkdirSync(ignoredDir);
    fs.writeFileSync(
      path.join(ignoredDir, "nested-secret.ts"),
      `const key = "sk-1234567890abcdef1234567890abcdef";`
    );
    const afterIgnore = scanDirectory(tmpDir);
    assert.strictEqual(afterIgnore.length, 9, "Should ignore node_modules");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("secret-scan scanner repo run against current workspace passes with 0 violations", () => {
  const repoViolations = scanRepo();
  assert.strictEqual(
    repoViolations.length,
    0,
    `Current workspace should have 0 secret violations, found: ${JSON.stringify(repoViolations)}`
  );
});
