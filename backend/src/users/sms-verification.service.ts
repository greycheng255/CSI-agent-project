import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import Dysmsapi20170525, { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export type SmsVerificationScene = 'login' | 'register';

type VerificationRecord = {
  codeHash: Buffer;
  expiresAt: number;
  sentAt: number;
  failedAttempts: number;
};

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const CODE_PATTERN = /^\d{6}$/;
const DEBUG_CODE = '121212';
const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;
const MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class SmsVerificationService {
  private readonly logger = new Logger(SmsVerificationService.name);
  private readonly records = new Map<string, VerificationRecord>();
  private readonly requestHistory = new Map<string, number[]>();
  private readonly hashSalt = randomBytes(32).toString('hex');
  private client: Dysmsapi20170525 | null = null;

  async requestCode(phone: string, scene: SmsVerificationScene) {
    this.assertPhone(phone);
    this.assertScene(scene);

    const now = Date.now();
    const key = this.recordKey(phone, scene);
    const existing = this.records.get(key);
    if (existing && now - existing.sentAt < RESEND_INTERVAL_MS) {
      const retryAfterSeconds = Math.ceil(
        (RESEND_INTERVAL_MS - (now - existing.sentAt)) / 1000,
      );
      throw new HttpException(
        `请在 ${retryAfterSeconds} 秒后重试`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.checkRequestLimit(phone, now);
    const code = randomInt(100000, 1000000).toString();
    const smsConfigured = this.isSmsConfigured();

    if (smsConfigured) {
      await this.sendAliyunSms(phone, code);
    } else if (!this.isDebugCodeEnabled()) {
      throw new ServiceUnavailableException('短信服务尚未配置');
    }

    this.records.set(key, {
      codeHash: this.hashCode(phone, scene, code),
      expiresAt: now + CODE_TTL_MS,
      sentAt: now,
      failedAttempts: 0,
    });

    return {
      message: smsConfigured ? '验证码已发送' : '调试模式：请使用调试验证码',
      expiresInSeconds: CODE_TTL_MS / 1000,
      retryAfterSeconds: RESEND_INTERVAL_MS / 1000,
      debugCodeEnabled: this.isDebugCodeEnabled(),
    };
  }

  verifyCode(phone: string, scene: SmsVerificationScene, code: string) {
    this.assertPhone(phone);
    this.assertScene(scene);
    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
      throw new UnauthorizedException('验证码格式不正确');
    }

    if (this.isDebugCodeEnabled() && code === DEBUG_CODE) {
      return;
    }

    const key = this.recordKey(phone, scene);
    const record = this.records.get(key);
    if (!record) {
      throw new UnauthorizedException('请先获取验证码');
    }
    if (record.expiresAt <= Date.now()) {
      this.records.delete(key);
      throw new UnauthorizedException('验证码已过期，请重新获取');
    }
    if (record.failedAttempts >= MAX_VERIFY_ATTEMPTS) {
      this.records.delete(key);
      throw new UnauthorizedException('验证码错误次数过多，请重新获取');
    }

    const actualHash = this.hashCode(phone, scene, code);
    if (!timingSafeEqual(record.codeHash, actualHash)) {
      record.failedAttempts += 1;
      if (record.failedAttempts >= MAX_VERIFY_ATTEMPTS) {
        this.records.delete(key);
      }
      throw new UnauthorizedException('验证码不正确');
    }

    this.records.delete(key);
  }

  isDebugCodeEnabled() {
    const explicitValue = process.env.SMS_DEBUG_CODE_ENABLED?.trim();
    if (explicitValue === 'true') return true;
    if (explicitValue === 'false') return false;
    return process.env.NODE_ENV !== 'production';
  }

  private async sendAliyunSms(phone: string, code: string) {
    const signName = process.env.ALIYUN_SMS_SIGN_NAME?.trim();
    const templateCode =
      process.env.ALIYUN_SMS_TEMPLATE_CODE?.trim() || 'SMS_330310524';
    if (!signName) {
      throw new ServiceUnavailableException('短信签名未配置');
    }

    const templateParamKey =
      process.env.ALIYUN_SMS_TEMPLATE_PARAM_KEY?.trim() || 'code';
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(templateParamKey)) {
      throw new ServiceUnavailableException('短信模板参数名配置错误');
    }

    try {
      const response = await this.getClient().sendSms(
        new SendSmsRequest({
          phoneNumbers: phone,
          signName,
          templateCode,
          templateParam: JSON.stringify({ [templateParamKey]: code }),
        }),
      );
      if (response.body?.code !== 'OK') {
        this.logger.error(
          `Aliyun SMS rejected request for ${this.maskPhone(phone)}: ${response.body?.code || 'UNKNOWN'} ${response.body?.message || ''}`,
        );
        throw new ServiceUnavailableException('短信发送失败，请稍后重试');
      }
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Aliyun SMS request failed for ${this.maskPhone(phone)}: ${message}`,
      );
      throw new ServiceUnavailableException('短信发送失败，请稍后重试');
    }
  }

  private getClient() {
    if (this.client) return this.client;

    this.client = new Dysmsapi20170525(
      new $OpenApiUtil.Config({
        accessKeyId: process.env.ALIBABA_CLOUD_ACCESS_KEY_ID?.trim(),
        accessKeySecret: process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET?.trim(),
        regionId: process.env.ALIYUN_SMS_REGION_ID?.trim() || 'cn-hangzhou',
        endpoint:
          process.env.ALIYUN_SMS_ENDPOINT?.trim() || 'dysmsapi.aliyuncs.com',
        protocol: 'HTTPS',
        connectTimeout: 5_000,
        readTimeout: 10_000,
      }),
    );
    return this.client;
  }

  private isSmsConfigured() {
    return Boolean(
      process.env.ALIBABA_CLOUD_ACCESS_KEY_ID?.trim() &&
      process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET?.trim() &&
      process.env.ALIYUN_SMS_SIGN_NAME?.trim(),
    );
  }

  private checkRequestLimit(phone: string, now: number) {
    const recent = (this.requestHistory.get(phone) || []).filter(
      (timestamp) => now - timestamp < REQUEST_WINDOW_MS,
    );
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      this.requestHistory.set(phone, recent);
      throw new HttpException(
        '验证码发送过于频繁，请稍后再试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.requestHistory.set(phone, recent);
  }

  private hashCode(phone: string, scene: SmsVerificationScene, code: string) {
    return createHash('sha256')
      .update(`${this.hashSalt}:${phone}:${scene}:${code}`)
      .digest();
  }

  private recordKey(phone: string, scene: SmsVerificationScene) {
    return `${scene}:${phone}`;
  }

  private assertPhone(phone: string) {
    if (typeof phone !== 'string' || !PHONE_PATTERN.test(phone)) {
      throw new BadRequestException('手机号格式不正确');
    }
  }

  private assertScene(scene: string) {
    if (scene !== 'login' && scene !== 'register') {
      throw new BadRequestException('验证码场景不正确');
    }
  }

  private maskPhone(phone: string) {
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }
}
