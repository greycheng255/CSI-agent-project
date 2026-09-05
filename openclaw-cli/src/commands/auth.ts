import * as http from 'http';
import { exec } from 'child_process';
import { randomBytes, createHash } from 'crypto';
import chalk from 'chalk';
import axios from 'axios';
import { getConfig, saveConfig } from '../utils/config';

const CLIENT_ID = 'openclaw-cli';
const CALLBACK_PATH = '/callback';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** 生成 PKCE code_verifier / code_challenge（S256） */
function createPkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** 尽力打开系统默认浏览器，失败则提示用户手动打开 */
function openBrowser(url: string) {
  const platform = process.platform;
  const command =
    platform === 'darwin'
      ? `open "${url}"`
      : platform === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;

  exec(command, (error) => {
    if (error) {
      console.log(chalk.yellow('无法自动打开浏览器，请手动复制以下链接到浏览器完成登录：'));
      console.log(chalk.cyan.underline(url));
    }
  });
}

/** 等待本地回调携带授权码 */
function waitForCode(port: number, state: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>登录失败，请回到终端查看错误信息。</h3>');
        server.close();
        reject(new Error(`授权失败: ${error}`));
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');
      if (!code || returnedState !== state) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h3>回调参数无效，请重试登录。</h3>');
        server.close();
        reject(new Error('回调缺少 code 或 state 不匹配'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h3>登录成功，请回到终端继续。</h3>');
      server.close();
      resolve(code);
    });

    server.listen(port, '127.0.0.1', () => {
      const timer = setTimeout(() => {
        server.close();
        reject(new Error('登录超时（5 分钟未完成），请重试'));
      }, LOGIN_TIMEOUT_MS);
      server.on('close', () => clearTimeout(timer));
    });

    server.on('error', (err) => reject(err));
  });
}

export class AuthCommands {
  /**
   * openclaw login — 通过 Marketplace SSO 浏览器登录（PKCE + 本地回调）
   */
  static async login(): Promise<void> {
    const config = getConfig();
    const baseUrl = (process.env.GENESIS_API || config.genesisApi || 'http://localhost:4000').replace(/\/$/, '');

    const { verifier, challenge } = createPkce();
    const state = randomBytes(16).toString('hex');

    // 选择一个可用回环端口
    const { port } = await new Promise<{ port: number }>((resolve, reject) => {
      const probe = http.createServer();
      probe.listen(0, '127.0.0.1', () => {
        const addr = probe.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        probe.close(() => resolve({ port }));
      });
      probe.on('error', reject);
    });

    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const authorizeUrl =
      `${baseUrl}/api/v1/sso/authorize` +
      `?client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&code_challenge_method=S256`;

    console.log(chalk.bold('通过 Marketplace 账号登录 Openclaw CLI\n'));
    console.log(`  正在等待浏览器完成授权...（监听 ${redirectUri}）\n`);
    openBrowser(authorizeUrl);
    console.log(chalk.dim(`  如未自动打开：\n  ${authorizeUrl}\n`));

    let code: string;
    try {
      code = await waitForCode(port, state);
    } catch (err) {
      console.error(chalk.red(`登录失败: ${err instanceof Error ? err.message : err}`));
      process.exitCode = 1;
      return;
    }

    // 授权码换 access_token
    try {
      const response = await axios.post(`${baseUrl}/api/v1/sso/token`, {
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      });

      const { access_token: token, user } = response.data;
      saveConfig({
        genesisApi: baseUrl,
        ownerToken: token,
      });
      process.env.OWNER_TOKEN = token;

      console.log(chalk.green('登录成功！'));
      console.log(`  用户：${user.displayName || user.id}${user.phone ? ` (${user.phone})` : ''}`);
      console.log(chalk.dim(`  凭证已保存到 ~/.openclaw/config.json`));
    } catch (err: unknown) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.message || err.message
        : err instanceof Error
          ? err.message
          : String(err);
      console.error(chalk.red(`令牌交换失败: ${message}`));
      process.exitCode = 1;
    }
  }

  /** openclaw logout — 先撤销服务端 openclaw-cli 令牌，再清除本地凭证 */
  static async logout(): Promise<void> {
    const config = getConfig();
    const baseUrl = (process.env.GENESIS_API || config.genesisApi || 'http://localhost:4000').replace(/\/$/, '');
    const token = process.env.OWNER_TOKEN || config.ownerToken;

    if (token) {
      try {
        // 定向登出：仅撤销 openclaw-cli 签发的令牌，不影响用户其他会话与 PAT
        await axios.post(
          `${baseUrl}/api/v1/sso/logout`,
          { client_id: CLIENT_ID },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 },
        );
        console.log(chalk.green('已撤销本 CLI 的服务端令牌。'));
      } catch {
        console.log(chalk.yellow('服务端令牌撤销失败（可能已失效），已跳过。'));
      }
    }

    saveConfig({ ownerToken: '' });
    delete process.env.OWNER_TOKEN;
    console.log(chalk.green('已清除本地凭证。'));
  }
}
