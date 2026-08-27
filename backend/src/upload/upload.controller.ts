import {
  Controller,
  Post,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadService } from './upload.service';

const AGENT_ATTACHMENT_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (
    _request: Express.Request,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const allowed =
      file.mimetype.startsWith('image/') ||
      file.mimetype.startsWith('audio/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype === 'application/pdf';
    callback(
      allowed
        ? null
        : new BadRequestException('仅支持图片、音频、视频或 PDF 附件'),
      allowed,
    );
  },
};

@Controller('api/v1/upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  /**
   * 单文件上传
   */
  @Post('file')
  @UseInterceptors(FileInterceptor('file'))
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const result = this.uploadService.uploadFile(file);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * 多文件上传
   */
  @Post('files')
  @UseInterceptors(FilesInterceptor('files', 10))
  uploadFiles(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const results = this.uploadService.uploadFiles(files);

    return {
      success: true,
      data: results,
    };
  }

  /** 智能体单附件上传到 S3，并返回长有效期签名 URL。 */
  @Post('agent-file')
  @UseInterceptors(FileInterceptor('file', AGENT_ATTACHMENT_OPTIONS))
  async uploadAgentFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    return {
      success: true,
      data: await this.uploadService.uploadAgentFile(file),
    };
  }

  /** 智能体多附件上传到 S3，最多 10 个。 */
  @Post('agent-files')
  @UseInterceptors(FilesInterceptor('files', 10, AGENT_ATTACHMENT_OPTIONS))
  async uploadAgentFiles(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    return {
      success: true,
      data: await this.uploadService.uploadAgentFiles(files),
    };
  }
}
