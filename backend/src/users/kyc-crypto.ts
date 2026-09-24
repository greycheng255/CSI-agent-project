import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/** KYC 身份证号 AES-256-GCM 加密（独立于 gateway-key，密钥由 KYC_ENCRYPTION_KEY 派生） */
function encryptionKey(): Buffer {
  const secret = process.env.KYC_ENCRYPTION_KEY ?? process.env.LONGTASK_SERVICE_TOKEN ?? 'csi-kyc-dev';
  return createHash('sha256').update(`${secret}|kyc-id-enc`).digest();
}

export function encryptIdCard(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptIdCard(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** 前端展示脱敏：保留前 3 + 后 4（X 为合法身份证校验位，需保留） */
export function maskIdCard(plain: string): string {
  const digits = plain.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (digits.length < 8) return '***';
  return `${digits.slice(0, 3)}***********${digits.slice(-4)}`;
}