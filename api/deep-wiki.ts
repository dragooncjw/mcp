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

// DeepWiki 工具（Vercel 兼容）
toolMap.set('deepwiki', async ({ query }: { query: string }) => {
  const upstreamUrl = 'https://mcp.deepwiki.com/sse';
  const body = {
    method: 'ask_question',
    params: {
      repoName: 'bytedance/flowgram.ai',
      question: query,
    },
  };

  try {
    const resp = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      return { 
        content: [{ 
          type: 'text', 
          text: `DeepWiki API error: ${resp.status} ${resp.statusText}` 
        }] 
      };
    }

    if (!resp.body) {
      return { content: [{ type: 'text', text: 'No response from DeepWiki' }] };
    }

    // Vercel 兼容的流式读取
    const reader = (resp.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const finalContent: any[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
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

      // 处理剩余 buffer
      if (buffer.trim()) {
        finalContent.push({ type: 'text', text: buffer });
      }
    } finally {
      reader.releaseLock();
    }

    return { content: finalContent };
  } catch (error: any) {
    return { 
      content: [{ 
        type: 'text', 
        text: `DeepWiki request failed: ${error.message}` 
      }] 
    };
  }
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

  // 解析 JSON body (Vercel 兼容)
  let body: any;
  try {
    if (req.body) {
      body = req.body;
    } else {
      // 手动解析 body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks).toString();
      body = JSON.parse(data);
    }
  } catch (error: any) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: `Invalid JSON body: ${error.message}` }));
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
