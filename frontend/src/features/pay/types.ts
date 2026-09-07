export type OnlinePaymentStatus = 'PENDING' | 'PAID' | 'FAILED';

export interface AlipayPaymentState {
  paymentId: string;
  orderId: string;
  outTradeNo: string;
  status: OnlinePaymentStatus;
  orderStatus: string;
  /** 金额单位与 CSI 订单一致：分。 */
  amountCny: number;
  paidAt: string | null;
  expiresAt: string;
}

export interface CreateAlipayPaymentResult extends AlipayPaymentState {
  /** 已支付的幂等响应不会再次生成链接。 */
  paymentUrl: string | null;
}

/** 余额充值支付状态（无 orderId，按 outTradeNo 轮询） */
export interface RechargePaymentState {
  paymentId: string;
  outTradeNo: string;
  status: OnlinePaymentStatus;
  /** 金额单位：分 */
  amountCny: number;
  paidAt: string | null;
  expiresAt: string;
}

export interface CreateRechargePaymentResult extends RechargePaymentState {
  paymentUrl: string | null;
}
