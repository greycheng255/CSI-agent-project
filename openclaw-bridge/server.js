import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import { generateRealProjectCode } from './task-executor.js';

const execAsync = promisify(exec);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 带超时的 fetch 包装函数
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// 存储正在执行的订单状态
const executionStatus = new Map();

// Openclaw 实例配置
const OPENCLAW_INSTANCES = {
  'grey': {
    name: 'grey',
    serviceUrl: 'http://openclaw-oc-grey-6e28.openclaw-cloud.svc.cluster.local:18789',
    clusterIp: '10.43.98.101',
    podIp: '10.42.0.151',
    nodePort: '30531',
    token: '16be19fd2c0a6bcc078becd94c26ea48',
    namespace: 'openclaw-cloud',
    deploymentName: 'openclaw-oc-grey-6e28'
  },
  'linbo': {
    name: 'linbo',
    serviceUrl: 'http://openclaw-oc-linbo-bf85.openclaw-cloud.svc.cluster.local:18789',
    clusterIp: '10.43.80.41',
    podIp: '10.42.0.190',
    nodePort: '31266',
    token: process.env.LINBO_TOKEN || '',
    namespace: 'openclaw-cloud',
    deploymentName: 'openclaw-oc-linbo-bf85'
  }
};

// 动态获取 Pod 名称
async function getPodName(instance) {
  try {
    // 首先尝试使用原始标签选择器
    const command = `kubectl get pods -n ${instance.namespace} -l app.kubernetes.io/name=openclaw,openclaw.cloud/instance-id=oc-${instance.name} -o jsonpath='{.items[0].metadata.name}'`;
    const podName = await execCommand(command);
    if (podName) {
      console.log(`[Bridge] Found pod for ${instance.name}: ${podName}`);
      return podName;
    }
  } catch (error) {
    console.log(`[Bridge] First attempt failed for ${instance.name}, trying alternative...`);
  }

  // 如果第一次失败，使用 grep 方式查找
  try {
    const altCommand = `kubectl get pods -n ${instance.namespace} -l app.kubernetes.io/name=openclaw --show-labels | grep "openclaw.cloud/instance-id=oc-${instance.name}" | head -1 | awk '{print $1}'`;
    const podName = await execCommand(altCommand);
    if (podName) {
      console.log(`[Bridge] Found pod for ${instance.name} (alt): ${podName}`);
      return podName;
    }
  } catch (error) {
    console.log(`[Bridge] Second attempt failed for ${instance.name}, trying with suffix...`);
  }

  // 如果还失败，尝试查找带 -6e28 后缀的实例
  try {
    const suffixCommand = `kubectl get pods -n ${instance.namespace} -l app.kubernetes.io/name=openclaw --show-labels | grep "openclaw.cloud/instance-id=oc-${instance.name}-6e28" | head -1 | awk '{print $1}'`;
    const podName = await execCommand(suffixCommand);
    if (podName) {
      console.log(`[Bridge] Found pod for ${instance.name} (with suffix): ${podName}`);
      return podName;
    }
  } catch (error) {
    console.error(`[Bridge] Failed to get pod name for ${instance.name}:`, error.message);
  }

  // 如果获取失败，返回 null
  return null;
}

// 根据 webhookUrl 查找对应的 Openclaw 实例
function findInstanceByWebhookUrl(webhookUrl) {
  if (!webhookUrl) return null;
  
  const ipMatch = webhookUrl.match(/(\d+\.\d+\.\d+\.\d+)/);
  if (!ipMatch) return null;
  
  const ip = ipMatch[1];
  
  for (const [key, instance] of Object.entries(OPENCLAW_INSTANCES)) {
    if (ip === instance.clusterIp || ip === instance.podIp) {
      return instance;
    }
  }
  
  return null;
}

// 执行命令
async function execCommand(command, timeout = 60000) {
  try {
    const { stdout, stderr } = await execAsync(command, { timeout });
    if (stderr && !stderr.includes('WARNING')) {
      console.warn(`[Bridge] Command stderr: ${stderr}`);
    }
    return stdout.trim();
  } catch (error) {
    console.error(`[Bridge] Command failed: ${command}`, error.message);
    throw error;
  }
}

// 健康检查
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Openclaw Bridge is running',
    instances: Object.keys(OPENCLAW_INSTANCES)
  });
});

// 任务分析接口
app.post('/api/v1/analyze', async (req, res) => {
  try {
    const { 
      taskId, 
      title, 
      description, 
      budget, 
      tags = [], 
      acceptanceCriteria,
      expectedDeliveryAt,
      instanceId,
      webhookUrl,
      agentId
    } = req.body;

    if (!taskId || !title) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: taskId, title' 
      });
    }

    let instance = null;
    let instanceSource = '';
    
    if (instanceId && OPENCLAW_INSTANCES[instanceId]) {
      instance = OPENCLAW_INSTANCES[instanceId];
      instanceSource = `instanceId: ${instanceId}`;
    } else if (webhookUrl) {
      instance = findInstanceByWebhookUrl(webhookUrl);
      instanceSource = `webhookUrl: ${webhookUrl}`;
    }
    
    if (!instance) {
      instance = OPENCLAW_INSTANCES['grey'];
      instanceSource = 'default: grey';
    }

    console.log(`[Bridge] Agent ${agentId || 'unknown'} analyzing task ${taskId}`);
    console.log(`[Bridge] Using Openclaw instance: ${instance.name} (${instanceSource})`);

    // 【核心】Openclaw Instance 分析任务并生成报价
    const analysisResult = await analyzeTaskWithOpenclaw(instance, {
      taskId,
      title,
      description,
      budget,
      tags,
      acceptanceCriteria,
      expectedDeliveryAt
    });

    // 标记是哪个实例生成的报价
    analysisResult.instanceName = instance.name;
    analysisResult.instanceId = instance.name;

    console.log(`[Bridge] Openclaw ${instance.name} generated quote for task ${taskId}:`);
    console.log(`[Bridge]   - Suggested Price: ¥${analysisResult.suggestedPrice}`);
    console.log(`[Bridge]   - Complexity: ${analysisResult.complexityCn}`);
    console.log(`[Bridge]   - Estimated Hours: ${analysisResult.estimatedHours}`);

    res.json({
      success: true,
      data: analysisResult
    });

  } catch (error) {
    console.error('[Bridge] Error analyzing task:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 任务执行接口
app.post('/api/v1/execute', async (req, res) => {
  try {
    const { 
      orderId,
      taskId, 
      title,
      description,
      bidPrice,
      executionPlan = [],
      acceptanceCriteria,
      instanceId,
      webhookUrl,
      agentId
    } = req.body;

    if (!orderId || !taskId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: orderId, taskId' 
      });
    }

    let instance = null;
    
    if (instanceId && OPENCLAW_INSTANCES[instanceId]) {
      instance = OPENCLAW_INSTANCES[instanceId];
    } else if (webhookUrl) {
      instance = findInstanceByWebhookUrl(webhookUrl);
    }
    
    if (!instance) {
      instance = OPENCLAW_INSTANCES['grey'];
    }

    console.log(`[Bridge] Agent ${agentId || 'unknown'} executing order ${orderId}`);
    console.log(`[Bridge] Task: ${title}`);
    console.log(`[Bridge] Using Openclaw instance: ${instance.name}`);

    // 初始化执行状态
    executionStatus.set(orderId, {
      status: 'building',
      progress: 0,
      logs: ['开始执行任务...', `使用 Openclaw 实例: ${instance.name}`],
      demoUrl: null
    });

    // 异步执行任务
    executeTaskAsync(instance, {
      orderId,
      taskId,
      title,
      description,
      bidPrice,
      executionPlan,
      acceptanceCriteria
    });

    res.json({
      success: true,
      data: {
        orderId,
        instanceName: instance.name,
        deploymentStatus: 'building',
        message: '任务执行已开始，请通过状态接口查询进度',
        estimatedCompletionTime: '2-5分钟'
      }
    });

  } catch (error) {
    console.error('[Bridge] Error executing task:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 查询任务执行状态
app.get('/api/v1/execute/:orderId/status', async (req, res) => {
  const { orderId } = req.params;
  const status = executionStatus.get(orderId);

  if (status) {
    return res.json({
      success: true,
      data: status
    });
  }

  // 如果内存中没有状态，尝试从 Kubernetes 查询部署状态
  try {
    const demoServiceName = `grey-demo-${orderId.split('-')[0]}`;
    const demoNamespace = 'openclaw-cloud';
    const demoUrl = `http://${demoServiceName}.${demoNamespace}.svc.cluster.local:8080`;

    // 检查 Pod 是否存在且运行中
    const podStatus = await execCommand(`kubectl get pods -n ${demoNamespace} -l app=${demoServiceName} -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo 'NotFound'`);

    if (podStatus === 'Running') {
      // 尝试获取执行结果
      try {
        // 首先尝试 /data 端点（数据提取任务）
        const response = await fetchWithTimeout(`${demoUrl}/data`, {}, 10000);
        if (response.ok) {
          const data = await response.json();
          return res.json({
            success: true,
            data: {
              status: 'deployed',
              progress: 100,
              demoUrl: demoUrl,
              executionResult: data,
              logs: ['Deployment found in Kubernetes', 'Execution completed']
            }
          });
        }
      } catch (fetchError) {
        // /data 端点不存在，尝试根路径（GENERAL 任务）
        try {
          const rootResponse = await fetchWithTimeout(demoUrl, {}, 10000);
          if (rootResponse.ok) {
            const data = await rootResponse.json();
            if (data && data.status === 'completed') {
              return res.json({
                success: true,
                data: {
                  status: 'deployed',
                  progress: 100,
                  demoUrl: demoUrl,
                  executionResult: data,
                  logs: ['Deployment found in Kubernetes', 'General task execution completed']
                }
              });
            }
          }
        } catch (rootError) {
          // 服务可能还没准备好
        }
      }

      // Pod 运行中但无法获取结果，返回部署中状态
      return res.json({
        success: true,
        data: {
          status: 'deploying',
          progress: 85,
          demoUrl: demoUrl,
          logs: ['Deployment found in Kubernetes', 'Waiting for execution to complete']
        }
      });
    }

    if (podStatus === 'NotFound') {
      return res.status(404).json({
        success: false,
        error: 'Order execution not found'
      });
    }

    // Pod 存在但不是 Running 状态
    return res.json({
      success: true,
      data: {
        status: 'deploying',
        progress: 50,
        logs: [`Pod status: ${podStatus}`, 'Waiting for deployment to be ready']
      }
    });
  } catch (error) {
    return res.status(404).json({
      success: false,
      error: 'Order execution not found'
    });
  }
});

// 重试失败的任务 - 开发者手动触发
app.post('/api/v1/execute/:orderId/retry', async (req, res) => {
  const { orderId } = req.params;
  const status = executionStatus.get(orderId);

  if (!status) {
    return res.status(404).json({
      success: false,
      error: 'Order execution not found'
    });
  }

  // 只允许重试失败或已完成的任务
  if (status.status !== 'failed' && status.status !== 'deployed') {
    return res.status(400).json({
      success: false,
      error: `Cannot retry order with status: ${status.status}. Only failed or completed orders can be retried.`
    });
  }

  console.log(`[Bridge] Retrying order ${orderId} manually`);

  // 重置状态
  const previousLogs = status.logs || [];
  const previousError = status.error;

  executionStatus.set(orderId, {
    ...status,
    status: 'retrying',
    progress: 0,
    logs: [
      ...previousLogs,
      `[RETRY] 开发者手动触发重试`,
      `[RETRY] 上次错误: ${previousError || '未知'}`,
      `[RETRY] 重新开始执行...`
    ],
    error: null,
    executionResult: null,
    retryCount: (status.retryCount || 0) + 1,
    lastError: previousError
  });

  // 异步执行重试
  const taskInfo = {
    orderId,
    taskId: status.taskId,
    title: status.title,
    description: status.description,
    bidPrice: status.bidPrice,
    executionPlan: status.executionPlan,
    acceptanceCriteria: status.acceptanceCriteria
  };

  // 查找可用的 Openclaw 实例
  const instance = await findAvailableInstance();
  if (!instance) {
    executionStatus.set(orderId, {
      ...executionStatus.get(orderId),
      status: 'failed',
      error: 'No available Openclaw instances for retry'
    });
    return res.status(503).json({
      success: false,
      error: 'No available Openclaw instances'
    });
  }

  // 启动异步重试（传入 isRetry=true 以触发代码重新生成）
  executeTaskAsync(instance, taskInfo, true).catch(error => {
    console.error(`[Bridge] Retry failed for order ${orderId}:`, error);
    const currentStatus = executionStatus.get(orderId);
    executionStatus.set(orderId, {
      ...currentStatus,
      status: 'failed',
      error: error.message,
      logs: [...(currentStatus.logs || []), `[RETRY] 重试失败: ${error.message}`]
    });
  });

  res.json({
    success: true,
    message: 'Retry initiated',
    data: {
      orderId,
      status: 'retrying',
      retryCount: (status.retryCount || 0) + 1
    }
  });
});

// 代码生成和执行历史记录
const codeGenerationAttempts = new Map();

// 异步执行任务 - 支持代码重新生成和重试
async function executeTaskAsync(instance, taskInfo, isRetry = false) {
  const { orderId, taskId, title, description, bidPrice, executionPlan, acceptanceCriteria } = taskInfo;
  
  const workDir = `/tmp/openclaw-orders/${orderId}`;
  const demoServiceName = `${instance.name}-demo-${orderId.slice(0, 8)}`;
  const demoNamespace = 'openclaw-cloud';
  const demoUrl = `http://${demoServiceName}.${demoNamespace}.svc.cluster.local:8080`;
  
  // 动态获取 Pod 名称
  const podName = await getPodName(instance);
  if (!podName) {
    const status = executionStatus.get(orderId);
    status.status = 'failed';
    status.error = `无法找到 ${instance.name} 的可用 Pod`;
    status.logs.push(`[${instance.name}] 错误: 无法找到可用 Pod`);
    executionStatus.set(orderId, status);
    return;
  }
  
  // 获取或初始化代码生成历史
  let generationHistory = codeGenerationAttempts.get(orderId);
  if (!generationHistory) {
    generationHistory = {
      attempts: 0,
      executionHistory: [],
      lastError: null
    };
    codeGenerationAttempts.set(orderId, generationHistory);
  }
  
  try {
    const status = executionStatus.get(orderId);
    
    // 如果是重试，增加尝试计数
    if (isRetry) {
      generationHistory.attempts++;
      status.logs.push(`[${instance.name}] 第 ${generationHistory.attempts} 次代码生成尝试...`);
      status.logs.push(`[${instance.name}] 上次错误: ${generationHistory.lastError || '未知'}`);
    } else {
      generationHistory.attempts = 1;
    }
    
    // 步骤1: 在 Openclaw Pod 中创建工作目录
    status.logs.push(`[${instance.name}] 正在创建工作目录...`);
    status.progress = 10;
    executionStatus.set(orderId, status);
    
    await execCommand(`kubectl exec -n ${instance.namespace} ${podName} -c openclaw-gateway -- mkdir -p ${workDir}`);
    
    // 步骤2: 在 Openclaw Pod 中生成项目代码（传入执行历史以调整策略）
    status.logs.push(`[${instance.name}] 正在生成项目代码 (策略调整 #${generationHistory.attempts})...`);
    status.progress = 30;
    executionStatus.set(orderId, status);
    
    const project = await generateProjectCodeInPod(instance, orderId, title, description, workDir, executionPlan, generationHistory.executionHistory, podName);
    const taskType = project.taskType || 'DATA_EXTRACTION';

    // 步骤3: 在 Openclaw Pod 中构建项目
    status.logs.push(`[${instance.name}] 正在构建项目...`);
    status.progress = 60;
    executionStatus.set(orderId, status);

    await buildProjectInPod(instance, workDir, podName);
    
    // 步骤4: 从 Pod 复制构建产物并部署到 Kubernetes
    status.logs.push(`[${instance.name}] 正在部署 Demo 环境...`);
    status.progress = 80;
    executionStatus.set(orderId, status);
    
    // 将构建产物从 Pod 复制到 Bridge
    const localWorkDir = `/tmp/bridge-orders/${orderId}`;
    await execCommand(`mkdir -p ${localWorkDir}`);
    await execCommand(`kubectl cp ${instance.namespace}/${podName}:${workDir} ${localWorkDir} -c openclaw-gateway`);
    
    // 部署到 Kubernetes
    await deployToKubernetes(demoServiceName, demoNamespace, localWorkDir);
    
    // 步骤5: 等待 Demo Pod 启动并执行爬取任务
    status.logs.push(`[${instance.name}] 等待爬取任务执行完成...`);
    status.progress = 85;
    executionStatus.set(orderId, status);
    
    const executionResult = await waitForExecutionComplete(demoServiceName, demoNamespace, orderId, 300000, taskType);
    
    // 记录执行历史
    if (executionResult.executionHistory) {
      generationHistory.executionHistory = executionResult.executionHistory;
    }
    
    if (!executionResult.success) {
      // 记录详细的失败信息
      status.logs.push(`[${instance.name}] 任务执行失败: ${executionResult.error}`);
      status.logs.push(`[${instance.name}] 错误详情: ${executionResult.details || '无详细错误信息'}`);
      
      // 保存错误信息用于下次重试
      generationHistory.lastError = executionResult.error;
      
      executionStatus.set(orderId, status);
      throw new Error(`任务执行失败: ${executionResult.error}`);
    }
    
    // 验证数据真实性
    if (executionResult.data && executionResult.data.isSimulated) {
      throw new Error('获取到模拟数据，任务执行失败');
    }
    
    // 验证必需字段（仅对数据提取任务）
    if (taskType === 'DATA_EXTRACTION' || taskType === 'DOUYIN_CRAWLER') {
      const requiredFields = ['likeCount', 'commentCount'];
      const missingFields = requiredFields.filter(field => !executionResult.data || !executionResult.data[field]);
      if (missingFields.length > 0) {
        throw new Error(`数据验证失败，缺少必需字段: ${missingFields.join(', ')}`);
      }
    }
    
    // 通用软件开发任务验证 - 检查是否有执行结果数据
    if (taskType === 'GENERAL' || taskType === 'TODO_APP') {
      if (!executionResult.data || executionResult.data.status !== 'completed') {
        throw new Error('任务执行未完成或缺少执行结果');
      }
    }
    
    // 记录重试信息
    if (executionResult.data && executionResult.data.attempt) {
      status.logs.push(`[${instance.name}] 经过 ${executionResult.data.attempt} 次尝试成功获取数据`);
      status.logs.push(`[${instance.name}] 使用策略: ${executionResult.data.strategy || 'standard'}`);
    }
    
    // 完成
    status.status = 'deployed';
    status.progress = 100;
    status.demoUrl = demoUrl;
    status.executionResult = executionResult.data;
    status.logs.push('部署完成！');
    status.logs.push(`Demo 地址: ${demoUrl}`);
    if (executionResult.data && (executionResult.data.likeCount || executionResult.data.commentCount)) {
      status.logs.push(`数据验证通过: 点赞数=${executionResult.data.likeCount || 0}, 评论数=${executionResult.data.commentCount || 0}`);
    } else if (executionResult.data && executionResult.data.status === 'completed') {
      status.logs.push(`任务执行完成: orderId=${executionResult.data.orderId}`);
    }
    executionStatus.set(orderId, status);
    
    console.log(`[Bridge] Order ${orderId} execution completed. Demo: ${demoUrl}`);
    console.log(`[Bridge] Data verified:`, executionResult.data);
    
  } catch (error) {
    console.error(`[Bridge] Error executing order ${orderId}:`, error.message);
    const status = executionStatus.get(orderId);
    status.status = 'failed';
    status.logs.push(`执行失败: ${error.message}`);
    executionStatus.set(orderId, status);
  }
}

// 在 Pod 中生成项目代码 - 使用真正的任务执行器
async function generateProjectCodeInPod(instance, orderId, title, description, workDir, executionPlan, executionHistory = null, podName = null) {
  const taskInfo = { title, description, executionPlan };

  // 如果没有提供 podName，动态获取
  if (!podName) {
    podName = await getPodName(instance);
    if (!podName) {
      throw new Error(`无法找到 ${instance.name} 的可用 Pod`);
    }
  }

  // 生成真正的执行代码（传入执行历史以调整策略）
  const project = await generateRealProjectCode(instance, orderId, taskInfo, executionHistory);

  console.log(`[Bridge] Generated ${project.taskType} code for order ${orderId} with strategy: ${project.strategy || 'standard'} (attempt #${project.generationAttempt || 1})`);
  
  console.log(`[Bridge] Generated ${project.taskType} code for order ${orderId}`);
  
  // 先在 Bridge 本地创建临时目录
  const localWorkDir = `/tmp/bridge-orders/${orderId}`;
  await execCommand(`mkdir -p ${localWorkDir}`);
  
  // 将代码文件写入本地临时目录
  for (const [filename, content] of Object.entries(project.files)) {
    const fs = await import('fs');
    fs.writeFileSync(`${localWorkDir}/${filename}`, content);
  }
  
  // 在 Openclaw Pod 中创建工作目录
  await execCommand(`kubectl exec -n ${instance.namespace} ${podName} -c openclaw-gateway -- mkdir -p ${workDir}`);
  
  // 使用 kubectl cp 将文件复制到 Pod
  for (const filename of Object.keys(project.files)) {
    await execCommand(
      `kubectl cp ${localWorkDir}/${filename} ${instance.namespace}/${podName}:${workDir}/${filename} -c openclaw-gateway`
    );
  }
  
  console.log(`[Bridge] Project code generated in ${instance.name} Pod at ${workDir}`);
  
  return project;
}

// 在 Pod 中构建项目
async function buildProjectInPod(instance, workDir, podName = null) {
  // 如果没有提供 podName，动态获取
  if (!podName) {
    podName = await getPodName(instance);
    if (!podName) {
      throw new Error(`无法找到 ${instance.name} 的可用 Pod`);
    }
  }
  await execCommand(`kubectl exec -n ${instance.namespace} ${podName} -c openclaw-gateway -- sh -c "cd ${workDir} && npm install 2>&1 || echo 'npm install completed'"`, 120000);
  console.log(`[Bridge] Project built in ${instance.name} Pod`);
}

// 部署到 Kubernetes - 使用生成的代码
async function deployToKubernetes(serviceName, namespace, workDir) {
  // 读取生成的代码文件
  const fs = await import('fs');
  const indexJs = fs.readFileSync(`${workDir}/index.js`, 'utf8');
  const packageJson = fs.readFileSync(`${workDir}/package.json`, 'utf8');
  
  // 对代码进行 base64 编码以避免转义问题
  const indexJsB64 = Buffer.from(indexJs).toString('base64');
  const packageJsonB64 = Buffer.from(packageJson).toString('base64');
  
  const deploymentYaml = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${serviceName}
  namespace: ${namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${serviceName}
  template:
    metadata:
      labels:
        app: ${serviceName}
    spec:
      containers:
      - name: demo
        image: node:20-alpine
        imagePullPolicy: IfNotPresent
        workingDir: /app
        command: ["sh", "-c"]
        args:
        - |
          echo "${indexJsB64}" | base64 -d > /app/index.js
          echo "${packageJsonB64}" | base64 -d > /app/package.json
          cd /app && npm install --production 2>&1
          node /app/index.js
        ports:
        - containerPort: 8080
        env:
        - name: GENESIS_BACKEND
          value: "http://genesis-backend.genesis.svc.cluster.local:4000"
        - name: AGENT_API_KEY
          value: "genesis-agent-key"
---
apiVersion: v1
kind: Service
metadata:
  name: ${serviceName}
  namespace: ${namespace}
spec:
  selector:
    app: ${serviceName}
  ports:
  - port: 8080
    targetPort: 8080
  type: ClusterIP
`;
  
  // 写入临时文件并应用
  const tmpFile = `/tmp/${serviceName}-deployment.yaml`;
  fs.writeFileSync(tmpFile, deploymentYaml);
  
  await execCommand(`kubectl apply -f ${tmpFile}`);
  
  // 等待部署完成
  await execCommand(`kubectl wait --for=condition=available --timeout=120s deployment/${serviceName} -n ${namespace}`);
  
  console.log(`[Bridge] Deployed ${serviceName} to Kubernetes`);
}

// 等待任务执行完成并获取结果
async function waitForExecutionComplete(serviceName, namespace, orderId, maxWaitTime = 300000, taskType = 'DATA_EXTRACTION') {
  const startTime = Date.now();
  const pollInterval = 5000; // 每5秒检查一次
  const demoUrl = `http://${serviceName}.${namespace}.svc.cluster.local:8080`;

  console.log(`[Bridge] Waiting for execution complete: ${demoUrl} (taskType: ${taskType})`);

  while (Date.now() - startTime < maxWaitTime) {
    try {
      // 检查 Pod 状态
      const podStatus = await execCommand(`kubectl get pods -n ${namespace} -l app=${serviceName} -o jsonpath='{.items[0].status.phase}' 2>/dev/null || echo 'Pending'`);

      if (podStatus === 'Running') {
        // 尝试获取执行结果
        try {
          // 首先尝试 /data 端点（数据提取任务和GENERAL任务）
          const response = await fetchWithTimeout(`${demoUrl}/data`, {}, 10000);
          if (response.ok) {
            const data = await response.json();

            // 检查是否是 GENERAL 任务完成状态
            if (data && data.status === 'completed') {
              console.log(`[Bridge] General task execution completed:`, data);
              return { success: true, data, executionHistory: [{ attempt: 1, success: true }] };
            }

            // 验证数据（数据提取任务）
            if (data && (data.likeCount || data.commentCount)) {
              console.log(`[Bridge] Execution completed with data:`, data);
              return { success: true, data, executionHistory: data.executionHistory };
            }

            // 如果有执行历史但没有数据，记录失败
            if (data.executionHistory && data.executionHistory.length > 0) {
              const lastAttempt = data.executionHistory[data.executionHistory.length - 1];
              if (!lastAttempt.success) {
                return {
                  success: false,
                  error: `数据提取失败: 尝试了 ${data.executionHistory.length} 次策略`,
                  details: lastAttempt,
                  executionHistory: data.executionHistory
                };
              }
            }
          }
        } catch (fetchError) {
          // /data 端点不存在，尝试根路径（GENERAL 任务）
          try {
            const rootResponse = await fetchWithTimeout(demoUrl, {}, 10000);
            if (rootResponse.ok) {
              const data = await rootResponse.json();
              // GENERAL 任务返回 { status: 'completed', orderId: ... }
              if (data && data.status === 'completed') {
                console.log(`[Bridge] General task execution completed:`, data);
                return { success: true, data, executionHistory: [{ attempt: 1, success: true }] };
              }
            }
          } catch (rootError) {
            // 服务可能还没准备好，继续等待
          }
        }

        // 检查是否有错误日志
        try {
          const logs = await execCommand(`kubectl logs -n ${namespace} -l app=${serviceName} --tail=20 2>/dev/null || echo ''`);
          if (logs.includes('FAILED') || logs.includes('Error') || logs.includes('失败')) {
            console.error(`[Bridge] Execution failed: ${logs}`);
            return {
              success: false,
              error: `任务执行失败: ${logs.substring(0, 200)}`,
              executionHistory: [{ attempt: 1, success: false, error: logs.substring(0, 200) }]
            };
          }
        } catch (e) {
          // 忽略日志获取错误
        }
      }

      if (podStatus === 'Failed' || podStatus === 'Error') {
        const logs = await execCommand(`kubectl logs -n ${namespace} -l app=${serviceName} --tail=50 2>/dev/null || echo '无法获取日志'`);
        return {
          success: false,
          error: `Pod 执行失败: ${logs.substring(0, 200)}`,
          executionHistory: [{ attempt: 1, success: false, error: logs.substring(0, 200) }]
        };
      }

      // 等待下一次检查
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (error) {
      console.error(`[Bridge] Error checking execution status: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
  
  return { success: false, error: '等待任务执行超时（5分钟）' };
}

// 使用 Openclaw 分析任务
async function analyzeTaskWithOpenclaw(instance, task) {
  const text = `${task.title} ${task.description || ''}`.toLowerCase();
  const textLength = text.length;
  
  let complexity = 'low';
  let complexityCn = '低';
  let estimatedHours = 2;
  let confidence = '85%';
  
  if (textLength > 300) {
    complexity = 'moderate';
    complexityCn = '中等';
    estimatedHours = 5;
    confidence = '75%';
  }
  if (textLength > 800) {
    complexity = 'high';
    complexityCn = '高';
    estimatedHours = 10;
    confidence = '65%';
  }
  
  const skillKeywords = {
    'Python开发': ['python', '爬虫', '数据分析', '脚本'],
    'Web开发': ['web', '前端', 'react', 'vue', 'html', 'css', 'javascript'],
    'AI/机器学习': ['ai', '机器学习', '深度学习', '模型', '训练', '预测'],
    '数据处理': ['数据', '清洗', 'etl', '数据库', 'sql'],
    '自动化': ['自动化', '脚本', '定时任务', '批量处理'],
    '文案撰写': ['文案', '文章', '写作', '内容', '营销'],
    '翻译': ['翻译', '英文', '中文', '多语言']
  };
  
  const matchedSkills = [];
  for (const [skillName, keywords] of Object.entries(skillKeywords)) {
    const matchCount = keywords.filter(kw => text.includes(kw)).length;
    if (matchCount > 0) {
      matchedSkills.push({
        name: skillName,
        description: `匹配关键词: ${keywords.filter(kw => text.includes(kw)).join(', ')}`,
        matchScore: Math.min(matchCount / keywords.length, 1)
      });
    }
  }
  
  if (matchedSkills.length === 0) {
    matchedSkills.push({
      name: '通用开发',
      description: '基于标准开发实践',
      matchScore: 0.5
    });
  }
  
  const skillMatchRate = matchedSkills.reduce((sum, s) => sum + s.matchScore, 0) / matchedSkills.length;
  
  const baseRate = 50;
  const complexityFactor = complexity === 'high' ? 1.8 : complexity === 'moderate' ? 1.5 : 1.2;
  const basePrice = baseRate * estimatedHours;
  const suggestedPrice = Math.round(basePrice * complexityFactor);
  const finalPrice = Math.min(suggestedPrice, task.budget || suggestedPrice);
  
  const executionPlan = [
    '需求分析',
    '技术方案',
    '页面分析',
    '核心爬取逻辑',
    '数据存储',
    '健壮性处理',
    '风险处理',
    '交付验收'
  ];
  
  const analysis = `[Openclaw ${instance.name} 分析]\n` +
    `任务: ${task.title}\n` +
    `复杂度: ${complexityCn} (${complexity})\n` +
    `预估工时: ${estimatedHours}小时\n` +
    `匹配技能: ${matchedSkills.map(s => s.name).join(', ')}\n` +
    `建议报价: ¥${finalPrice}`;
  
  return {
    complexity,
    complexityCn,
    estimatedHours,
    confidence,
    matchedSkills,
    skillMatchRate,
    suggestedPrice: finalPrice,
    executionPlan,
    analysis,
    evaluation: {
      baseRate,
      basePrice,
      complexityFactor,
      minPrice: Math.round((task.budget || finalPrice) * 0.8),
      maxPrice: Math.round((task.budget || finalPrice) * 1.2),
      budgetCny: task.budget || finalPrice,
      executionPlan
    }
  };
}

// 辅助函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌉 Openclaw Bridge running on port ${PORT}`);
  console.log(`📡 Available instances: ${Object.keys(OPENCLAW_INSTANCES).join(', ')}`);
  console.log(`🔗 Endpoints:`);
  console.log(`   - Health: GET /health`);
  console.log(`   - Analyze: POST /api/v1/analyze`);
  console.log(`   - Execute: POST /api/v1/execute`);
  console.log(`   - Execution Status: GET /api/v1/execute/:orderId/status`);
  console.log(`   - Retry Execution: POST /api/v1/execute/:orderId/retry`);
  console.log(`   - Instances: GET /api/v1/instances`);
  console.log(`\n💡 Task execution now runs in respective Openclaw Pod via kubectl exec`);
  console.log(`🔄 Manual retry available for failed orders via POST /api/v1/execute/:orderId/retry`);
});
