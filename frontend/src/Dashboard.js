export default class Dashboard {
  constructor(container, apiUrl) {
    this.container = container;
    this.apiUrl = apiUrl;
    this.instances = [];
    this.pending = new Set();
  }

  async init() {
    this.container.innerHTML = `
      <header class="page-header"><div><p>Cloud control</p><h1>Управление серверами</h1></div><span class="live-status">Подключение…</span></header>
      <div class="dashboard">
        <section class="panel"><div class="panel-title"><h2>Инстансы</h2><button class="create">Создать инстанс</button></div><div class="instances"></div></section>
        <section class="panel worklog"><div class="panel-title"><h2>Worklog</h2></div><ul class="events"></ul></section>
      </div>`;
    this.list = this.container.querySelector('.instances');
    this.events = this.container.querySelector('.events');
    this.status = this.container.querySelector('.live-status');
    this.container.querySelector('.create').addEventListener('click', () => this.create());
    this.list.addEventListener('click', (event) => this.action(event));
    await this.load();
    this.connectSse();
    this.connectWebSocket();
  }

  async request(path = '', options = {}) {
    const response = await fetch(new URL(path, this.apiUrl), options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Ошибка сервера');
    return result;
  }

  async load() {
    try {
      this.instances = (await this.request()).data;
      this.render();
    } catch (error) {
      this.list.textContent = error.message;
    }
  }

  connectSse() {
    const source = new EventSource(new URL('sse', this.apiUrl));
    source.onopen = () => { this.status.textContent = 'SSE подключён'; };
    source.onerror = () => { this.status.textContent = 'Переподключение…'; };
    source.onmessage = ({ data }) => this.handleEvent(JSON.parse(data));
  }

  connectWebSocket() {
    const url = new URL(this.apiUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(url);
    this.socket.onmessage = ({ data }) => {
      const updated = JSON.parse(data);
      const index = this.instances.findIndex((item) => item.id === updated.id);
      if (index !== -1) this.instances[index] = updated;
      this.render();
    };
    this.socket.onclose = () => setTimeout(() => this.connectWebSocket(), 1000);
  }

  handleEvent(data) {
    const labels = {
      received: `Получена команда: ${data.command}`,
      created: 'Инстанс создан', started: 'Инстанс запущен',
      stopped: 'Инстанс остановлен', removed: 'Инстанс удалён'
    };
    const item = document.createElement('li');
    const time = new Date(data.timestamp).toLocaleTimeString('ru-RU');
    item.textContent = `${time} — ${labels[data.type]} — ${data.id}`;
    this.events.prepend(item);
    if (data.type === 'received') this.pending.add(data.id);
    if (data.type === 'created') this.instances.push({ id: data.id, state: data.state, timestamp: data.timestamp });
    if (data.type === 'removed') this.instances = this.instances.filter((instance) => instance.id !== data.id);
    if (['created', 'started', 'stopped', 'removed'].includes(data.type)) this.pending.delete(data.id);
    if (data.type === 'started' || data.type === 'stopped') {
      const instance = this.instances.find((entry) => entry.id === data.id);
      if (instance) instance.state = data.state;
    }
    this.render();
  }

  async create() {
    try { await this.request('', { method: 'POST' }); } catch (error) { alert(error.message); }
  }

  async action(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { id, action } = button.dataset;
    if (action === 'delete') {
      try { await this.request(id, { method: 'DELETE' }); } catch (error) { alert(error.message); }
    } else if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ id }));
    }
  }

  render() {
    if (!this.instances.length) {
      this.list.textContent = 'Инстансов пока нет';
      return;
    }
    this.list.replaceChildren(...this.instances.map((instance) => {
      const row = document.createElement('article');
      row.className = 'instance';
      const info = document.createElement('div');
      const id = document.createElement('strong');
      id.textContent = instance.id;
      const state = document.createElement('span');
      state.className = `state state--${instance.state}`;
      state.textContent = instance.state;
      info.append(id, state);
      const actions = document.createElement('div');
      actions.className = 'actions';
      const toggle = document.createElement('button');
      toggle.dataset.action = 'toggle'; toggle.dataset.id = instance.id;
      toggle.textContent = instance.state === 'running' ? 'Остановить' : 'Запустить';
      const remove = document.createElement('button');
      remove.dataset.action = 'delete'; remove.dataset.id = instance.id;
      remove.className = 'delete'; remove.textContent = 'Удалить';
      toggle.disabled = remove.disabled = this.pending.has(instance.id);
      actions.append(toggle, remove);
      row.append(info, actions);
      return row;
    }));
  }
}
