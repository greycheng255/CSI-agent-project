import { yuanStringToFen } from './online-payment.service';
import { OnlinePaymentService } from './online-payment.service';
import {
  Payment,
  PaymentProvider,
  PaymentStatus,
} from './entities/payment.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { PaymentNotification } from './entities/payment-notification.entity';
import { OrderPayment } from './entities/order-payment.entity';
import type { Repository, DataSource, EntityManager } from 'typeorm';
import type { AlipayClientService } from './alipay-client.service';
import type { WebhooksService } from '../webhooks/webhooks.service';

describe('yuanStringToFen', () => {
  it.each([
    ['0', 0],
    ['0.01', 1],
    ['12.3', 1230],
    ['100.00', 10000],
  ])('converts %s yuan to integer fen', (input, expected) => {
    expect(yuanStringToFen(input)).toBe(expected);
  });

  it.each(['', '-1', '1.001', '1e2', 'NaN', ' 1.234 '])(
    'rejects an invalid amount: %s',
    (input) => {
      expect(yuanStringToFen(input)).toBeNull();
    },
  );
});

describe('OnlinePaymentService callback settlement', () => {
  it('settles one verified callback once and advances the order', async () => {
    const order = {
      id: 'order-1',
      status: OrderStatus.PENDING_PAYMENT,
      amountCny: 1234,
      platformFeeRate: 0,
      platformFeeCny: null,
      payoutCny: null,
      escrowedAt: null,
    } as Order;
    const payment = {
      id: 'payment-1',
      provider: PaymentProvider.ALIPAY,
      outTradeNo: 'CSI-1',
      tradeNo: null,
      amountCny: 1234,
      status: PaymentStatus.INIT,
      rawNotify: null,
      paidAt: null,
      order,
      createdAt: new Date(),
    } as Payment;
    let notification: PaymentNotification | null = null;
    let orderPayment: OrderPayment | null = null;

    const notificationRepo = {
      findOne: jest.fn(() => Promise.resolve(notification)),
      create: jest.fn((value: PaymentNotification) => value),
      save: jest.fn((value: PaymentNotification) => {
        if (!value.id) value.id = 'notification-1';
        notification = value;
        return Promise.resolve(value);
      }),
    } as unknown as Repository<PaymentNotification>;

    const manager = {
      findOne: jest.fn((entity: unknown) => {
        if (entity === Payment) return Promise.resolve(payment);
        if (entity === PaymentNotification)
          return Promise.resolve(notification);
        if (entity === OrderPayment) return Promise.resolve(orderPayment);
        return Promise.resolve(null);
      }),
      create: jest.fn((entity: unknown, value: unknown) => {
        if (entity === OrderPayment) orderPayment = value as OrderPayment;
        return value;
      }),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    } as unknown as EntityManager;
    const transaction = jest.fn(
      (work: (entityManager: EntityManager) => Promise<void>) => work(manager),
    );
    const dataSource = {
      options: { type: 'sqlite' },
      transaction,
    } as unknown as DataSource;
    const alipay = {
      verifyNotification: jest.fn(() => true),
      appId: 'app-1',
      sellerId: 'seller-1',
    } as unknown as AlipayClientService;
    const notifyOrderPaid = jest.fn(() => Promise.resolve());
    const webhooks = { notifyOrderPaid } as unknown as WebhooksService;

    const service = new OnlinePaymentService(
      {} as Repository<Payment>,
      {} as Repository<Order>,
      notificationRepo,
      dataSource,
      alipay,
      webhooks,
    );
    const params = {
      notify_id: 'notify-1',
      out_trade_no: 'CSI-1',
      trade_no: '20260830001',
      trade_status: 'TRADE_SUCCESS',
      total_amount: '12.34',
      app_id: 'app-1',
      seller_id: 'seller-1',
      sign: 'verified-by-mock',
    };

    await expect(service.handleAlipayNotification(params)).resolves.toBe(true);
    await expect(service.handleAlipayNotification(params)).resolves.toBe(true);

    expect(payment.status).toBe(PaymentStatus.PAID);
    expect(payment.tradeNo).toBe('20260830001');
    expect(order.status).toBe(OrderStatus.IN_PROGRESS);
    expect(orderPayment?.paymentStatus).toBe('CONFIRMED');
    expect(notification?.processed).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(notifyOrderPaid).toHaveBeenCalledTimes(1);
  });
});
