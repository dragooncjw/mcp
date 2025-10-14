// api/mcp-proxy.ts
import { z } from 'zod';
import fetch from 'node-fetch';
import { Readable } from 'stream';

// ----------------------------
// 1. 工具注册
// ----------------------------
const toolMap = new Map<string, (params: any) => Promise<any>>();

// 普通加法工具
toolMap.set('add', async ({ a, b }: { a: number; b: number }) => ({
  content: [{ type: 'text', text: `${a + b}` }],
}));

// DeepWiki 工具（Node.js SSE 兼容）
toolMap.set('deepwiki', async ({ query }: { query: string }) => {
  const upstreamUrl = 'https://mcp.deepwiki.com/sse';
  const body = {
    method: 'ask_question',
    params: {
      repoName: 'bytedance/flowgram.ai',
      question: query,
    },
  };

  const resp = await fetch(upstreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.body) {
    return { content: [{ type: 'text', text: 'No response from DeepWiki' }] };
  }

  // Node.js 流式读取 SSE
  const reader = Readable.from(resp.body as any);
  let buffer = '';
  const finalContent: any[] = [];

  for await (const chunk of reader) {
    buffer += chunk.toString();

    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      if (!event.trim()) continue;
      if (event.startsWith('data:')) {
        try {
          const json = JSON.parse(event.replace(/^data:\s*/, ''));
          if (json.content) finalContent.push(...json.content);
        } catch {
          finalContent.push({ type: 'text', text: event });
        }
      }
    }
  }

  // 剩余 buffer 也加入 finalContent
  if (buffer.trim()) {
    finalContent.push({ type: 'text', text: buffer });
  }

  return { content: finalContent };
});

// ----------------------------
// 2. Dispatcher
// ----------------------------
async function dispatchMcpRequest(method: string, params: any) {
  if (toolMap.has(method)) return await toolMap.get(method)!(params);
  throw new Error(`Unknown MCP method: ${method}`);
}

async function* dispatchMcpStream(method: string, params: any) {
  const result = await dispatchMcpRequest(method, params);
  if (Array.isArray(result.content)) {
    for (const chunk of result.content) yield chunk;
  } else {
    yield result;
  }
}

// ----------------------------
// 3. Vercel Handler
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
    body = req.body ?? (await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: Buffer | string) => {
        data += chunk.toString();
      });
      req.on('end', () => resolve(JSON.parse(data)));
      req.on('error', reject);
    }));
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
  }

  const { method, params, stream } = body;

  // ----------------------------
  // 流式 SSE
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
  // 非流式 JSON
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
