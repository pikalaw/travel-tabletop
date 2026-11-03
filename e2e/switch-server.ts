// A static server for update tests: serves a build folder under /travel-tabletop/, and can be
// switched to another build folder, the way GitHub Pages starts serving a new deploy.
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.map': 'application/json',
};

export async function switchServer(root: string, port: number): Promise<{ url: string; use(root: string): void; close(): Promise<void> }> {
  let dir = root;
  const server: Server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url || '/').split('?')[0]!);
    if (!path.startsWith('/travel-tabletop/')) { res.writeHead(404).end(); return; }
    let rel = normalize(path.slice('/travel-tabletop/'.length)).replace(/^(\.\.[/\\])+/, '');
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    try {
      const body = await readFile(join(dir, rel));
      res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>((r) => server.listen(port, r));
  return {
    url: `http://localhost:${port}/travel-tabletop/`,
    use(next) { dir = next; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
