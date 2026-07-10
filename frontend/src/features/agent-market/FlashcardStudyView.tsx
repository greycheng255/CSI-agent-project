import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  RotateCcw,
  Tag,
  X,
} from 'lucide-react';

type FlashcardStudyViewProps = {
  cards: unknown[];
  cardStyle?: unknown;
};

type Flashcard = {
  front: string;
  back: string;
  tag: string;
};

type ReviewResult = 'retry' | 'mastered';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cardText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeCards(cards: unknown[]) {
  return cards
    .map((value, index): Flashcard | null => {
      if (!isRecord(value)) return null;
      const front = cardText(value.front) || `卡片 ${index + 1}`;
      const back = cardText(value.back);
      if (!back) return null;
      return {
        front,
        back,
        tag: cardText(value.tag) || '知识点',
      };
    })
    .filter((card): card is Flashcard => card !== null);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName);
}

export function FlashcardStudyView({ cards: rawCards, cardStyle }: FlashcardStudyViewProps) {
  const cards = useMemo(() => normalizeCards(rawCards), [rawCards]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [reviewResults, setReviewResults] = useState<Record<number, ReviewResult>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const safeIndex = Math.min(currentIndex, Math.max(cards.length - 1, 0));
  const currentCard = cards[safeIndex];

  const changeCard = useCallback(
    (direction: -1 | 1) => {
      setCurrentIndex((index) => Math.min(Math.max(index + direction, 0), cards.length - 1));
      setFlipped(false);
    },
    [cards.length],
  );

  const flipCard = useCallback(() => setFlipped((value) => !value), []);

  const reviewCard = useCallback(
    (result: ReviewResult) => {
      setReviewResults((previous) => ({ ...previous, [safeIndex]: result }));
      if (safeIndex < cards.length - 1) {
        setCurrentIndex(safeIndex + 1);
        setFlipped(false);
      }
    },
    [cards.length, safeIndex],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      if (event.code === 'Space') {
        event.preventDefault();
        flipCard();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        changeCard(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        changeCard(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeCard, flipCard]);

  const enterFullscreen = useCallback(() => {
    void rootRef.current?.requestFullscreen();
  }, []);

  const retryCount = Object.values(reviewResults).filter((result) => result === 'retry').length;
  const masteredCount = Object.values(reviewResults).filter((result) => result === 'mastered').length;
  const styleLabel = typeof cardStyle === 'string' && cardStyle.trim() ? cardStyle.trim() : '速记卡片';
  const currentResult = reviewResults[safeIndex];

  if (!currentCard) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
        返回结果中没有可复习的卡片。
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="mx-auto w-full max-w-5xl bg-[#0a0a0a] py-2 text-gray-100 fullscreen:max-w-none fullscreen:overflow-auto fullscreen:p-6"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-xl font-semibold text-white sm:text-2xl">速记卡片</h4>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-cyan-300">
              {styleLabel}
            </span>
            <span>{cards.length} 张卡片</span>
          </div>
        </div>
        <button
          type="button"
          onClick={enterFullscreen}
          title="全屏复习"
          aria-label="全屏复习"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-800 text-gray-400 transition-colors hover:border-cyan-400/40 hover:text-cyan-300"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      <p className="mb-5 text-center text-xs text-gray-500 sm:text-sm">
        按 <kbd className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono text-gray-300">Space</kbd>{' '}
        翻面，按 <kbd className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono text-gray-300">←</kbd> /{' '}
        <kbd className="rounded border border-gray-700 bg-gray-900 px-1.5 py-0.5 font-mono text-gray-300">→</kbd> 切换
      </p>

      <div className="[perspective:1800px]">
        <button
          type="button"
          onClick={flipCard}
          aria-label={flipped ? '显示卡片问题' : '显示卡片答案'}
          className="block h-[clamp(430px,54vw,650px)] w-full rounded-[2rem] text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
        >
          <span
            className="relative block h-full w-full transition-transform duration-500 [transform-style:preserve-3d]"
            style={{ transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
          >
            <span
              className="absolute inset-0 flex flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-[#303236] via-[#292b2e] to-[#222427] p-6 shadow-2xl sm:p-10"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            >
              <span className="flex items-center justify-between gap-4 text-sm text-gray-400 sm:text-base">
                <span className="font-mono font-semibold">{safeIndex + 1} / {cards.length}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3 py-1 text-xs text-gray-300">
                  <Tag className="h-3.5 w-3.5 text-cyan-300" />
                  {currentCard.tag}
                </span>
              </span>
              <span className="flex flex-1 items-center">
                <span className="max-w-4xl text-[clamp(1.65rem,3.6vw,3.5rem)] font-medium leading-[1.24] tracking-tight text-white">
                  {currentCard.front}
                </span>
              </span>
              <span className="text-center text-sm text-gray-400 sm:text-base">点击或按空格查看答案</span>
            </span>

            <span
              className="absolute inset-0 flex flex-col overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-gradient-to-br from-[#123238] via-[#102a2e] to-[#0d2024] p-6 shadow-2xl sm:p-10"
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <span className="flex items-center justify-between gap-4 text-sm text-cyan-100/60 sm:text-base">
                <span className="font-mono font-semibold">答案 · {safeIndex + 1} / {cards.length}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-950/60 px-3 py-1 text-xs text-cyan-200">
                  <Tag className="h-3.5 w-3.5" />
                  {currentCard.tag}
                </span>
              </span>
              <span className="flex flex-1 items-center">
                <span className="max-w-4xl text-[clamp(1.4rem,3vw,3rem)] font-medium leading-[1.42] tracking-tight text-cyan-50">
                  {currentCard.back}
                </span>
              </span>
              <span className="text-center text-sm text-cyan-100/50 sm:text-base">点击或按空格返回问题</span>
            </span>
          </span>
        </button>
      </div>

      <div className="mt-5 grid grid-cols-4 items-center gap-2 sm:gap-4">
        <button
          type="button"
          onClick={() => changeCard(-1)}
          disabled={safeIndex === 0}
          aria-label="上一张"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-gray-700 text-gray-400 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 sm:h-14 sm:w-14"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={() => reviewCard('retry')}
          className={`flex h-12 items-center justify-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors sm:h-14 ${
            currentResult === 'retry'
              ? 'border-red-400 bg-red-400/15 text-red-300'
              : 'border-gray-700 text-red-400 hover:border-red-400/60 hover:bg-red-400/10'
          }`}
        >
          <X className="h-5 w-5" />
          <span className="hidden sm:inline">还需复习</span>
          <span>{retryCount}</span>
        </button>

        <button
          type="button"
          onClick={() => reviewCard('mastered')}
          className={`flex h-12 items-center justify-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors sm:h-14 ${
            currentResult === 'mastered'
              ? 'border-emerald-400 bg-emerald-400/15 text-emerald-300'
              : 'border-gray-700 text-emerald-400 hover:border-emerald-400/60 hover:bg-emerald-400/10'
          }`}
        >
          <span>{masteredCount}</span>
          <span className="hidden sm:inline">已掌握</span>
          <Check className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={() => changeCard(1)}
          disabled={safeIndex === cards.length - 1}
          aria-label="下一张"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-cyan-400/70 text-cyan-300 transition-colors hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:border-gray-700 disabled:text-gray-600 disabled:opacity-40 sm:h-14 sm:w-14"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-900">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-[width] duration-300"
            style={{ width: `${((safeIndex + 1) / cards.length) * 100}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            setReviewResults({});
            setCurrentIndex(0);
            setFlipped(false);
          }}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-cyan-300"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重新复习
        </button>
      </div>
    </div>
  );
}
