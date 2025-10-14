import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ----------------------------
// 1. 创建 MCP Server
// ----------------------------
const server = new McpServer({
  name: 'Flowgram MCP Server (HTTP Stream)',
  version: '1.0.0',
});

// ----------------------------
// 2. 内部 Map 管理注册的工具 / prompt / resource
// ----------------------------
export const toolMap = new Map<string, any>();
export const promptMap = new Map<string, any>();
export const resourceMap = new Map<string, any>();

// ----------------------------
// 3. 注册工具
// ----------------------------
toolMap.set(
  'add',
  server.tool(
    'add',
    'Calculate the sum of two numbers',
    { a: z.number(), b: z.number() },
    async ({ a, b }) => ({
      content: [{ type: 'text', text: `${a + b}` }],
    })
  )
);

toolMap.set(
  'flowgram',
  server.tool(
    'flowgram',
    'Retrieve flowgram knowledge',
    { query: z.string() },
    async ({ query }) => ({
      content: [{ type: 'text', text: `Flowgram link: http://flowgram.ai?q=${encodeURIComponent(query)}` }],
    })
  )
);

// ----------------------------
// 4. 注册 prompt
// ----------------------------
promptMap.set(
  'review-code',
  server.prompt('review-code', { code: z.string() }, ({ code }) => ({
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: `Please review this code:\n\n${code}` },
      },
    ],
  }))
);

// ----------------------------
// 5. 注册资源
// ----------------------------
resourceMap.set(
  'filename',
  server.resource('filename', 'mcp://resource/filename', uri => ({
    contents: [{ uri: uri.href, text: 'content of filename' }],
  }))
);

// ----------------------------
// 6. Dispatcher
// ----------------------------
export async function dispatchMcpRequest(method: string, params: any) {
  if (toolMap.has(method)) return await toolMap.get(method).execute(params);
  if (promptMap.has(method)) return await promptMap.get(method).execute(params);
  if (resourceMap.has(method)) return await resourceMap.get(method).execute(params);

  throw new Error(`Unknown MCP method: ${method}`);
}

export async function* dispatchMcpStream(method: string, params: any) {
  const result = await dispatchMcpRequest(method, params);
  if (Array.isArray(result.content)) {
    for (const chunk of result.content) yield chunk;
  } else {
    yield result;
  }
}

// ----------------------------
// 7. Node.js HTTP Handler (Vercel Serverless)
// ----------------------------
export default async function handler(req: any, res: any) {
  // 只接受 POST 请求
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('Method Not Allowed');
  }

  // 确保请求 body 被解析
  let body: any;
  try {
    body = req.body ?? (await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk: any) => (data += chunk));
      req.on('end', () => resolve(JSON.parse(data)));
      req.on('error', reject);
    }));
  } catch (err) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
  }

  const { method, params, stream } = body;

  if (!stream) {
    try {
      const result = await dispatchMcpRequest(method, params);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ result }));
    } catch (err: any) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // ----------------------------
  // 流式响应 (SSE)
  // ----------------------------
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const chunk of dispatchMcpStream(method, params)) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.write('event: end\n\n');
    res.end();
  } catch (err: any) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    res.end();
  }
}
