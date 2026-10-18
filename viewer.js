(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ui = {
    stage: $('stage-area'), viewport: $('slide-viewport'), frame: $('slide-frame'),
    message: $('stage-message'), messageText: $('stage-message-text'), retry: $('retry-button'),
    previous: $('previous-button'), next: $('next-button'), page: $('page-number'),
    pageForm: $('page-form'), total: $('page-total'), title: $('current-title'),
    overview: $('overview-button'), overviewDialog: $('overview-dialog'), search: $('slide-search'),
    list: $('slide-list'), searchResult: $('search-result'), fullscreen: $('fullscreen-button'),
    print: $('print-button'), printDialog: $('print-dialog'), printProgress: $('print-progress'),
    printMeter: $('print-meter'), cancelPrint: $('cancel-print-button'), printPages: $('print-pages'),
    help: $('help-button'), helpDialog: $('help-dialog'), status: $('navigation-status'), toast: $('toast')
  };
  const state = { slides: [], position: -1, scale: 1, swipe: null, printController: null, printReady: false };
  let toastTimer;
  const slideURL = (slide) => `assets/slides/${String(slide.index).padStart(2, '0')}.html`;
  const isElement = (target) => target && target.nodeType === 1 && typeof target.closest === 'function';
  const anyDialogOpen = () => document.querySelector('dialog[open]') !== null;

  function showToast(text) {
    window.clearTimeout(toastTimer);
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    toastTimer = window.setTimeout(() => { ui.toast.hidden = true; }, 5000);
  }

  function fitSlide() {
    const css = window.getComputedStyle(ui.stage);
    const width = ui.stage.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
    const height = ui.stage.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
    state.scale = Math.max(0, Math.min(width / 1600, height / 900));
    ui.viewport.style.width = `${1600 * state.scale}px`;
    ui.viewport.style.height = `${900 * state.scale}px`;
    ui.frame.style.setProperty('--slide-scale', String(state.scale));
  }

  function positionFromHash() {
    const match = /^#slide-(\d+)$/.exec(window.location.hash);
    if (!match) return 0;
    const index = Number(match[1]);
    const found = state.slides.findIndex((slide) => slide.index === index);
    if (found >= 0) return found;
    return index > state.slides.at(-1).index ? state.slides.length - 1 : 0;
  }

  function goTo(position, { history = 'push' } = {}) {
    if (!state.slides.length) return;
    const nextPosition = Math.max(0, Math.min(state.slides.length - 1, position));
    const slide = state.slides[nextPosition];
    const hash = `#slide-${slide.index}`;
    if (window.location.hash !== hash) {
      const method = history === 'replace' ? 'replaceState' : 'pushState';
      window.history[method](null, '', hash);
    }
    ui.page.value = String(nextPosition + 1);
    if (nextPosition === state.position) return;
    state.position = nextPosition;
    ui.viewport.setAttribute('aria-busy', 'true');
    ui.frame.title = `スライド${slide.index}：${slide.title}`;
    // Keep navigation history in the viewer URL, without separate iframe entries.
    const targetURL = new URL(slideURL(slide), window.location.href).href;
    if (ui.frame.contentWindow) ui.frame.contentWindow.location.replace(targetURL);
    else ui.frame.src = targetURL;
    ui.title.textContent = slide.title;
    ui.title.title = slide.title;
    ui.previous.disabled = nextPosition === 0;
    ui.next.disabled = nextPosition === state.slides.length - 1;
    document.title = `${slide.index}. ${slide.title}｜ダレデジ合宿`;
    ui.status.textContent = `${nextPosition + 1} / ${state.slides.length}：${slide.title}`;
    for (const button of ui.list.querySelectorAll('button[data-position]')) {
      if (Number(button.dataset.position) === nextPosition) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }

  function isEditable(target) {
    return isElement(target) && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
  }

  function handleKey(event) {
    if (!state.slides.length || event.defaultPrevented || event.isComposing) return;
    const key = event.key;
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'p' && !event.altKey) {
      event.preventDefault();
      if (!ui.printDialog.open) preparePrint();
      return;
    }
    if (anyDialogOpen() || isEditable(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === ' ' && isElement(event.target) && event.target.closest('button, a[href]')) return;
    let next;
    if (key === 'ArrowRight' || key === 'PageDown' || (key === ' ' && !event.shiftKey)) next = state.position + 1;
    if (key === 'ArrowLeft' || key === 'PageUp' || (key === ' ' && event.shiftKey)) next = state.position - 1;
    if (key === 'Home') next = 0;
    if (key === 'End') next = state.slides.length - 1;
    if (next !== undefined) { event.preventDefault(); goTo(next); }
    else if (key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); }
  }

  function startSwipe(event) {
    if (event.pointerType !== 'touch' || anyDialogOpen() || isEditable(event.target)) return;
    if (!event.isPrimary) { state.swipe = null; return; }
    if (isElement(event.target) && event.target.closest('a[href], button, input, select, textarea')) return;
    const fromFrame = event.view === ui.frame.contentWindow;
    state.swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), scale: fromFrame ? state.scale : 1 };
  }

  function endSwipe(event) {
    const start = state.swipe;
    state.swipe = null;
    if (!start || start.id !== event.pointerId || performance.now() - start.time > 1200) return;
    const dx = (event.clientX - start.x) * start.scale;
    const dy = (event.clientY - start.y) * start.scale;
    if (Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.35) goTo(state.position + (dx < 0 ? 1 : -1));
  }

  function bindSlideEvents() {
    try {
      const frameDocument = ui.frame.contentDocument;
      if (!frameDocument) return;
      const attach = () => {
        frameDocument.addEventListener('keydown', handleKey);
        frameDocument.addEventListener('pointerdown', startSwipe, { passive: true });
        frameDocument.addEventListener('pointerup', endSwipe, { passive: true });
        frameDocument.addEventListener('pointercancel', () => { state.swipe = null; }, { passive: true });
        frameDocument.documentElement.style.touchAction = 'pan-y pinch-zoom';
        ui.viewport.setAttribute('aria-busy', 'false');
      };
      if (frameDocument.readyState === 'loading') frameDocument.addEventListener('DOMContentLoaded', attach, { once: true });
      else attach();
    } catch {
      showToast('スライド内の操作を利用できません。画面下のボタンで移動してください。');
    }
  }

  function buildList() {
    const fragment = document.createDocumentFragment();
    state.slides.forEach((slide, position) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      const number = document.createElement('span');
      const title = document.createElement('span');
      button.type = 'button';
      button.dataset.position = String(position);
      button.dataset.search = `${slide.index} ${slide.title}`.toLocaleLowerCase('ja');
      number.className = 'list-number';
      number.textContent = String(slide.index).padStart(2, '0');
      title.className = 'list-title';
      title.textContent = slide.title;
      button.append(number, title);
      button.addEventListener('click', () => { goTo(position); ui.overviewDialog.close(); ui.overview.focus(); });
      li.append(button);
      fragment.append(li);
    });
    ui.list.replaceChildren(fragment);
    filterList();
  }

  function filterList() {
    const query = ui.search.value.trim().toLocaleLowerCase('ja');
    let visible = 0;
    for (const li of ui.list.children) {
      const matches = li.firstElementChild.dataset.search.includes(query);
      li.hidden = !matches;
      if (matches) visible += 1;
    }
    ui.searchResult.textContent = query ? `${visible}枚 / 全${state.slides.length}枚` : `全${state.slides.length}枚`;
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else showToast('このブラウザは全画面表示に対応していません。');
    } catch {
      showToast('全画面表示を開始できませんでした。ブラウザの表示設定をご確認ください。');
    }
  }

  function updateFullscreen() {
    const active = Boolean(document.fullscreenElement);
    ui.fullscreen.setAttribute('aria-pressed', String(active));
    ui.fullscreen.textContent = active ? '全画面を終了' : '全画面';
    ui.fullscreen.title = active ? '全画面表示を終了（F・Esc）' : '全画面表示（F）';
    requestAnimationFrame(fitSlide);
  }

  function appendPrintSlide(slide, signal) {
    return new Promise((resolve, reject) => {
      const page = document.createElement('section');
      const frame = document.createElement('iframe');
      page.className = 'print-sheet';
      frame.className = 'print-frame';
      frame.title = `印刷用スライド${slide.index}：${slide.title}`;
      frame.loading = 'eager';
      frame.tabIndex = -1;
      let settled = false;
      const timeout = window.setTimeout(() => finish(new Error(`スライド${slide.index}の読み込みに時間がかかっています。`)), 30000);
      const abort = () => finish(new DOMException('印刷準備を中止しました。', 'AbortError'));
      function finish(error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      }
      frame.addEventListener('load', async () => {
        try {
          if (frame.contentDocument?.fonts) await frame.contentDocument.fonts.ready;
          if (signal.aborted) abort(); else finish();
        } catch (error) { finish(error); }
      }, { once: true });
      frame.addEventListener('error', () => finish(new Error(`スライド${slide.index}を読み込めませんでした。`)), { once: true });
      signal.addEventListener('abort', abort, { once: true });
      frame.src = slideURL(slide);
      page.append(frame);
      ui.printPages.append(page);
      if (signal.aborted) abort();
    });
  }

  function cancelPrint() {
    if (state.printController) state.printController.abort();
  }

  async function preparePrint() {
    if (!state.slides.length || state.printController || state.printReady) return;
    const controller = new AbortController();
    state.printController = controller;
    ui.printPages.replaceChildren();
    ui.printMeter.max = state.slides.length;
    ui.printMeter.value = 0;
    ui.printProgress.textContent = `0 / ${state.slides.length}枚`;
    ui.print.disabled = true;
    for (const dialog of [ui.overviewDialog, ui.helpDialog]) if (dialog.open) dialog.close();
    ui.printDialog.showModal();
    let loaded = 0;
    try {
      for (let offset = 0; offset < state.slides.length; offset += 6) {
        if (controller.signal.aborted) throw new DOMException('中止', 'AbortError');
        await Promise.all(state.slides.slice(offset, offset + 6).map(async (slide) => {
          await appendPrintSlide(slide, controller.signal);
          loaded += 1;
          ui.printMeter.value = loaded;
          ui.printProgress.textContent = `${loaded} / ${state.slides.length}枚`;
        }));
      }
      if (controller.signal.aborted) throw new DOMException('中止', 'AbortError');
      state.printReady = true;
      ui.printDialog.close();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.print();
    } catch (error) {
      controller.abort();
      ui.printPages.replaceChildren();
      if (error.name !== 'AbortError') showToast(`印刷を準備できませんでした。${error.message || 'もう一度お試しください。'}`);
    } finally {
      state.printController = null;
      if (ui.printDialog.open) ui.printDialog.close();
      ui.print.disabled = false;
    }
  }

  async function initialize() {
    ui.retry.hidden = true;
    ui.message.hidden = false;
    ui.messageText.textContent = 'スライドを読み込んでいます。';
    try {
      const response = await fetch('manifest.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('manifest');
      const payload = await response.json();
      const slides = Array.isArray(payload) ? payload : payload.slides;
      if (!Array.isArray(slides) || !slides.length) throw new Error('empty');
      const indexes = new Set();
      state.slides = slides.map((slide) => {
        if (!Number.isSafeInteger(slide.index) || slide.index < 1 || typeof slide.title !== 'string' || indexes.has(slide.index)) throw new Error('invalid');
        indexes.add(slide.index);
        return { index: slide.index, title: slide.title };
      }).sort((a, b) => a.index - b.index);
      state.position = -1;
      ui.total.textContent = `/ ${state.slides.length}`;
      ui.page.max = String(state.slides.length);
      ui.page.disabled = false;
      ui.overview.disabled = false;
      ui.print.disabled = false;
      buildList();
      goTo(positionFromHash(), { history: 'replace' });
      ui.message.hidden = true;
      ui.viewport.hidden = false;
      fitSlide();
    } catch {
      ui.viewport.hidden = true;
      ui.messageText.textContent = 'スライド一覧を読み込めませんでした。通信を確認し、再読み込みしてください。';
      ui.retry.hidden = false;
    }
  }

  ui.previous.addEventListener('click', () => goTo(state.position - 1));
  ui.next.addEventListener('click', () => goTo(state.position + 1));
  ui.pageForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = Number(ui.page.value);
    if (!Number.isInteger(value) || value < 1 || value > state.slides.length) {
      ui.page.value = String(state.position + 1);
      showToast(`1〜${state.slides.length}の番号を入力してください。`);
      return;
    }
    goTo(value - 1);
    ui.page.blur();
  });
  ui.page.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { ui.page.value = String(state.position + 1); ui.page.blur(); }
  });
  ui.page.addEventListener('blur', () => { ui.page.value = String(state.position + 1); });
  ui.frame.addEventListener('load', bindSlideEvents);
  ui.overview.addEventListener('click', () => {
    ui.search.value = '';
    filterList();
    ui.overviewDialog.showModal();
    ui.search.focus();
  });
  ui.search.addEventListener('input', filterList);
  ui.help.addEventListener('click', () => ui.helpDialog.showModal());
  ui.fullscreen.addEventListener('click', toggleFullscreen);
  ui.print.addEventListener('click', preparePrint);
  ui.cancelPrint.addEventListener('click', cancelPrint);
  ui.printDialog.addEventListener('cancel', (event) => { event.preventDefault(); cancelPrint(); });
  ui.retry.addEventListener('click', initialize);
  for (const dialog of [ui.overviewDialog, ui.helpDialog]) {
    dialog.querySelector('[data-close-dialog]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
  }
  document.addEventListener('keydown', handleKey);
  ui.stage.addEventListener('pointerdown', startSwipe, { passive: true });
  ui.stage.addEventListener('pointerup', endSwipe, { passive: true });
  ui.stage.addEventListener('pointercancel', () => { state.swipe = null; }, { passive: true });
  window.addEventListener('hashchange', () => { if (state.slides.length) goTo(positionFromHash(), { history: 'replace' }); });
  window.addEventListener('popstate', () => { if (state.slides.length) goTo(positionFromHash(), { history: 'replace' }); });
  document.addEventListener('fullscreenchange', updateFullscreen);
  window.addEventListener('resize', fitSlide);
  if ('ResizeObserver' in window) new ResizeObserver(fitSlide).observe(ui.stage);
  window.addEventListener('afterprint', () => {
    state.printReady = false;
    ui.printPages.replaceChildren();
    ui.print.disabled = false;
  });
  initialize();
})();
