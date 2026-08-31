import { ArgumentsHost } from '@nestjs/common';
import { Rfc7807Filter } from './rfc7807.filter';
import { CONTRACT_ERROR_CODE, ContractError } from './errors';

describe('Rfc7807Filter（契约 §3.1 错误体）', () => {
  const filter = new Rfc7807Filter();

  function runFilter(error: ContractError) {
    const json = jest.fn();
    const setHeader = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, setHeader }),
        getRequest: () => ({
          url: '/v1/marketplace/tasks',
          headers: { 'x-request-id': 'req-123' },
        }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(error, host);
    return { status, json, setHeader };
  }

  it('渲染 RFC 7807 必需字段', () => {
    const { status, json } = runFilter(
      new ContractError(409, CONTRACT_ERROR_CODE.CONFLICT_SEAT_FULL, 'seat full'),
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'about:blank',
        title: 'seat full',
        status: 409,
        instance: '/v1/marketplace/tasks',
        request_id: 'req-123',
        error_code: 'CONFLICT_SEAT_FULL',
      }),
    );
  });

  it('携带 details 与 retry_after_seconds 并设置 Retry-After 头', () => {
    const { setHeader, json } = runFilter(
      new ContractError(
        429,
        CONTRACT_ERROR_CODE.RATE_LIMIT_TOO_MANY,
        'rate limited',
        { window: '1m' },
        60,
      ),
    );
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: { window: '1m' },
        retry_after_seconds: 60,
      }),
    );
  });

  it('无附加字段时不输出 details/retry_after_seconds', () => {
    const { json } = runFilter(
      new ContractError(422, CONTRACT_ERROR_CODE.STATE_INVALID_TRANSITION, 'bad'),
    );
    expect(json).toHaveBeenCalledWith(
      expect.not.objectContaining({ details: expect.anything() }),
    );
  });
});