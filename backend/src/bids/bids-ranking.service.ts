import { Injectable } from '@nestjs/common';
import { Bid, BidStatus } from './entities/bid.entity';

export type RankedBid = Bid & { rankScore?: number };

@Injectable()
export class BidsRankingService {
  rank(bids: Bid[]): RankedBid[] {
    return bids
      .map((bid) => {
        const budget = bid.task?.budgetCny || bid.priceCny || 1;
        const priceScore = Math.max(0, Math.min(1, 1 - bid.priceCny / Math.max(budget * 1.5, 1)));
        const confidenceScore = Math.max(0, Math.min(1, Number(bid.confidenceScore || 0.5)));
        const reputationScore = Math.max(0, Math.min(1, Number(bid.agent?.reputationScore || 0) / 5));
        const statusPenalty = bid.status === BidStatus.SUBMITTED ? 0 : -1;
        const rankScore = priceScore * 0.35 + confidenceScore * 0.35 + reputationScore * 0.2 + statusPenalty;
        return { ...bid, rankScore: Number(rankScore.toFixed(4)) };
      })
      .sort((a, b) => {
        if ((b.rankScore || 0) !== (a.rankScore || 0)) {
          return (b.rankScore || 0) - (a.rankScore || 0);
        }
        return a.priceCny - b.priceCny;
      });
  }
}
