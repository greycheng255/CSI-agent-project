import { useState } from 'react';
import { Upload, Eye, Code, FileText, Link as LinkIcon, Image as ImageIcon, Loader2 } from 'lucide-react';
import { submitDelivery } from '../api/deliveryApi';

interface DeliveryFormProps {
  orderId: string;
  userId: string;
  onSuccess: () => void;
  onCancel: () => void;
  embedded?: boolean;
}

type PreviewType = 'code' | 'text' | 'link' | 'image';

export default function DeliveryForm({
  orderId,
  userId,
  onSuccess,
  onCancel,
  embedded = false,
}: DeliveryFormProps) {
  const [deliverySummary, setDeliverySummary] = useState('');
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const [artifactUrlsText, setArtifactUrlsText] = useState('');
  const [evidenceBundleText, setEvidenceBundleText] = useState('');
  const [commitHash, setCommitHash] = useState('');
  const [previewType, setPreviewType] = useState<PreviewType>('text');
  const [previewContent, setPreviewContent] = useState('');
  const [previewLanguage, setPreviewLanguage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const containerClass = embedded
    ? 'py-6'
    : 'rounded-2xl border border-[color:var(--border)] bg-white p-5 md:p-6';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!deliverySummary.trim() && !deliveryUrl.trim() && !artifactUrlsText.trim() && !previewContent.trim()) {
      setError('请至少填写交付说明、附件链接或预览内容');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      const previewData = previewContent
        ? {
            type: previewType,
            content: previewContent,
            language: previewType === 'code' ? previewLanguage : undefined,
          }
        : undefined;
      const artifactUrls = artifactUrlsText
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean);
      let evidenceBundle: Record<string, unknown> | undefined;
      if (evidenceBundleText.trim()) {
        try {
          const parsed = JSON.parse(evidenceBundleText);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('invalid evidence bundle');
          }
          evidenceBundle = parsed as Record<string, unknown>;
        } catch {
          setError('证据包必须是合法 JSON 对象');
          setSubmitting(false);
          return;
        }
      }

      await submitDelivery(orderId, userId, {
        deliverySummary: deliverySummary || undefined,
        deliveryUrl: deliveryUrl || undefined,
        artifactUrls: artifactUrls.length > 0 ? artifactUrls : undefined,
        evidenceBundle,
        commitHash: commitHash.trim() || undefined,
        previewData,
      });

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const renderPreview = () => {
    switch (previewType) {
      case 'code':
        return (
          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
            <code>{previewContent}</code>
          </pre>
        );
      case 'text':
        return (
          <div className="bg-gray-50 p-4 rounded-lg whitespace-pre-wrap text-gray-700">
            {previewContent}
          </div>
        );
      case 'link':
        return (
          <a
            href={previewContent}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline break-all"
          >
            {previewContent}
          </a>
        );
      case 'image':
        return (
                    <img
                      loading="lazy"
            src={previewContent}
            alt="预览"
            className="max-w-full h-auto rounded-lg"
            onError={() => setError('图片加载失败')}
          />
        );
      default:
        return null;
    }
  };

  return (
    <section className={containerClass}>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">提交交付物</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 交付说明 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            交付说明
          </label>
          <textarea
            value={deliverySummary}
            onChange={(e) => setDeliverySummary(e.target.value)}
            placeholder="描述本次交付的内容..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* 附件链接 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            附件链接
          </label>
          <div className="flex items-center">
            <LinkIcon className="w-5 h-5 text-gray-400 mr-2" />
            <input
              type="url"
              value={deliveryUrl}
              onChange={(e) => setDeliveryUrl(e.target.value)}
              placeholder="https://..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* 预览内容 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            交付材料链接列表
          </label>
          <textarea
            value={artifactUrlsText}
            onChange={(e) => setArtifactUrlsText(e.target.value)}
            placeholder="每行一个链接，例如代码仓库、结果文件、报告地址"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Commit Hash
          </label>
          <input
            type="text"
            value={commitHash}
            onChange={(e) => setCommitHash(e.target.value)}
            placeholder="例如 9f4d2a1 或完整提交哈希"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            证据包 JSON
          </label>
          <textarea
            value={evidenceBundleText}
            onChange={(e) => setEvidenceBundleText(e.target.value)}
            placeholder='{"tests":["npm test"],"result":"passed","notes":"..."}'
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              预览内容（可选）
            </label>
            <div className="flex items-center space-x-2">
              {(['text', 'code', 'link', 'image'] as PreviewType[]).map((type) => {
                const icons = {
                  text: FileText,
                  code: Code,
                  link: LinkIcon,
                  image: ImageIcon,
                };
                const Icon = icons[type];
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setPreviewType(type)}
                    className={`p-2 rounded-lg transition-colors ${
                      previewType === type
                        ? 'bg-blue-100 text-blue-600'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                    title={type === 'text' ? '文本' : type === 'code' ? '代码' : type === 'link' ? '链接' : '图片'}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>

          {previewType === 'code' && (
            <div className="mb-2">
              <select
                value={previewLanguage}
                onChange={(e) => setPreviewLanguage(e.target.value)}
                className="px-3 py-1 border border-gray-300 rounded text-sm"
              >
                <option value="">选择语言</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="html">HTML</option>
                <option value="css">CSS</option>
                <option value="json">JSON</option>
                <option value="sql">SQL</option>
                <option value="bash">Bash</option>
              </select>
            </div>
          )}

          <textarea
            value={previewContent}
            onChange={(e) => setPreviewContent(e.target.value)}
            placeholder={
              previewType === 'code'
                ? '粘贴代码...'
                : previewType === 'link'
                ? '粘贴链接...'
                : previewType === 'image'
                ? '粘贴图片URL...'
                : '粘贴文本内容...'
            }
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
          />

          {previewContent && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowPreview(!showPreview)}
                className="flex items-center text-sm text-blue-600 hover:text-blue-800"
              >
                <Eye className="w-4 h-4 mr-1" />
                {showPreview ? '隐藏预览' : '显示预览'}
              </button>

              {showPreview && (
                <div className="mt-2 border border-gray-200 rounded-lg p-4">
                  {renderPreview()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 按钮 */}
        <div className="flex items-center justify-end space-x-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="px-4 py-2 text-gray-700 hover:text-gray-900"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                提交中...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                提交交付物
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
