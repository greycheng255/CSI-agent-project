import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import type { AgentPanelProps } from './types';
import { AttachmentUpload, ChoicePills, PanelHeader, PanelInput, PanelTextarea, SubmitBlock } from './shared';

const CATEGORY_OPTIONS = [
  '通用', '增值税专票', '增值税普票', '电子发票', '数电发票', '酒店住宿',
  '餐饮', '机票', '火车票', '出租车', '办公用品',
];

export default function InvoicePlugin(props: AgentPanelProps) {
  const [mode, setMode] = useState<'text' | 'image' | 'pdf'>(
    props.formValues.pdf_url ? 'pdf' : props.formValues.image_urls ? 'image' : 'text',
  );

  return (
    <div className="space-y-3">
      <PanelHeader
        icon={<CreditCard className="h-5 w-5" />}
        title="财务发票识别"
        description="支持文本、图片附件和 PDF 附件三种输入，输出发票主表与明细。"
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
          props.updateField('image_urls', nextMode === 'image' ? props.formValues.image_urls || '' : '');
          props.updateField('pdf_url', nextMode === 'pdf' ? props.formValues.pdf_url || '' : '');
        }}
        options={[
          { value: 'text', label: '文本' },
          { value: 'image', label: '上传图片' },
          { value: 'pdf', label: '上传 PDF' },
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
        <AttachmentUpload
          label="发票图片"
          value={props.formValues.image_urls || ''}
          onChange={(value) => props.updateField('image_urls', value)}
          accept="image/*"
          multiple
          maxFiles={10}
        />
      )}
      {mode === 'pdf' && (
        <div className="grid gap-3 md:grid-cols-2">
          <AttachmentUpload
            label="发票 PDF"
            value={props.formValues.pdf_url || ''}
            onChange={(value) => props.updateField('pdf_url', value)}
            accept="application/pdf"
            onUploaded={(files) => {
              if (files[0]) props.updateField('pdf_name', files[0].originalName);
            }}
          />
          <PanelInput
            label="PDF 文件名"
            value={props.formValues.pdf_name || 'invoice.pdf'}
            onChange={(value) => props.updateField('pdf_name', value)}
          />
        </div>
      )}
      <ChoicePills
        label="类别提示"
        value={props.formValues.category_hint || '通用'}
        onChange={(value) => props.updateField('category_hint', value)}
        accent={props.accent}
        options={CATEGORY_OPTIONS.map((value) => ({ value, label: value }))}
      />
      <SubmitBlock
        submitting={props.submitting}
        onSubmit={props.onSubmit}
        error={props.runError}
        taskId={props.taskId}
        label="开始识别发票"
        accent={props.accent}
      />
    </div>
  );
}
