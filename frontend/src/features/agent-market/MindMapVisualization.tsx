import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GitFork,
  Loader2,
  Maximize2,
  Network,
  Waypoints,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { EdgeData, Graph, GraphOptions, NodeData } from '@antv/g6';

type MindMapLayout = 'mindmap' | 'dendrogram' | 'fishbone';

type MindMapNode = {
  id: string;
  data: {
    label: string;
  };
  children?: MindMapNode[];
};

type MindMapVisualizationProps = {
  tree: unknown;
  initialLayout?: unknown;
};

const LAYOUT_OPTIONS: Array<{
  value: MindMapLayout;
  label: string;
  icon: typeof Network;
}> = [
  { value: 'mindmap', label: '思维导图', icon: Network },
  { value: 'dendrogram', label: '辐射图', icon: Waypoints },
  { value: 'fishbone', label: '鱼骨图', icon: GitFork },
];

const BRANCH_COLORS = ['#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#a78bfa'];
const GRAPH_HEIGHT = 560;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveLayout(value: unknown): MindMapLayout {
  return value === 'dendrogram' || value === 'fishbone' ? value : 'mindmap';
}

function resolveLabel(node: Record<string, unknown>) {
  const data = isRecord(node.data) ? node.data : {};
  const candidates = [data.label, node.label, node.title, node.name];
  const label = candidates.find((value) => typeof value === 'string' && value.trim());
  return typeof label === 'string' ? label.trim() : '未命名节点';
}

function normalizeTree(tree: unknown): MindMapNode | null {
  if (!isRecord(tree)) return null;

  const usedIds = new Set<string>();

  const visit = (value: unknown, path: string): MindMapNode | null => {
    if (!isRecord(value)) return null;

    const rawId = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `node-${path}`;
    let id = rawId;
    let suffix = 1;
    while (usedIds.has(id)) {
      id = `${rawId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    const children = (Array.isArray(value.children) ? value.children : [])
      .map((child, index) => visit(child, `${path}-${index}`))
      .filter((child): child is MindMapNode => child !== null);

    return {
      id,
      data: { label: resolveLabel(value) },
      ...(children.length > 0 ? { children } : {}),
    };
  };

  return visit(tree, 'root');
}

function collectNodeMeta(root: MindMapNode) {
  const branchById = new Map<string, number>();
  let count = 0;

  const visit = (node: MindMapNode, branchIndex: number) => {
    count += 1;
    branchById.set(node.id, branchIndex);
    node.children?.forEach((child) => visit(child, branchIndex));
  };

  count += 1;
  branchById.set(root.id, 0);
  root.children?.forEach((child, index) => visit(child, index));

  return { branchById, count };
}

function nodeLabel(node: NodeData) {
  const label = node.data?.label;
  return typeof label === 'string' && label.trim() ? label.trim() : String(node.id);
}

function nodeSize(label: string, isRoot: boolean): [number, number] {
  const fontSize = isRoot ? 14 : 12;
  const length = Array.from(label).length;
  const width = Math.min(300, Math.max(isRoot ? 132 : 88, length * fontSize + 28));
  const wraps = length * fontSize + 28 > 300;
  return [width, wraps ? (isRoot ? 62 : 54) : isRoot ? 42 : 34];
}

function layoutConfig(layout: MindMapLayout): NonNullable<GraphOptions['layout']> {
  if (layout === 'mindmap') {
    return {
      type: 'mindmap',
      direction: 'H',
      getHeight: (node: NodeData) => nodeSize(nodeLabel(node), (node.depth ?? 0) === 0)[1],
      getWidth: (node: NodeData) => nodeSize(nodeLabel(node), (node.depth ?? 0) === 0)[0],
      getVGap: () => 22,
      getHGap: () => 64,
    };
  }

  if (layout === 'dendrogram') {
    return {
      type: 'dendrogram',
      direction: 'LR',
      nodeSep: 52,
      rankSep: 170,
    };
  }

  return {
    type: 'fishbone',
    direction: 'RL',
    hGap: 72,
    vGap: 42,
  };
}

export function MindMapVisualization({ tree, initialLayout }: MindMapVisualizationProps) {
  const normalizedTree = useMemo(() => normalizeTree(tree), [tree]);
  const nodeMeta = useMemo(
    () => (normalizedTree ? collectNodeMeta(normalizedTree) : null),
    [normalizedTree],
  );
  const [layout, setLayout] = useState<MindMapLayout>(() => resolveLayout(initialLayout));
  const [loading, setLoading] = useState(true);
  const [renderError, setRenderError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);

  useEffect(() => {
    if (!normalizedTree || !nodeMeta || !containerRef.current) {
      setLoading(false);
      return;
    }

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    const container = containerRef.current;

    setLoading(true);
    setRenderError('');

    const renderGraph = async () => {
      try {
        const { Graph: G6Graph, treeToGraphData } = await import('@antv/g6');
        if (disposed) return;

        const graph = new G6Graph({
          container,
          width: container.clientWidth || 720,
          height: GRAPH_HEIGHT,
          autoFit: 'view',
          data: treeToGraphData(normalizedTree),
          padding: [48, 64, 48, 64],
          layout: layoutConfig(layout),
          background: 'transparent',
          node: {
            type: 'rect',
            style: (node: NodeData) => {
              const depth = node.depth ?? 0;
              const isRoot = depth === 0;
              const label = nodeLabel(node);
              const size = nodeSize(label, isRoot);
              const branch = nodeMeta.branchById.get(String(node.id)) ?? 0;
              const color = BRANCH_COLORS[branch % BRANCH_COLORS.length];

              return {
                size,
                radius: isRoot ? 10 : 7,
                fill: isRoot ? `${color}2b` : '#0c1420',
                stroke: isRoot ? color : `${color}b3`,
                lineWidth: isRoot ? 2 : 1.25,
                shadowColor: isRoot ? `${color}55` : 'transparent',
                shadowBlur: isRoot ? 14 : 0,
                labelText: label,
                labelFill: isRoot ? '#f8fafc' : '#d1d5db',
                labelFontSize: isRoot ? 14 : 12,
                labelFontWeight: isRoot ? 700 : 500,
                labelFontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
                labelPlacement: 'center',
                labelWordWrap: true,
                labelWordWrapWidth: size[0] - 24,
                labelMaxLines: 2,
                labelTextOverflow: 'ellipsis',
                labelLineHeight: isRoot ? 18 : 16,
                cursor: 'grab',
              };
            },
          },
          edge: {
            type: layout === 'fishbone' ? 'polyline' : 'cubic-horizontal',
            style: (edge: EdgeData) => {
              const branch = nodeMeta.branchById.get(String(edge.target)) ?? 0;
              const color = BRANCH_COLORS[branch % BRANCH_COLORS.length];
              return {
                stroke: `${color}cc`,
                lineWidth: 1.6,
                endArrow: false,
              };
            },
          },
          behaviors: ['zoom-canvas', 'drag-canvas'],
          animation: true,
        });

        graphRef.current = graph;
        await graph.render();
        if (disposed) {
          graph.destroy();
          return;
        }

        resizeObserver = new ResizeObserver(([entry]) => {
          const width = Math.floor(entry?.contentRect.width ?? 0);
          if (width > 0 && !disposed) {
            graph.setSize(width, GRAPH_HEIGHT);
          }
        });
        resizeObserver.observe(container);
      } catch (error) {
        if (!disposed) {
          setRenderError(error instanceof Error ? error.message : '导图渲染失败');
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void renderGraph();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [layout, nodeMeta, normalizedTree]);

  const handleFitView = useCallback(() => {
    void graphRef.current?.fitView({}, { duration: 300 });
  }, []);

  const handleZoomIn = useCallback(() => {
    const graph = graphRef.current;
    if (graph) void graph.zoomTo(Math.min(graph.getZoom() * 1.25, 4), { duration: 200 });
  }, []);

  const handleZoomOut = useCallback(() => {
    const graph = graphRef.current;
    if (graph) void graph.zoomTo(Math.max(graph.getZoom() / 1.25, 0.2), { duration: 200 });
  }, []);

  if (!normalizedTree || !nodeMeta) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
        返回结果中没有可渲染的导图节点。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="导图布局">
          {LAYOUT_OPTIONS.map((option) => {
            const active = layout === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setLayout(option.value)}
                disabled={loading}
                aria-pressed={active}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${
                  active
                    ? 'border-emerald-400/60 bg-emerald-400/10 text-emerald-300'
                    : 'border-gray-800 bg-black text-gray-500 hover:border-gray-700 hover:text-gray-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="text-xs text-gray-600">{nodeMeta.count} 个节点 · 滚轮缩放 · 拖拽移动</div>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-[#05080d]">
        <div ref={containerRef} className="w-full" style={{ height: GRAPH_HEIGHT }} />

        <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-lg border border-gray-700/70 bg-black/75 p-1 backdrop-blur">
          {[
            { label: '放大', icon: ZoomIn, action: handleZoomIn },
            { label: '缩小', icon: ZoomOut, action: handleZoomOut },
            { label: '适应画面', icon: Maximize2, action: handleFitView },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={item.action}
                disabled={loading || Boolean(renderError)}
                title={item.label}
                aria-label={item.label}
                className="flex h-8 w-8 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-[#05080d]/80 text-sm text-emerald-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在绘制{LAYOUT_OPTIONS.find((option) => option.value === layout)?.label}…
          </div>
        )}

        {renderError && (
          <div className="absolute inset-x-6 bottom-6 rounded-lg border border-red-500/20 bg-red-950/90 p-3 text-sm text-red-300">
            导图渲染失败：{renderError}
          </div>
        )}
      </div>
    </div>
  );
}
