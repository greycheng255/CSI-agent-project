import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createPrivateKey, createPublicKey } from 'crypto';
import { AlipaySdk, type AlipaySdkConfig } from 'alipay-sdk';

const DEFAULT_GATEWAY = 'https://openapi.alipay.com/gateway.do';
const PRODUCT_CODE = 'FAST_INSTANT_TRADE_PAY';
const MOCK_APP_ID = 'MOCK_APP_ID';

export interface AlipayTradeQueryResult {
  status: 'PAID' | 'PENDING' | 'CLOSED' | 'UNKNOWN';
  outTradeNo: string;
  tradeNo: string | null;
  totalAmount: string | null;
  raw: Record<string, unknown>;
}

export interface AlipayTransferResult {
  status: 'SUCCESS' | 'FAIL' | 'UNKNOWN';
  /** 支付宝转账单据号 */
  orderId: string | null;
  /** 支付宝支付流水号 */
  fundOrderId: string | null;
  failReason: string | null;
  raw: Record<string, unknown>;
}

interface AlipayRuntimeConfig {
  appId: string;
  sellerId: string | null;
  notifyUrl: string;
  returnUrl: string;
  sdk: AlipaySdkConfig;
}

function envFlag(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === 'true';
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

  /**
   * Mock 模式：支付宝商户资质审批期间使用。跳过签名/验签，使用本地
   * mock 收银台页面，让在线支付的创建、回调、查询、结算链路可端到端联调。
   *
   * 触发条件：ALIPAY_MOCK_MODE=true，或 ALIPAY_APP_ID /
   * ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY 任一缺失时自动启用。
   */
  isMockMode(): boolean {
    if (envFlag('ALIPAY_MOCK_MODE')) return true;
    return !['ALIPAY_APP_ID', 'ALIPAY_PRIVATE_KEY', 'ALIPAY_PUBLIC_KEY'].every(
      (name) => Boolean(process.env[name]?.trim()),
    );
  }

  isConfigured(): boolean {
    if (this.isMockMode()) return true;
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
    if (this.isMockMode()) {
      return this.createMockCheckoutUrl(input);
    }
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
    if (this.isMockMode()) {
      // mock 模式下回调来自本地 mock 收银台，没有真实签名；一律放行，
      // 商户身份校验由 OnlinePaymentService.settleSuccessfulPayment 的
      // requireMerchantIdentity=false 分支跳过。
      return true;
    }
    try {
      const client = this.getClient();
      return client.checkNotifySignV2(params) || client.checkNotifySign(params);
    } catch {
      return false;
    }
  }

  /**
   * 单笔转账到支付宝账户（alipay.fund.trans.uni.transfer，提现自动打款用）。
   * 需企业支付宝开通「转账到支付宝账户」产品授权；未配置开关时不应调用。
   * @param outBizNo 商家转账唯一单号（提现申请 id）
   * @param amountCny 转账金额（分）
   * @param payeeAccount 收款方支付宝登录号（手机/邮箱）或 2088 开头会员 ID
   * @param payeeRealName 收款方真实姓名（可空；填写可加强校验）
   */
  async transferToAccount(input: {
    outBizNo: string;
    amountCny: number;
    payeeAccount: string;
    payeeRealName?: string | null;
    remark?: string;
  }): Promise<AlipayTransferResult> {
    const identityType = /^2088\d{12,}$/.test(input.payeeAccount.trim())
      ? 'ALIPAY_USER_ID'
      : 'ALIPAY_LOGON_ID';
    const response = (await this.getClient().exec(
      'alipay.fund.trans.uni.transfer',
      {
        bizContent: {
          out_biz_no: input.outBizNo,
          trans_amount: (input.amountCny / 100).toFixed(2),
          product_code: 'TRANS_ACCOUNT_NO_PWD',
          biz_scene: 'DIRECT_TRANSFER',
          payee_info: {
            identity: input.payeeAccount.trim(),
            identity_type: identityType,
            ...(input.payeeRealName?.trim()
              ? { name: input.payeeRealName.trim() }
              : {}),
          },
          remark: (input.remark || '余额提现').slice(0, 100),
        },
      },
      { validateSign: true },
    )) as unknown as Record<string, unknown>;

    const code = readResponseString(response, 'code');
    const status = readResponseString(response, 'status');
    const subMsg =
      readResponseString(response, 'subMsg', 'sub_msg') ||
      readResponseString(response, 'msg');
    if (code !== '10000') {
      return {
        status: 'FAIL',
        orderId: readResponseString(response, 'orderId', 'order_id') || null,
        fundOrderId: null,
        failReason: subMsg || `alipay_code_${code}`,
        raw: response,
      };
    }
    return {
      status: status === 'SUCCESS' ? 'SUCCESS' : 'UNKNOWN',
      orderId: readResponseString(response, 'orderId', 'order_id') || null,
      fundOrderId:
        readResponseString(response, 'payFundOrderId', 'pay_fund_order_id') ||
        null,
      failReason: status === 'SUCCESS' ? null : subMsg || `status_${status}`,
      raw: response,
    };
  }

  isTransferEnabled(): boolean {
    return (
      process.env.ALIPAY_TRANSFER_ENABLED?.trim() === 'true' &&
      this.isConfigured()
    );
  }

  async queryTrade(outTradeNo: string): Promise<AlipayTradeQueryResult> {
    if (this.isMockMode()) {
      // mock 模式不主动查询渠道：支付结果以本地 mock notify 落库为准，
      // 这里返回 UNKNOWN 让 refreshFromAlipay 不改变订单状态。
      return {
        status: 'UNKNOWN',
        outTradeNo,
        tradeNo: null,
        totalAmount: null,
        raw: { mock: true, out_trade_no: outTradeNo },
      };
    }
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

  private createMockCheckoutUrl(input: {
    outTradeNo: string;
    amountCny: number;
    subject: string;
  }): string {
    const base =
      process.env.PAYMENT_FRONTEND_BASE_URL?.trim() ||
      process.env.FRONTEND_BASE_URL?.trim() ||
      'http://localhost:5173';
    const url = new URL('/pay/mock-checkout', base);
    url.searchParams.set('out_trade_no', input.outTradeNo);
    url.searchParams.set('total_amount', (input.amountCny / 100).toFixed(2));
    url.searchParams.set('subject', input.subject.slice(0, 256));
    return url.toString();
  }

  private getClient(): AlipaySdk {
    if (this.isMockMode()) {
      throw new ServiceUnavailableException(
        '支付宝在线支付处于 mock 模式，无法获取真实 SDK 客户端',
      );
    }
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

    if (this.isMockMode()) {
      const mockAppId =
        process.env.ALIPAY_APP_ID?.trim() || MOCK_APP_ID;
      this.runtimeConfig = {
        appId: mockAppId,
        sellerId: process.env.ALIPAY_PID?.trim() || null,
        notifyUrl: process.env.ALIPAY_NOTIFY_URL?.trim() || '',
        returnUrl: process.env.ALIPAY_RETURN_URL?.trim() || '',
        sdk: {
          appId: mockAppId,
          privateKey: '',
          alipayPublicKey: '',
          keyType: 'PKCS8',
          gateway: process.env.ALIPAY_GATEWAY?.trim() || DEFAULT_GATEWAY,
          signType: 'RSA2',
          charset: 'utf-8',
          camelcase: true,
          timeout: 10_000,
        },
      };
      return this.runtimeConfig;
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
