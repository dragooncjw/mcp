export const config = {
  runtime: 'edge', // 必须使用 Edge Runtime 以支持流式响应
};

export default async function handler(req: any) {
  // 1. 拼接目标 MCP SSE 接口地址（替换为你的实际地址）
  const targetUrl = `https://mcp.deepwiki.com/sse`;

  try {
    // 2. 转发请求到目标接口，透传请求头（如认证信息）
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        'Host': new URL(targetUrl).host, // 修正 Host 头，避免目标服务识别错误
      },
      cache: 'no-store', // 禁用缓存，确保 SSE 流实时
      redirect: 'follow',
    });

    // 3. 透传流式响应给前端，保持 SSE 格式
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...response.headers,
        'Cache-Control': 'no-store', // 关键：禁止任何缓存
        'Connection': 'keep-alive', // 保持连接不中断
        'Content-Type': 'text/event-stream', // 明确 SSE 内容类型
      },
    });
  } catch (error) {
    return new Response(`SSE Proxy Error: ${(error as any).message}`, { status: 500 });
  }
}