import { createServer } from 'node:http';
import sirv from 'sirv';

const PORT = parseInt(process.env.PORT || '80', 10);

const serve = sirv('build', {
  single: true,
  gzip: true,
  brotli: true,
  etag: true,
  setHeaders(res, pathname) {
    if (pathname.startsWith('/_app/immutable/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
});

createServer((req, res) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = (Date.now() - start).toFixed(2);
    const time = new Date().toLocaleTimeString('en', { hour12: false });
    console.log(`  [${time}] ${res.statusCode} \u2500 ${ms}ms \u2500 ${req.url}`);
  });
  serve(req, res);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`  phosphor listening on :${PORT}`);
});
