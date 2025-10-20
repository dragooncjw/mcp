// 文件路径: /api/mcp-stream/route.ts
export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  // 目标地址
  const targetUrl = "https://mcp.deepwiki.com/sse";

  // 将原始请求体转发
  const newReq = new Request(targetUrl, {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });

  // 转发请求
  const response = await fetch(newReq);

  // 确保是 SSE 流
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = response.body?.getReader();

  async function forward() {
    if (!reader) return writer.close();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
    }
    writer.close();
  }

  forward();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      // 允许前端跨域（如有必要）
      "Access-Control-Allow-Origin": "*",
    },
  });
}
