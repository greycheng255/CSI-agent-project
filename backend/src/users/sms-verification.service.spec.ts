import { UnauthorizedException } from '@nestjs/common';
import { SmsVerificationService } from './sms-verification.service';

describe('SmsVerificationService', () => {
  const previousDebugSetting = process.env.SMS_DEBUG_CODE_ENABLED;

  beforeEach(() => {
    process.env.SMS_DEBUG_CODE_ENABLED = 'true';
  });

  afterAll(() => {
    if (previousDebugSetting === undefined) {
      delete process.env.SMS_DEBUG_CODE_ENABLED;
    } else {
      process.env.SMS_DEBUG_CODE_ENABLED = previousDebugSetting;
    }
  });

  it('accepts the debug code for any valid mobile number', () => {
    const service = new SmsVerificationService();

    expect(() =>
      service.verifyCode('18500000000', 'login', '121212'),
    ).not.toThrow();
  });

  it('does not accept another code without a prior request', () => {
    const service = new SmsVerificationService();

    expect(() => service.verifyCode('18500000000', 'login', '654321')).toThrow(
      UnauthorizedException,
    );
  });

  it('can explicitly disable the debug code', () => {
    process.env.SMS_DEBUG_CODE_ENABLED = 'false';
    const service = new SmsVerificationService();

    expect(() => service.verifyCode('18500000000', 'login', '121212')).toThrow(
      UnauthorizedException,
    );
  });
});
