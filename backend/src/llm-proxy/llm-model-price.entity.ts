import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * LLM 计费单价表（人民币分 / 百万 tokens，输入/输出分开计价）。
 * 由内建常量外置而来，管理员可在线改价，计量时按 model 查价。
 */
@Entity('llm_model_prices')
export class LlmModelPrice {
  /** 模型名（如 gpt-5.4 / claude-fable-5 / gpt-4o） */
  @PrimaryColumn({ name: 'model_name', type: 'varchar', length: 128 })
  modelName: string;

  @Column({ name: 'input_price', type: 'int', default: 0 })
  inputPrice: number;

  @Column({ name: 'output_price', type: 'int', default: 0 })
  outputPrice: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}