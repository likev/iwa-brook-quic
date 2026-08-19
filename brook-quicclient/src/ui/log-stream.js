/**
 * Log Stream: Real-Time Event & Traffic Visualizer with Safe DOM rendering.
 */

import { DomBuilder } from './dom-builder.js';
import { formatHexDump } from '../core/byte-utils.js';

export class LogStream {
  constructor({ container, maxLogs = 500, modalContainer }) {
    this.container = container;
    this.maxDisplayLogs = maxLogs;
    this.modalContainer = modalContainer;

    this.displayLogs = [];
    this.allHistoricalLogs = []; // Stores 100% of all logs since app start
    this.filterLevel = 'all'; // 'all', 'info', 'success', 'warning', 'error'
    this.autoScroll = true;
  }

  add(level, message, meta = null) {
    const timestamp = new Date().toLocaleTimeString();
    const logItem = {
      id: Date.now() + Math.random(),
      timestamp,
      level,
      message,
      meta
    };

    // 1. Record in complete historical log from app start
    this.allHistoricalLogs.push(logItem);

    // 2. Keep bounded display log buffer for DOM rendering performance
    this.displayLogs.push(logItem);
    if (this.displayLogs.length > this.maxDisplayLogs) {
      this.displayLogs.shift();
    }

    if (this._matchesFilter(level)) {
      this._renderEntry(logItem);
      if (this.autoScroll && this.container) {
        this.container.scrollTop = this.container.scrollHeight;
      }
    }
  }

  _matchesFilter(level) {
    if (this.filterLevel === 'all') return true;
    return this.filterLevel === level;
  }

  setFilter(level) {
    this.filterLevel = level;
    this.render();
  }

  getTotalLogsCount() {
    return this.allHistoricalLogs.length;
  }

  getFormattedLogs(fromAppStart = true) {
    const source = fromAppStart ? this.allHistoricalLogs : this.displayLogs;
    return source.map(l => `[${l.timestamp}] ${l.level.toUpperCase().padEnd(7)} ${l.message}`).join('\n');
  }

  clear() {
    this.displayLogs = [];
    if (this.container) {
      DomBuilder.clear(this.container);
    }
  }

  render() {
    if (!this.container) return;
    DomBuilder.clear(this.container);

    const filtered = this.displayLogs.filter(l => this._matchesFilter(l.level));
    for (const logItem of filtered) {
      this._renderEntry(logItem);
    }

    if (this.autoScroll) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  _renderEntry(logItem) {
    if (!this.container) return;

    const timeSpan = DomBuilder.el('span', { classes: ['log-time'], text: `[${logItem.timestamp}]` });
    const levelSpan = DomBuilder.el('span', { classes: ['log-badge', `badge-${logItem.level}`], text: logItem.level.toUpperCase() });
    const msgSpan = DomBuilder.el('span', { classes: ['log-msg'], text: logItem.message });

    const children = [timeSpan, levelSpan, msgSpan];

    if (logItem.meta && logItem.meta.hexDump) {
      const inspectBtn = DomBuilder.el('button', {
        classes: ['btn-inspect'],
        text: '🔍 Hex',
        attrs: { type: 'button' }
      });
      inspectBtn.addEventListener('click', () => {
        this.showHexModal(logItem.meta.hexDump, logItem.message);
      });
      children.push(inspectBtn);
    }

    const row = DomBuilder.el('div', {
      classes: ['log-row', `log-${logItem.level}`],
      children
    });

    this.container.appendChild(row);

    // Prune DOM elements if too many
    while (this.container.children.length > this.maxDisplayLogs) {
      this.container.removeChild(this.container.firstChild);
    }
  }

  showHexModal(u8Data, title = 'Payload Hex Inspector') {
    if (!this.modalContainer) return;
    DomBuilder.clear(this.modalContainer);

    const dumpText = typeof u8Data === 'string' ? u8Data : formatHexDump(u8Data);

    const titleEl = DomBuilder.el('h3', { classes: ['modal-title'], text: title });
    const preEl = DomBuilder.el('pre', { classes: ['hex-dump-content'], text: dumpText });

    const closeBtn = DomBuilder.el('button', {
      classes: ['btn', 'btn-secondary'],
      text: 'Close',
      attrs: { type: 'button' }
    });
    closeBtn.addEventListener('click', () => {
      this.modalContainer.classList.add('hidden');
      DomBuilder.clear(this.modalContainer);
    });

    const modalBox = DomBuilder.el('div', {
      classes: ['modal-box'],
      children: [titleEl, preEl, closeBtn]
    });

    this.modalContainer.appendChild(modalBox);
    this.modalContainer.classList.remove('hidden');
  }
}
