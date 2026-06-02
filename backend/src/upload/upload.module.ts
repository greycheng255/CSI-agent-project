import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UploadService } from './upload.service';
import { UploadController } from './upload.controller';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// 确保上传目录存在
const uploadDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: (req, _file, cb) => {
          const folder =
            (req as unknown as { body?: { folder?: string } }).body?.folder ||
            'general';
          const dest = join(uploadDir, folder);
          if (!existsSync(dest)) {
            mkdirSync(dest, { recursive: true });
          }
          cb(null, dest);
        },
        filename: (req, file, cb) => {
          const timestamp = Date.now();
          const randomStr = Math.random().toString(36).substring(2, 8);
          cb(null, `${timestamp}-${randomStr}-${file.originalname}`);
        },
      }),
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
