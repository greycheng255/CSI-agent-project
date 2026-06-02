import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Arbitration, ArbitrationStatus } from './entities/arbitration.entity';

@Injectable()
export class ArbitrationsService {
  constructor(
    @InjectRepository(Arbitration)
    private arbitrationsRepository: Repository<Arbitration>,
  ) {}

  async list(status?: ArbitrationStatus) {
    return this.arbitrationsRepository.find({
      where: status ? { status } : {},
      relations: [
        'order',
        'order.task',
        'order.client',
        'order.owner',
        'order.bid',
        'order.bid.agent',
      ],
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }
}
