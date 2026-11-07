import { randomUUID } from 'node:crypto';
import http from 'node:http';
import cors from 'cors';
import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const instances = [];
const sseClients = new Set();
const pending = new Set();
const delay = Number(process.env.OPERATION_DELAY_MS || 10000);

app.use(cors());
app.use(express.json());

function event(type, id, extra = {}) {
  const data = { type, id, timestamp: Date.now(), ...extra };
  for (const response of sseClients) response.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.get('/', (_request, response) => response.json({ data: instances }));
app.get('/sse', (request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  response.write(': connected\n\n');
  sseClients.add(response);
  const keepAlive = setInterval(() => response.write(': ping\n\n'), 20000);
  request.on('close', () => { clearInterval(keepAlive); sseClients.delete(response); });
});
app.post('/', (_request, response) => {
  const id = randomUUID();
  event('received', id, { command: 'create' });
  setTimeout(() => {
    const instance = { id, state: 'stopped', timestamp: Date.now() };
    instances.push(instance);
    event('created', id, { state: instance.state });
  }, delay);
  response.status(202).json({ status: 'ok', id });
});
app.delete('/:id', (request, response) => {
  const instance = instances.find((item) => item.id === request.params.id);
  if (!instance) return response.status(404).json({ message: 'Instance not found' });
  if (pending.has(instance.id)) return response.status(409).json({ message: 'Operation already in progress' });
  pending.add(instance.id);
  event('received', instance.id, { command: 'remove' });
  setTimeout(() => {
    const index = instances.findIndex((item) => item.id === instance.id);
    if (index !== -1) instances.splice(index, 1);
    pending.delete(instance.id);
    event('removed', instance.id);
  }, delay);
  return response.status(202).json({ status: 'ok' });
});

wss.on('connection', (socket) => {
  socket.on('message', (buffer) => {
    let data;
    try { data = JSON.parse(buffer.toString()); } catch { return; }
    const instance = instances.find((item) => item.id === data.id);
    if (!instance || pending.has(instance.id)) return;
    pending.add(instance.id);
    const nextState = instance.state === 'running' ? 'stopped' : 'running';
    event('received', instance.id, { command: nextState === 'running' ? 'start' : 'stop' });
    setTimeout(() => {
      instance.state = nextState;
      instance.timestamp = Date.now();
      pending.delete(instance.id);
      const message = JSON.stringify(instance);
      for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(message);
      event(nextState === 'running' ? 'started' : 'stopped', instance.id, { state: nextState });
    }, delay);
  });
});

const port = Number(process.env.PORT || 3001);
server.listen(port, '0.0.0.0', () => console.info(`Dashboard server: http://localhost:${port}`));
