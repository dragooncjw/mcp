// api/mcp-proxy.ts
import fetch from 'node-fetch';

// ----------------------------
// Vercel Serverless Handler
// ----------------------------
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('Method Not Allowed');
  }

  // 解析请求 body
  let body: any;
  try {
    body = req.body ?? (await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => (data += chunk));
      req.on('end', () => resolve(JSON.parse(data)));
      req.on('error', reject);
    }));
  } catch (err) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
  }

  const { stream } = body;

  const upstreamUrl = 'https://mcp-iota-eight.vercel.app/api/mcp-stream';

  if (stream) {
    // ----------------------------
    // Streamable HTTP SSE
    // ----------------------------
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      const upstreamResp = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!upstreamResp.body) throw new Error('No stream from upstream MCP');

      const reader = upstreamResp.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }

      res.write('event: end\n\n');
      res.end();
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
      res.end();
    }

    return;
  }

  // ----------------------------
  // 普通 JSON 请求
  // ----------------------------
  try {
    const upstreamResp = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const json = await upstreamResp.json();
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(json));
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: err.message }));
  }
}
