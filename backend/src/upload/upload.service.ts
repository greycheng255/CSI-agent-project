import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { extname } from 'path';

export interface UploadedFile {
  originalName: string;
  fileName: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface S3UploadedFile extends UploadedFile {
  objectKey: string;
  expiresAt: string;
  expiresIn: number;
}

type S3Settings = {
  bucket: string;
  expiresIn: number;
  uploadClient: S3Client;
  signingClient: S3Client;
};

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private s3Settings?: S3Settings;
  private ensureBucketPromise?: Promise<void>;

  /**
   * 处理已上传的文件（multer diskStorage 已保存到磁盘）
   * 返回文件的访问 URL
   */
  uploadFile(
    file: Express.Multer.File,
    folder: string = 'deliveries',
  ): UploadedFile {
    // multer diskStorage 已经保存了文件
    // file.path 是完整路径，file.filename 是文件名
    const fileName = file.filename || file.originalname;

    // 构建访问 URL
    const baseUrl = process.env.UPLOAD_BASE_URL || 'http://122.51.51.177:4000';
    const url = `${baseUrl}/uploads/${folder}/${fileName}`;

    this.logger.log(
      `File processed: ${fileName}, size: ${file.size}, url: ${url}`,
    );

    return {
      originalName: file.originalname,
      fileName,
      url,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  /**
   * 批量处理已上传的文件
   */
  uploadFiles(
    files: Express.Multer.File[],
    folder: string = 'deliveries',
  ): UploadedFile[] {
    const results: UploadedFile[] = [];

    for (const file of files) {
      const result = this.uploadFile(file, folder);
      results.push(result);
    }

    return results;
  }

  async uploadAgentFile(file: Express.Multer.File): Promise<S3UploadedFile> {
    if (!file.buffer) {
      throw new InternalServerErrorException(
        'S3 upload requires an in-memory file buffer',
      );
    }

    const settings = this.getS3Settings();
    const extension = extname(file.originalname)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    const now = new Date();
    const datePath = [
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      String(now.getUTCDate()).padStart(2, '0'),
    ].join('/');
    const objectKey = `agent-attachments/${datePath}/${randomUUID()}${extension}`;

    try {
      await this.ensureS3Bucket(settings);
      await settings.uploadClient.send(
        new PutObjectCommand({
          Bucket: settings.bucket,
          Key: objectKey,
          Body: file.buffer,
          ContentLength: file.size,
          ContentType: file.mimetype || 'application/octet-stream',
          CacheControl: 'private, max-age=604800',
          Metadata: {
            original_name: encodeURIComponent(file.originalname).slice(0, 1024),
          },
        }),
      );

      const url = await getSignedUrl(
        settings.signingClient,
        new GetObjectCommand({ Bucket: settings.bucket, Key: objectKey }),
        { expiresIn: settings.expiresIn },
      );
      const expiresAt = new Date(
        Date.now() + settings.expiresIn * 1000,
      ).toISOString();

      this.logger.log(
        `Agent attachment uploaded: ${settings.bucket}/${objectKey}, size=${file.size}, expires=${expiresAt}`,
      );

      return {
        originalName: file.originalname,
        fileName: objectKey.split('/').pop() || objectKey,
        objectKey,
        url,
        size: file.size,
        mimeType: file.mimetype,
        expiresAt,
        expiresIn: settings.expiresIn,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Agent attachment S3 upload failed: ${message}`);
      throw new InternalServerErrorException(
        '附件上传到 S3 失败，请检查对象存储配置',
      );
    }
  }

  async uploadAgentFiles(
    files: Express.Multer.File[],
  ): Promise<S3UploadedFile[]> {
    return Promise.all(files.map((file) => this.uploadAgentFile(file)));
  }

  /**
   * 删除文件
   */
  deleteFile(fileName: string): void {
    // TODO: 实际删除磁盘文件
    this.logger.log(`File deleted: ${fileName}`);
  }

  private getS3Settings(): S3Settings {
    if (this.s3Settings) return this.s3Settings;

    const endpoint = this.normalizeEndpoint(process.env.S3_ENDPOINT);
    const publicEndpoint = this.normalizeEndpoint(
      process.env.S3_FILE_URL || process.env.S3_ENDPOINT,
    );
    const accessKeyId = process.env.S3_ACCESS_KEY?.trim();
    const secretAccessKey = process.env.S3_SECRET_KEY?.trim();
    const bucket = process.env.S3_BUCKET_NAME?.trim();
    if (
      !endpoint ||
      !publicEndpoint ||
      !accessKeyId ||
      !secretAccessKey ||
      !bucket
    ) {
      throw new ServiceUnavailableException(
        'S3 未完整配置，需要 S3_ENDPOINT、S3_ACCESS_KEY、S3_SECRET_KEY、S3_BUCKET_NAME',
      );
    }

    const requestedExpiry = Number(process.env.S3_SIGNED_URL_EXPIRES || 604800);
    // AWS Signature V4 的预签名 URL 最长为 7 天。
    const expiresIn = Math.max(
      300,
      Math.min(
        604800,
        Number.isFinite(requestedExpiry) ? requestedExpiry : 604800,
      ),
    );
    const clientConfig = {
      region: process.env.S3_REGION?.trim() || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    };

    this.s3Settings = {
      bucket,
      expiresIn,
      uploadClient: new S3Client({ ...clientConfig, endpoint }),
      signingClient: new S3Client({
        ...clientConfig,
        endpoint: publicEndpoint,
      }),
    };
    return this.s3Settings;
  }

  private ensureS3Bucket(settings: S3Settings): Promise<void> {
    if (this.ensureBucketPromise) return this.ensureBucketPromise;

    this.ensureBucketPromise = (async () => {
      try {
        await settings.uploadClient.send(
          new HeadBucketCommand({ Bucket: settings.bucket }),
        );
      } catch (error) {
        const statusCode = (
          error as { $metadata?: { httpStatusCode?: number } }
        ).$metadata?.httpStatusCode;
        const errorName = error instanceof Error ? error.name : '';
        if (
          statusCode !== 404 &&
          errorName !== 'NotFound' &&
          errorName !== 'NoSuchBucket'
        ) {
          throw error;
        }

        try {
          await settings.uploadClient.send(
            new CreateBucketCommand({ Bucket: settings.bucket }),
          );
          this.logger.log(`Created S3 bucket: ${settings.bucket}`);
        } catch (createError) {
          const createName =
            createError instanceof Error ? createError.name : '';
          if (
            createName !== 'BucketAlreadyOwnedByYou' &&
            createName !== 'BucketAlreadyExists'
          ) {
            throw createError;
          }
        }
      }
    })().catch((error) => {
      this.ensureBucketPromise = undefined;
      throw error;
    });

    return this.ensureBucketPromise;
  }

  private normalizeEndpoint(value: string | undefined): string {
    const endpoint = value?.trim().replace(/\/+$/, '') || '';
    if (
      !endpoint ||
      endpoint.startsWith('http://') ||
      endpoint.startsWith('https://')
    ) {
      return endpoint;
    }
    const secure = process.env.S3_SECURE?.toLowerCase() !== 'false';
    return `${secure ? 'https' : 'http'}://${endpoint}`;
  }
}
