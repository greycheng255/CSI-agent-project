import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createPrivateKey, createPublicKey } from 'crypto';
import { AlipaySdk, type AlipaySdkConfig } from 'alipay-sdk';

const DEFAULT_GATEWAY = 'https://openapi.alipay.com/gateway.do';
const PRODUCT_CODE = 'FAST_INSTANT_TRADE_PAY';

export interface AlipayTradeQueryResult {
  status: 'PAID' | 'PENDING' | 'CLOSED' | 'UNKNOWN';
  outTradeNo: string;
  tradeNo: string | null;
  totalAmount: string | null;
  raw: Record<string, unknown>;
}

interface AlipayRuntimeConfig {
  appId: string;
  sellerId: string | null;
  notifyUrl: string;
  returnUrl: string;
  sdk: AlipaySdkConfig;
}

function stripPem(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '')
    .replace(/\r/g, '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
}

function wrapPem(body: string, type: string): string {
  const lines = body.match(/.{1,64}/g)?.join('\n') || body;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

function detectPrivateKeyType(
  body: string,
  override?: string,
): 'PKCS1' | 'PKCS8' {
  const candidates: Array<{
    keyType: 'PKCS1' | 'PKCS8';
    pemType: 'RSA PRIVATE KEY' | 'PRIVATE KEY';
  }> =
    override === 'PKCS1'
      ? [{ keyType: 'PKCS1', pemType: 'RSA PRIVATE KEY' }]
      : override === 'PKCS8'
        ? [{ keyType: 'PKCS8', pemType: 'PRIVATE KEY' }]
        : [
            { keyType: 'PKCS8', pemType: 'PRIVATE KEY' },
            { keyType: 'PKCS1', pemType: 'RSA PRIVATE KEY' },
          ];

  for (const candidate of candidates) {
    try {
      createPrivateKey(wrapPem(body, candidate.pemType));
      return candidate.keyType;
    } catch {
      // Try the other supported key encoding.
    }
  }
  throw new Error('ALIPAY_PRIVATE_KEY is not a valid PKCS#1 or PKCS#8 key');
}

function assertPublicKey(body: string): void {
  for (const type of ['PUBLIC KEY', 'RSA PUBLIC KEY']) {
    try {
      createPublicKey(wrapPem(body, type));
      return;
    } catch {
      // Try the other supported public key encoding.
    }
  }
  throw new Error('ALIPAY_PUBLIC_KEY is not a valid Alipay public key');
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function readResponseString(
  response: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = response[key];
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
  }
  return '';
}

@Injectable()
export class AlipayClientService {
  private client: AlipaySdk | null = null;
  private runtimeConfig: AlipayRuntimeConfig | null = null;

  isConfigured(): boolean {
    return [
      'ALIPAY_APP_ID',
      'ALIPAY_PRIVATE_KEY',
      'ALIPAY_PUBLIC_KEY',
      'ALIPAY_NOTIFY_URL',
      'ALIPAY_RETURN_URL',
    ].every((name) => Boolean(process.env[name]?.trim()));
  }

  get appId(): string {
    return this.getRuntimeConfig().appId;
  }

  get sellerId(): string | null {
    return this.getRuntimeConfig().sellerId;
  }

  createPagePayment(input: {
    outTradeNo: string;
    amountCny: number;
    subject: string;
    timeoutMinutes?: number;
  }): string {
    const config = this.getRuntimeConfig();
    return this.getClient().pageExecute('alipay.trade.page.pay', 'GET', {
      notify_url: config.notifyUrl,
      return_url: config.returnUrl,
      bizContent: {
        out_trade_no: input.outTradeNo,
        total_amount: (input.amountCny / 100).toFixed(2),
        subject: input.subject.slice(0, 256),
        product_code: PRODUCT_CODE,
        timeout_express: `${input.timeoutMinutes ?? 15}m`,
      },
    });
  }

  verifyNotification(params: Record<string, string>): boolean {
    try {
      const client = this.getClient();
      return client.checkNotifySignV2(params) || client.checkNotifySign(params);
    } catch {
      return false;
    }
  }

  async queryTrade(outTradeNo: string): Promise<AlipayTradeQueryResult> {
    const response = (await this.getClient().exec(
      'alipay.trade.query',
      { bizContent: { out_trade_no: outTradeNo } },
      { validateSign: true },
    )) as unknown as Record<string, unknown>;

    const code = readResponseString(response, 'code');
    const tradeStatus = readResponseString(
      response,
      'tradeStatus',
      'trade_status',
    );
    const status =
      code !== '10000'
        ? 'UNKNOWN'
        : tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
          ? 'PAID'
          : tradeStatus === 'TRADE_CLOSED'
            ? 'CLOSED'
            : tradeStatus === 'WAIT_BUYER_PAY'
              ? 'PENDING'
              : 'UNKNOWN';

    return {
      status,
      outTradeNo:
        readResponseString(response, 'outTradeNo', 'out_trade_no') ||
        outTradeNo,
      tradeNo:
        readResponseString(response, 'tradeNo', 'trade_no').trim() || null,
      totalAmount:
        readResponseString(response, 'totalAmount', 'total_amount').trim() ||
        null,
      raw: response,
    };
  }

  private getClient(): AlipaySdk {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('支付宝在线支付尚未配置');
    }
    if (!this.client) {
      this.client = new AlipaySdk(this.getRuntimeConfig().sdk);
    }
    return this.client;
  }

  private getRuntimeConfig(): AlipayRuntimeConfig {
    if (this.runtimeConfig) return this.runtimeConfig;
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('支付宝在线支付尚未配置');
    }

    try {
      const privateKey = stripPem(readRequiredEnv('ALIPAY_PRIVATE_KEY'));
      const alipayPublicKey = stripPem(readRequiredEnv('ALIPAY_PUBLIC_KEY'));
      const keyType = detectPrivateKeyType(
        privateKey,
        process.env.ALIPAY_KEY_TYPE?.trim().toUpperCase(),
      );
      assertPublicKey(alipayPublicKey);

      this.runtimeConfig = {
        appId: readRequiredEnv('ALIPAY_APP_ID'),
        sellerId: process.env.ALIPAY_PID?.trim() || null,
        notifyUrl: readRequiredEnv('ALIPAY_NOTIFY_URL'),
        returnUrl: readRequiredEnv('ALIPAY_RETURN_URL'),
        sdk: {
          appId: readRequiredEnv('ALIPAY_APP_ID'),
          privateKey,
          alipayPublicKey,
          keyType,
          gateway: process.env.ALIPAY_GATEWAY?.trim() || DEFAULT_GATEWAY,
          signType: 'RSA2',
          charset: 'utf-8',
          camelcase: true,
          timeout: 10_000,
        },
      };
      return this.runtimeConfig;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid config';
      throw new ServiceUnavailableException(`支付宝配置无效: ${message}`);
    }
  }
}
