export async function generateAESKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa !== "undefined") {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

function base64ToBuffer(base64: string): ArrayBuffer {
  if (typeof atob !== "undefined") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
  const buf = Buffer.from(base64, "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export async function encryptPayload(payload: object, aesKey: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const cipherText = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    data,
  );
  const combined = new Uint8Array(iv.byteLength + cipherText.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherText), iv.byteLength);
  return bufferToBase64(combined.buffer);
}

export async function decryptPayload(
  encryptedPayload: string,
  aesKey: CryptoKey,
): Promise<object> {
  const combined = new Uint8Array(base64ToBuffer(encryptedPayload));
  const iv = combined.slice(0, 12);
  const cipherText = combined.slice(12);
  const plainText = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    aesKey,
    cipherText,
  );
  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plainText)) as object;
}

export async function wrapAESKey(aesKey: CryptoKey, publicKey: string): Promise<string> {
  const rawKey = await crypto.subtle.exportKey("raw", aesKey);
  const rsaPublicKey = await importRSAPublicKey(publicKey);
  const wrapped = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaPublicKey,
    rawKey,
  );
  return bufferToBase64(wrapped);
}

export async function unwrapAESKey(wrappedKey: string, privateKey: string): Promise<CryptoKey> {
  const rsaPrivateKey = await importRSAPrivateKey(privateKey);
  const rawKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    rsaPrivateKey,
    base64ToBuffer(wrappedKey),
  );
  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
}

async function importRSAPublicKey(publicKey: string): Promise<CryptoKey> {
  const normalized = normalizeKey(publicKey);
  try {
    return await crypto.subtle.importKey(
      "spki",
      base64ToBuffer(normalized),
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["encrypt"],
    );
  } catch {
    return crypto.subtle.importKey(
      "jwk",
      JSON.parse(normalized),
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["encrypt"],
    );
  }
}

async function importRSAPrivateKey(privateKey: string): Promise<CryptoKey> {
  const normalized = normalizeKey(privateKey);
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      base64ToBuffer(normalized),
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["decrypt"],
    );
  } catch {
    return crypto.subtle.importKey(
      "jwk",
      JSON.parse(normalized),
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["decrypt"],
    );
  }
}

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.startsWith("{")) {
    return trimmed;
  }
  return trimmed.replace(/-----BEGIN [A-Z]+-----/g, "").replace(/-----END [A-Z]+-----/g, "").replace(/\s+/g, "");
}

export async function getPublicKeyForAddress(address: string): Promise<string> {
  const response = await fetch(`/api/keys/${encodeURIComponent(address)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch public key for ${address}: ${response.status}`);
  }
  const data = (await response.json()) as { publicKey?: string };
  if (!data.publicKey) {
    throw new Error(`No public key found for ${address}`);
  }
  return data.publicKey;
}
