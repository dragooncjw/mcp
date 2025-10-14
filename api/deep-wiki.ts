export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end('Method Not Allowed');
  }

  const body = req.body ?? (await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: any) => data += chunk);
    req.on('end', () => resolve(JSON.parse(data)));
    req.on('error', reject);
  }));

  const { stream } = body;

  if (!stream) {
    // 普通 JSON 转发
    try {
      const resp = await fetch('https://deepwiki.example.com/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(json));
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // ----------------------------
  // Streamable HTTP 转发
  // ----------------------------
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const resp = await fetch('https://deepwiki.example.com/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.body) throw new Error('No response body from DeepWiki MCP');

    // 直接把 DeepWiki 流写给客户端
    const reader = resp.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value)); // Uint8Array -> Buffer
    }
    res.end();

  } catch (err: any) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    res.end();
  }
}
