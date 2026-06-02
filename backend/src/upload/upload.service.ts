import { Injectable, Logger } from '@nestjs/common';

export interface UploadedFile {
  originalName: string;
  fileName: string;
  url: string;
  size: number;
  mimeType: string;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

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

  /**
   * 删除文件
   */
  deleteFile(fileName: string): void {
    // TODO: 实际删除磁盘文件
    this.logger.log(`File deleted: ${fileName}`);
  }
}
