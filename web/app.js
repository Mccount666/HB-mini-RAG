// web/app.js - 网页版主逻辑：聊天 UI + 双模式（演示/后端AI）+ 反馈收集
(function () {
  'use strict';
  const R = window.RagClient;

  // ===== 模式与配置 =====
  const qs = new URLSearchParams(location.search);
  const CFG_API = (window.WEB_CONFIG && window.WEB_CONFIG.API_BASE) || '';
  const lsApi = localStorage.getItem('hb_api_base') || '';
  const API_BASE = (qs.get('api') || lsApi || CFG_API || '').replace(/\/+$/, '');
  const LIVE = !!API_BASE;

  const INDEX_URL = 'data/index.json';
  const FALLBACK = R.FALLBACK;
  const QUICK = [
    '肝母细胞瘤是什么病？',
    '常见症状有哪些？',
    '化疗有什么副作用？',
    '治疗后如何复查随访？',
  ];

  // ===== 状态 =====
  let index = null;        // { items, docStats }
  let messages = [];       // 本会话消息（用于多轮 history）
  let pending = false;
  const SOURCE_REGISTRY = [];

  // ===== 工具 =====
  const $ = (id) => document.getElementById(id);
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function citeHtml(s) { return esc(s).replace(/\[来源(\d+)\]/g, '<span class="cite">[来源$1]</span>'); }
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ===== 初始化 =====
  async function init() {
    $('navBadge').textContent = LIVE ? 'AI 已连接' : '演示模式';
    // 快捷问题
    $('quickList').innerHTML = QUICK.map((q) =>
      `<div style="background:#fff;border:1px solid #e6e9ed;border-radius:7px;padding:11px 12px;font-size:13.5px;text-align:left;cursor:pointer;" onclick="App.ask('${esc(q)}')">${esc(q)}</div>`
    ).join('');
    renderHistory();
    try {
      const res = await fetch(INDEX_URL);
      const data = await res.json();
      index = R.createIndex(data.items);
      console.log('[web] 知识库已加载：' + data.items.length + ' 条');
    } catch (e) {
      console.error('[web] 知识库加载失败', e);
      if (!LIVE) toast('知识库加载失败，请刷新重试');
    }
  }

  // ===== 聊天渲染 =====
  function hideEmpty() { const e = $('emptyState'); if (e) e.style.display = 'none'; }

  function botBubbleHtml(m) {
    let inner = '';
    if (m.loading) {
      inner = '<div class="loading"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
    } else if (m.demo) {
      // 演示模式：直接展示知识库原文卡片（零生成）
      inner = (m.refused
        ? `<div class="content">${esc(m.content)}</div>`
        : `<div class="demo-note">当前为演示模式（未连接 AI 服务）：以下是知识库中与您问题最相关的内容原文，仅供参考。连接 AI 后将基于这些内容生成通俗解答。</div>` +
          m.hits.map((h, i) => `<div class="kb-card"><div class="t">[${i + 1}] ${esc(h.title)}</div><div class="x">${esc(h.text.replace(/^问题：/, '').replace(/\n回答：/, '\n\n'))}</div></div>`).join(''));
    } else {
      inner = `<div class="content">${citeHtml(m.content)}</div>`;
    }
    if (!m.loading && m.sources && m.sources.length) {
      const base = SOURCE_REGISTRY.length;
      SOURCE_REGISTRY.push(...m.sources);
      inner += `<div class="sources"><div class="sources-title">参考来源（点击查看原文摘录）</div>${
        m.sources.map((s, i) => `<span class="source-chip" onclick="App.showSource(${base + i})">[${s.id}] ${esc(s.title)}</span>`).join('')
      }</div>`;
    }
    if (!m.loading && m.feedbackable) {
      const done = m.fbDone ? ' done' : '';
      inner += `<div class="feedback-row" id="fb-${m.mid}">` +
        `<span class="fb-btn${done}" onclick="App.feedback('${m.mid}','good')">👍 有帮助</span>` +
        `<span class="fb-btn${done}" onclick="App.feedback('${m.mid}','bad')">👎 需改进</span>` +
        `<span class="fb-hint">这条回答对您有帮助吗？</span></div>`;
    }
    return `<div class="avatar">医</div><div class="bubble bubble-bot">${inner}</div>`;
  }

  function renderMsg(m) {
    hideEmpty();
    const wrap = document.createElement('div');
    if (m.role === 'user') {
      wrap.className = 'msg msg-user';
      wrap.innerHTML = `<div class="avatar">我</div><div class="bubble bubble-user"><div class="content">${esc(m.content)}</div></div>`;
    } else {
      wrap.className = 'msg msg-bot';
      wrap.innerHTML = botBubbleHtml(m);
    }
    $('msgList').appendChild(wrap);
    $('msgList').scrollTop = $('msgList').scrollHeight;
    return wrap;
  }

  // ===== 发送 =====
  function ask(text) {
    $('chatInput').value = text;
    send();
  }

  async function send() {
    const input = $('chatInput');
    const text = (input.value || '').trim();
    if (!text || pending) return;
    input.value = '';
    renderMsg({ role: 'user', content: text });
    pending = true;
    $('sendBtn').disabled = true;

    const history = messages.slice(-R.CFG.historyTurns).map((m) => ({ role: m.role, content: m.content }));
    const bot = { role: 'assistant', content: '', loading: true, mid: 'm' + Date.now() + Math.random().toString(36).slice(2, 6), feedbackable: true };
    renderMsg(bot);
    const node = $('msgList').lastChild;

    try {
      if (LIVE) {
        // HTTP_SHARED_SECRET 配置在服务端环境变量时，网页需带 x-hb-secret 头（值由部署者写入本文件配置）
        const secret = (window.WEB_CONFIG && window.WEB_CONFIG.HTTP_SHARED_SECRET) || '';
        const res = await fetch(API_BASE + '/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(secret ? { 'x-hb-secret': secret } : {}),
          },
          body: JSON.stringify({ message: text, history }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        bot.loading = false;
        bot.content = data.answer || FALLBACK;
        bot.sources = (data.sources || []).map((s) => ({ id: s.id, title: s.title, excerpt: s.excerpt, source: s.source }));
      } else {
        // 演示模式：本机检索 + 门控（与后端同逻辑）
        await new Promise((r) => setTimeout(r, 250)); // 轻微停顿，避免闪跳
        if (!index) throw new Error('知识库未加载');
        const { refused, hits } = R.retrieveLocal(index, text, history);
        bot.loading = false;
        bot.demo = true;
        bot.refused = refused;
        bot.content = refused ? FALLBACK : '';
        bot.hits = refused ? [] : hits;
        bot.sources = (refused ? [] : hits).map((h, i) => ({ id: i + 1, title: h.title, excerpt: (h.text || '').slice(0, 200) + '…', source: h.source }));
      }
    } catch (e) {
      bot.loading = false;
      bot.content = '服务暂时不可用（' + (e.message || '网络错误') + '）。演示模式下请检查网络后刷新；此问题若持续存在请联系开发者。';
    }

    messages.push({ role: 'user', content: text }, { role: 'assistant', content: bot.demo ? (bot.refused ? FALLBACK : (bot.hits[0] ? bot.hits[0].title : '')) : bot.content });
    // 重绘 bot 气泡（替换 loading）
    const newWrap = document.createElement('div');
    newWrap.className = 'msg msg-bot';
    newWrap.innerHTML = botBubbleHtml(bot);
    node.replaceWith(newWrap);
    $('msgList').scrollTop = $('msgList').scrollHeight;
    saveHistory(text, bot);
    pending = false;
    $('sendBtn').disabled = false;
  }

  // ===== 历史记录 =====
  function saveHistory(q, bot) {
    const list = JSON.parse(localStorage.getItem('hb_web_history') || '[]');
    list.unshift({
      q,
      a: bot.demo ? (bot.refused ? '（拒答：知识库未收录）' : '知识库原文 ×' + bot.hits.length) : bot.content.slice(0, 160),
      timeText: new Date().toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      n: (bot.sources || []).length,
    });
    localStorage.setItem('hb_web_history', JSON.stringify(list.slice(0, 100)));
    renderHistory();
  }

  function renderHistory() {
    const list = JSON.parse(localStorage.getItem('hb_web_history') || '[]');
    $('historyList').innerHTML = list.length
      ? list.map((h) => `<div class="card"><div class="q">${esc(h.q)}</div><div class="a">${citeHtml(h.a)}</div><div class="meta">${esc(h.timeText)} · ${h.n} 个来源</div></div>`).join('') +
        '<div class="clear" onclick="localStorage.removeItem(\'hb_web_history\');App.renderHistory()">清空历史</div>'
      : '<div class="empty-tip">暂无历史问答</div>';
  }

  // ===== 反馈 =====
  function feedback(mid, rating) {
    const msgNode = document.querySelector('#fb-' + mid);
    if (!msgNode || msgNode.dataset.done) return;
    msgNode.dataset.done = '1';
    const openComment = (initial) => {
      App.modal(
        '反馈' + (rating === 'good' ? '：谢谢！' : '：哪里需要改进？'),
        `<input type="text" id="fbComment" placeholder="${rating === 'good' ? '想表扬什么？（可不填）' : '比如：答非所问 / 太难懂 / 想问的内容没有 / 其他'}" value="${esc(initial || '')}" maxlength="200">` +
        `<div class="row"><div class="modal-btn ghost" onclick="App.closeModal()">取消</div><div class="modal-btn" onclick="App.submitFeedback('${mid}','${rating}', true)">提交</div></div>`,
        false
      );
      setTimeout(() => { const el = $('fbComment'); if (el) el.focus(); }, 50);
    };
    if (rating === 'bad') { openComment(''); return; }
    submitFeedback(mid, rating, false);
  }

  function submitFeedback(mid, rating, withComment) {
    const comment = withComment ? (($('fbComment') && $('fbComment').value.trim()) || '') : '';
    // 找到对应问题
    const list = JSON.parse(localStorage.getItem('hb_web_history') || '[]');
    const entry = list.find((h) => h.q) || {};
    const rec = { q: entry.q || '', rating, comment, mode: LIVE ? 'ai' : 'demo', ts: new Date().toISOString() };
    const fb = JSON.parse(localStorage.getItem('hb_web_feedback') || '[]');
    fb.push(rec);
    localStorage.setItem('hb_web_feedback', JSON.stringify(fb.slice(0, 500)));
    const node = document.querySelector('#fb-' + mid);
    if (node) {
      node.innerHTML = `<span class="fb-btn done">${rating === 'good' ? '👍 已记录，谢谢！' : '👎 已记录，谢谢！'}</span>`;
    }
    App.closeModal();
    toast('感谢您的反馈！');
    // 后端在线时同步上报（失败不影响本地记录）
    if (LIVE) {
      fetch(API_BASE + '/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      }).catch(() => {});
    }
  }

  // ===== 弹窗 =====
  function modal(title, bodyHtml, closeModalBtn = true) {
    $('modalBox').innerHTML =
      `<div class="modal-title">${title}</div><div class="modal-excerpt">${bodyHtml}</div>` +
      (closeModalBtn ? '<div class="row"><div class="modal-btn" onclick="App.closeModal()">知道了</div></div>' : '');
    $('modalMask').classList.add('show');
  }
  function closeModal() { $('modalMask').classList.remove('show'); }

  function showSource(regIdx) {
    const s = SOURCE_REGISTRY[regIdx];
    if (!s) return;
    modal(`[${s.id}] ${esc(s.title)}`, esc(s.excerpt || '') + (s.source ? `<br><br><span style="color:#8a9099">出处：${esc(s.source)}</span>` : ''));
  }

  function openSettings() {
    const fbCount = (JSON.parse(localStorage.getItem('hb_web_feedback') || '[]')).length;
    modal(
      '设置',
      `<small><b>当前模式：</b>${LIVE ? 'AI 已连接（' + esc(API_BASE) + '）' : '演示模式（纯本机检索，展示知识库原文）'}</small>` +
      `<input type="text" id="apiInput" placeholder="后端地址（留空 = 演示模式），如 https://xxx.onrender.com" value="${esc(LIVE ? API_BASE : '')}">` +
      `<small>填入后端地址后，本浏览器将切换为 AI 模式（地址仅保存在您的浏览器）。留空则使用网站默认模式。</small>` +
      `<div class="row"><div class="modal-btn ghost" onclick="App.closeModal()">取消</div><div class="modal-btn" onclick="App.saveApi()">保存并刷新</div></div>` +
      `<div class="row"><div class="modal-btn ghost" onclick="App.exportFeedback()">导出本机反馈（${fbCount} 条）</div></div>`
    );
  }

  function saveApi() {
    const v = ($('apiInput').value || '').trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//.test(v)) { toast('地址需以 http(s):// 开头'); return; }
    localStorage.setItem('hb_api_base', v);
    location.reload();
  }

  function exportFeedback() {
    const fb = JSON.parse(localStorage.getItem('hb_web_feedback') || '[]');
    const blob = new Blob([JSON.stringify(fb, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hb-web-feedback.json';
    a.click();
    URL.revokeObjectURL(a.href);
    App.closeModal();
    toast('已导出反馈文件');
  }

  // ===== Tab =====
  function switchTab(el) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
    el.classList.add('on');
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    $(el.dataset.page).classList.add('active');
  }

  // ===== 暴露到全局（onclick 内联调用）=====
  window.App = {
    send, ask, switchTab, renderHistory, showSource, closeModal, modal,
    feedback, submitFeedback, openSettings, saveApi, exportFeedback,
  };

  init();
})();
