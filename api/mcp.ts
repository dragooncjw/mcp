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
const toolMap = new Map<string, any>();
const promptMap = new Map<string, any>();
const resourceMap = new Map<string, any>();

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
// 6. Edge Runtime 配置
// ----------------------------
export const config = { runtime: 'edge' };

// ----------------------------
// 7. Dispatcher
// ----------------------------
async function dispatchMcpRequest(method: string, params: any) {
  if (toolMap.has(method)) return await toolMap.get(method).execute(params);
  if (promptMap.has(method)) return await promptMap.get(method).execute(params);
  if (resourceMap.has(method)) return await resourceMap.get(method).execute(params);

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
// 8. HTTP Handler
// ----------------------------
export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const { method, params, stream } = await req.json();
  const encoder = new TextEncoder();

  if (!stream) {
    const result = await dispatchMcpRequest(method, params);
    return new Response(JSON.stringify({ result }), { headers: { 'Content-Type': 'application/json' } });
  }

  // 流式响应
  const streamBody = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of dispatchMcpStream(method, params)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.enqueue(encoder.encode('event: end\n\n'));
        controller.close();
      } catch (err: any) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(streamBody, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
