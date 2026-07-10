export type AgentUploadedAttachment = {
  originalName: string;
  fileName: string;
  objectKey: string;
  url: string;
  size: number;
  mimeType: string;
  expiresAt: string;
  expiresIn: number;
};

type UploadResponse = {
  success?: boolean;
  data?: AgentUploadedAttachment;
  message?: string;
  error?: string;
};

export async function uploadAgentAttachments(files: File[]): Promise<AgentUploadedAttachment[]> {
  if (files.length === 0) return [];

  return Promise.all(files.map(async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/v1/upload/agent-file', {
      method: 'POST',
      body: formData,
    });
    const payload = await response.json().catch(() => null) as UploadResponse | null;

    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || `附件上传失败 (${response.status})`);
    }
    if (!payload?.success || !payload.data?.url) {
      throw new Error('附件上传成功，但响应格式不正确');
    }

    return payload.data;
  }));
}
