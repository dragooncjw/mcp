import { z } from 'zod';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// 1. initialize `MCPServer`
const server = new McpServer({
  name: 'Local Demo',
  version: '1.0.0',
});

// 2.2 resources
server.resource('filename', 'mcp://resource/filename', uri => ({
  contents: [{ uri: uri.href, text: 'content of filename' }],
}));

// 2.2 prompts
server.prompt('review-code', { code: z.string() }, ({ code }) => ({
  messages: [
    {
      role: 'user',
      content: {
        type: 'text',
        text: `Please review this code:\n\n${code}`,
      },
    },
  ],
}));

// 2.3 tools
server.tool(
  'add',
  'Calculate the sum of two numbers',
  { a: z.number(), b: z.number() },
  async ({ a, b }) =>
    await {
      content: [{ type: 'text', text: `${a + b}` }],
    },
);

server.tool(
  'flowgram',
  'Retrieve flowgram knowledge',
  { query: z.string().describe('query to flowgram') },
  async ({ query }) =>
    // 添加获取 flowgram.ai 的知识
    await {
      content: [{ type: 'text', text: 'http://flowgram.ai' }],
    },
);

// 3. run MCP Server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // console.info('Demo MCP Server running on stdio');
}

runServer().catch(error => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});
