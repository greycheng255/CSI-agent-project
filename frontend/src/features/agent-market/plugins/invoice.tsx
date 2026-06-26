import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { ChoicePills, PanelHeader, PanelInput, PanelTextarea, SubmitBlock } from './shared';

export default function InvoicePlugin(props: AgentPanelProps) {
  const [mode, setMode] = useState<'text' | 'image' | 'pdf'>(
    props.formValues.pdfUrl ? 'pdf' : props.formValues.imageUrls ? 'image' : 'text',
  );

  return (
    <div className="space-y-5">
      <PanelHeader
        icon={<CreditCard className="h-5 w-5" />}
        title="财务发票识别"
        description="支持文本、图片 URL 和 PDF URL 三种输入，输出发票主表与明细。"
        accent={props.accent}
      />
      <ChoicePills
        label="输入类型"
        value={mode}
        accent={props.accent}
        onChange={(value) => {
          const nextMode = value === 'image' ? 'image' : value === 'pdf' ? 'pdf' : 'text';
          setMode(nextMode);
          props.updateField('text', nextMode === 'text' ? props.formValues.text || '' : '');
          props.updateField('imageUrls', nextMode === 'image' ? props.formValues.imageUrls || '' : '');
          props.updateField('pdfUrl', nextMode === 'pdf' ? props.formValues.pdfUrl || '' : '');
        }}
        options={[
          { value: 'text', label: '文本' },
          { value: 'image', label: '图片 URL' },
          { value: 'pdf', label: 'PDF URL' },
        ]}
      />
      {mode === 'text' && (
        <PanelTextarea
          label="票据文本"
          value={props.formValues.text || ''}
          onChange={(value) => props.updateField('text', value)}
          placeholder="粘贴 OCR 文本或票据内容..."
          rows={8}
        />
      )}
      {mode === 'image' && (
        <PanelTextarea
          label="图片 URL"
          value={props.formValues.imageUrls || ''}
          onChange={(value) => props.updateField('imageUrls', value)}
          placeholder="每行一个发票图片 URL"
          rows={5}
        />
      )}
      {mode === 'pdf' && (
        <div className="grid gap-4 md:grid-cols-2">
          <PanelInput
            label="PDF URL"
            value={props.formValues.pdfUrl || ''}
            onChange={(value) => props.updateField('pdfUrl', value)}
          />
          <PanelInput
            label="PDF 文件名"
            value={props.formValues.pdfName || 'invoice.pdf'}
            onChange={(value) => props.updateField('pdfName', value)}
          />
        </div>
      )}
      <PanelInput
        label="类别提示"
        value={props.formValues.categoryHint || '通用'}
        onChange={(value) => props.updateField('categoryHint', value)}
        placeholder="住宿 / 差旅 / 办公 / 通用"
      />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="开始识别发票"
      />
    </div>
  );
}
