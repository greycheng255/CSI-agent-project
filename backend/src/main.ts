/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-require-imports */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { join } from 'path';
import type { IncomingMessage } from 'http';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.enableCors(); // 允许跨域请求

  // Swagger/OpenAPI 文档配置
  const config = new DocumentBuilder()
    .setTitle('Genesis API')
    .setDescription('Genesis 平台 API 文档 - 全球首个碳硅商业交易网络')
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'JWT',
    )
    .addTag('认证', '用户登录注册')
    .addTag('任务', '任务管理')
    .addTag('报价', '报价管理')
    .addTag('订单', '订单管理')
    .addTag('Agent', 'Agent 管理')
    .addTag('支付', '支付管理')
    .addTag('指标', '业务指标统计')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
    customSiteTitle: 'Genesis API Docs',
  });

  // 获取底层 express 实例
  const server = app.getHttpAdapter().getInstance();

  // 配置 body parser 限制；verify 回调捕获 raw body 原文（HMAC §3.1「body 原文」验签依赖，避免 re-serialization 差异）
  const captureRawBody = (
    req: IncomingMessage & { rawBody?: Buffer },
    _res: unknown,
    buf: Buffer,
  ): void => {
    req.rawBody = buf;
  };
  server.use(bodyParser.json({ limit: '50mb', verify: captureRawBody }));
  server.use(
    bodyParser.urlencoded({ limit: '50mb', extended: true, verify: captureRawBody }),
  );

  // 使用 express 的静态文件中间件 - 必须在 NestJS 路由之前注册
  // 这样 /uploads/platform-payment-codes/xxx.jpg 会映射到 /app/uploads/platform-payment-codes/xxx.jpg
  const express = require('express');

  // 添加调试中间件
  server.use('/uploads', (req, res, next) => {
    console.log(`[DEBUG] Static file request: ${req.url}`);
    next();
  });

  server.use(
    '/uploads',
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    express.static('/app/uploads', {
      fallthrough: false, // 如果文件不存在，返回 404 而不是继续到下一个中间件
    }),
  );

  // 托管静态文件，使得 http://localhost:4000/scripts/register-openclaw.sh 可被访问
  app.useStaticAssets(join(__dirname, '..', 'public'));

  await app.listen(process.env.PORT ?? 4000, '0.0.0.0'); // 监听所有网络接口
  console.log(`Application is running on: ${await app.getUrl()}`);
  console.log(`Static files served from: /app/uploads at /uploads`);
}
void bootstrap();
