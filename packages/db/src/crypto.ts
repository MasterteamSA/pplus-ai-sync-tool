import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM using PPLUS_SYNC_MASTER_KEY (base64, 32 bytes). Credentials are
 * stored on disk only in encrypted form; the master key lives in .env.local
 * and is never committed.
 */

function getKey(): Buffer {
  const b64 = process.env.PPLUS_SYNC_MASTER_KEY;
  if (!b64) throw new Error("PPLUS_SYNC_MASTER_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("PPLUS_SYNC_MASTER_KEY must be 32 bytes (base64-encoded)");
  }
  return key;
}

export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function encrypt(plaintext: string): EncryptedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(blob: EncryptedBlob): string {
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(blob.iv, "base64"));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
