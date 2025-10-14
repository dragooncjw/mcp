import { z } from 'zod';
import fetch from 'node-fetch';

// ----------------------------
// 1. 注册工具 / Prompt / Resource
// ----------------------------
const toolMap = new Map<string, (params: any) => Promise<any>>();
const promptMap = new Map<string, (params: any) => Promise<any>>();
const resourceMap = new Map<string, (params: any) => Promise<any>>();

// 工具示例
toolMap.set('add', async ({ a, b }: { a: number; b: number }) => ({
  content: [{ type: 'text', text: `${a + b}` }],
}));

toolMap.set('flowgram', async ({ query }: { query: string }) => ({
  content: [{ type: 'text', text: `Flowgram link: http://flowgram.ai?q=${encodeURIComponent(query)}` }],
}));

// DeepWiki MCP 工具
toolMap.set('deepwiki', async ({ query }: { query: string }) => {
  const upstreamUrl = 'https://mcp.deepwiki.com/sse';
  const body = { method: 'query', params: { query } }; // method 名根据 DeepWiki MCP 定义

  const resp = await fetch(upstreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // 非流式请求，直接解析 JSON
  const json = await resp.json();
  console.log('debugger json', JSON.stringify(json))
  return {
    content: (json as any).result?.content ?? [{ type: 'text', text: JSON.stringify(json) }],
  };
});

// Prompt 示例
promptMap.set('review-code', async ({ code }: { code: string }) => ({
  messages: [
    {
      role: 'user',
      content: { type: 'text', text: `Please review this code:\n\n${code}` },
    },
  ],
}));

// Resource 示例
resourceMap.set('filename', async ({ uri }: { uri: string }) => ({
  contents: [{ uri, text: 'content of filename' }],
}));

// ----------------------------
// 2. Dispatcher
// ----------------------------
async function dispatchMcpRequest(method: string, params: any) {
  if (toolMap.has(method)) return await toolMap.get(method)!(params);
  if (promptMap.has(method)) return await promptMap.get(method)!(params);
  if (resourceMap.has(method)) return await resourceMap.get(method)!(params);

  throw new Error(`Unknown MCP method: ${method}`);
}

async function* dispatchMcpStream(method: string, params: any) {
  // DeepWiki MCP SSE 流式处理
  if (method === 'deepwiki') {
    const upstreamUrl = 'https://mcp.deepwiki.com/sse';
    const body = { method: 'query', params: { query: params.query }, stream: true };

    const resp = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.body) throw new Error('No stream from DeepWiki MCP');

    for await (const chunk of resp.body) {
      // chunk 是 Buffer
      yield { type: 'text', text: chunk.toString() };
    }
    return;
  }

  // 其他工具仍然使用本地 Map
  const result = await dispatchMcpRequest(method, params);
  if (Array.isArray(result.content)) {
    for (const chunk of result.content) yield chunk;
  } else {
    yield result;
  }
}

// ----------------------------
// 3. Vercel Serverless Handler
// ----------------------------
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('Method Not Allowed');
  }

  // 解析 JSON body
  let body: any;
  try {
    body =
      req.body ??
      (await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk: any) => (data += chunk));
        req.on('end', () => resolve(JSON.parse(data)));
        req.on('error', reject);
      }));
  } catch (err) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
  }

  const { method, params, stream } = body;

  // ----------------------------
  // 流式 SSE 响应
  // ----------------------------
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const chunk of dispatchMcpStream(method, params)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write(`event: end\n\n`);
      res.end();
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  // ----------------------------
  // 非流式请求
  // ----------------------------
  try {
    const result = await dispatchMcpRequest(method, params);
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ result }));
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: err.message }));
  }
}
