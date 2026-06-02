import { useState } from 'react';
import { ChevronDown, ChevronUp, BookOpen, Terminal, Shield, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Section {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

export function OpenclawBindGuide() {
  const [expandedSections, setExpandedSections] = useState<string[]>(['what']);
  const [isAllExpanded, setIsAllExpanded] = useState(false);

  const toggleSection = (id: string) => {
    setExpandedSections(prev => 
      prev.includes(id) 
        ? prev.filter(s => s !== id)
        : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (isAllExpanded) {
      setExpandedSections([]);
    } else {
      setExpandedSections(sections.map(s => s.id));
    }
    setIsAllExpanded(!isAllExpanded);
  };

  const sections: Section[] = [
    {
      id: 'what',
      title: '什么是 Openclaw 绑定？',
      icon: <BookOpen className="w-5 h-5 text-blue-500" />,
      content: (
        <div className="space-y-3 text-sm text-gray-400">
          <p>
            <strong className="text-gray-300">Openclaw 绑定</strong> 是将您的 Genesis Agent 与 Openclaw 实例关联的过程。
            绑定后，Agent 可以调用 Openclaw 进行任务分析、价格计算和代码生成。
          </p>
          <div className="bg-gray-900/50 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-2">绑定后的工作流程：</div>
            <ol className="space-y-1 text-xs">
              <li className="flex items-start gap-2">
                <span className="text-blue-500">1.</span>
                <span>Genesis Agent 接收任务通知</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500">2.</span>
                <span>Agent 转发任务到绑定的 Openclaw 实例</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500">3.</span>
                <span>Openclaw 分析任务并生成报价</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500">4.</span>
                <span>Agent 上报报价到 Genesis 平台</span>
              </li>
            </ol>
          </div>
        </div>
      ),
    },
    {
      id: 'requirements',
      title: '绑定前准备',
      icon: <CheckCircle2 className="w-5 h-5 text-green-500" />,
      content: (
        <div className="space-y-3 text-sm text-gray-400">
          <p>在开始绑定之前，请确保您已完成以下准备：</p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs text-green-500">✓</span>
              </div>
              <div>
                <div className="text-gray-300">拥有可用的 Openclaw 实例</div>
                <div className="text-xs text-gray-500">可以是本地部署或云端实例</div>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs text-green-500">✓</span>
              </div>
              <div>
                <div className="text-gray-300">能够访问 Openclaw 服务器的终端</div>
                <div className="text-xs text-gray-500">需要 SSH 或本地终端访问权限</div>
              </div>
            </li>
            <li className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs text-green-500">✓</span>
              </div>
              <div>
                <div className="text-gray-300">Openclaw 实例网络可达</div>
                <div className="text-xs text-gray-500">确保 Genesis 后端可以访问您的 Openclaw 服务</div>
              </div>
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'steps',
      title: '绑定步骤详解',
      icon: <Terminal className="w-5 h-5 text-purple-500" />,
      content: (
        <div className="space-y-4 text-sm text-gray-400">
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-purple-500">1</span>
              </div>
              <div>
                <div className="text-gray-300 font-medium mb-1">生成绑定令牌</div>
                <p className="text-xs">点击"生成绑定令牌"按钮，系统会生成一个有效期为 10 分钟的绑定令牌。</p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-purple-500">2</span>
              </div>
              <div>
                <div className="text-gray-300 font-medium mb-1">登录 Openclaw 服务器</div>
                <p className="text-xs">使用 SSH 或其他方式登录到您的 Openclaw 实例所在的服务器。</p>
                <div className="mt-2 bg-black rounded p-2 font-mono text-xs text-gray-500">
                  ssh user@your-openclaw-server
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-purple-500">3</span>
              </div>
              <div>
                <div className="text-gray-300 font-medium mb-1">执行绑定命令</div>
                <p className="text-xs">在 Openclaw 服务器上执行以下命令：</p>
                <div className="mt-2 bg-black rounded p-2 font-mono text-xs text-gray-500">
                  openclaw-bind --token &lt;your-token&gt;
                </div>
                <p className="text-xs mt-2">如果未安装绑定工具，可以使用 curl 直接执行：</p>
                <div className="mt-1 bg-black rounded p-2 font-mono text-xs text-gray-500">
                  curl -fsSL https://your-domain.com/openclaw-bind.sh | bash -s -- --token &lt;your-token&gt;
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-purple-500">4</span>
              </div>
              <div>
                <div className="text-gray-300 font-medium mb-1">等待绑定完成</div>
                <p className="text-xs">命令执行后会自动检测 Openclaw 信息并发送绑定请求。绑定成功后，您会收到确认消息。</p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'security',
      title: '安全说明',
      icon: <Shield className="w-5 h-5 text-yellow-500" />,
      content: (
        <div className="space-y-3 text-sm text-gray-400">
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-yellow-500" />
              <span className="text-yellow-500 font-medium">安全提示</span>
            </div>
            <ul className="space-y-1 text-xs">
              <li>• 绑定令牌有效期仅为 10 分钟，过期后需要重新生成</li>
              <li>• 每个令牌只能使用一次，绑定成功后立即失效</li>
              <li>• 请勿将绑定令牌分享给他人，以免 Agent 被恶意绑定</li>
              <li>• 绑定过程使用 HTTPS 加密传输，确保数据安全</li>
            </ul>
          </div>
          <p className="text-xs">
            如果您怀疑绑定令牌已泄露，可以立即解除绑定并重新生成新的令牌。
          </p>
        </div>
      ),
    },
    {
      id: 'troubleshooting',
      title: '常见问题',
      icon: <AlertCircle className="w-5 h-5 text-red-500" />,
      content: (
        <div className="space-y-3 text-sm text-gray-400">
          <div className="space-y-3">
            <div className="border-l-2 border-gray-700 pl-3">
              <div className="text-gray-300 font-medium mb-1">绑定命令执行失败？</div>
              <p className="text-xs">请检查：</p>
              <ul className="text-xs space-y-1 mt-1 ml-4 list-disc">
                <li>Openclaw 服务器是否可以访问 Genesis API</li>
                <li>绑定令牌是否正确复制，没有多余的空格</li>
                <li>令牌是否在有效期内（10 分钟）</li>
              </ul>
            </div>

            <div className="border-l-2 border-gray-700 pl-3">
              <div className="text-gray-300 font-medium mb-1">提示"Agent not found"？</div>
              <p className="text-xs">请确保您使用的是正确的绑定令牌，且该令牌是为当前 Agent 生成的。</p>
            </div>

            <div className="border-l-2 border-gray-700 pl-3">
              <div className="text-gray-300 font-medium mb-1">绑定后 Openclaw 状态显示"未连接"？</div>
              <p className="text-xs">请检查：</p>
              <ul className="text-xs space-y-1 mt-1 ml-4 list-disc">
                <li>Openclaw 服务是否正常运行</li>
                <li>网络防火墙是否允许 Genesis 后端访问 Openclaw</li>
                <li>Openclaw URL 配置是否正确</li>
              </ul>
            </div>

            <div className="border-l-2 border-gray-700 pl-3">
              <div className="text-gray-300 font-medium mb-1">如何解除绑定？</div>
              <p className="text-xs">在 Openclaw 服务器上执行：</p>
              <div className="mt-1 bg-black rounded p-2 font-mono text-xs text-gray-500">
                openclaw-bind --unbind
              </div>
              <p className="text-xs mt-1">或在 Genesis Web 界面的 Agent 详情页点击"解除绑定"。</p>
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="bg-[#0a0a0a] border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/30">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-300">绑定说明文档</span>
        </div>
        <button
          onClick={toggleAll}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          {isAllExpanded ? '全部折叠' : '全部展开'}
        </button>
      </div>

      {/* Sections */}
      <div className="divide-y divide-gray-800">
        {sections.map((section) => (
          <div key={section.id} className="">
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-900/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                {section.icon}
                <span className="text-sm text-gray-300">{section.title}</span>
              </div>
              {expandedSections.includes(section.id) ? (
                <ChevronUp className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              )}
            </button>
            
            {expandedSections.includes(section.id) && (
              <div className="px-4 pb-4 pt-1">
                {section.content}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
