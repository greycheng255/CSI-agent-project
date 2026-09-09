import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';
import { OrgService } from '../orgs/org.service';

describe('OidcController (discovery route)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.SSO_OIDC_ISSUER = 'https://idp.example.test';
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OidcController],
      providers: [
        OidcService,
        { provide: OrgService, useValue: { resolveByUserId: jest.fn() } },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.SSO_OIDC_ISSUER;
  });

  it('GET /.well-known/openid-configuration 返回 discovery 文档', async () => {
    const { body, statusCode } = await request(app.getHttpServer()).get(
      '/.well-known/openid-configuration',
    );
    expect(statusCode).toBe(200);
    expect(body.issuer).toBe('https://idp.example.test');
    expect(body.authorization_endpoint).toBe(
      'https://idp.example.test/api/v1/sso/authorize',
    );
    expect(body.token_endpoint).toBe(
      'https://idp.example.test/api/v1/sso/token',
    );
    expect(body.id_token_signing_alg_values_supported).toEqual(['HS256']);
    expect(body.claims_supported).toContain('org_id');
  });
});
