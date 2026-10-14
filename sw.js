/* ============================================================================
 * TERUEL · Service Worker  (sw.js)
 * ----------------------------------------------------------------------------
 * Objetivo: o app abrir mesmo sem internet — isso importa em hospital, onde o
 * sinal é ruim justamente na hora da consulta.
 *
 * Estratégia:
 *   · Pré-cache dos arquivos do próprio app (HTML/CSS/JS/ícones).
 *   · "Network-first, cache-fallback" para o shell: assim uma atualização
 *     chega rápido, mas offline continua abrindo.
 *   · NUNCA guardamos resposta de API nem dados de saúde: os dados ficam no
 *     localStorage/IndexedDB, cifrados, fora do cache do service worker.
 * ==========================================================================*/

const VERSAO = 'teruel-v1';
const ESSENCIAIS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-maskable.svg',
  './assets/css/app.css',
  './assets/js/main.js',
  './assets/js/crypto.js',
  './assets/js/store.js',
  './assets/js/auth.js',
  './assets/js/ui.js',
  './assets/js/ingest.js',
  './assets/js/views/painel.js',
  './assets/js/views/agenda.js',
  './assets/js/views/prontuario.js',
  './assets/js/views/medicamentos.js',
  './assets/js/views/sinais.js',
  './assets/js/views/exames.js',
  './assets/js/views/consulta.js',
  './assets/js/views/documentos.js',
  './assets/js/views/mural.js',
  './assets/js/views/dor.js',
  './assets/js/views/amil.js',
  './assets/js/views/equipe.js',
  './assets/js/views/auditoria.js',
  './assets/js/views/ajustes.js',
];

/* ---------------------------------------------------------------- instalação */
self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(VERSAO);
    // addAll falha inteiro se um arquivo faltar — melhor um por um
    await Promise.all(ESSENCIAIS.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { /* um arquivo ausente não impede a instalação */ }
    }));
    self.skipWaiting();
  })());
});

/* ------------------------------------------------------------------ ativação */
self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const chaves = await caches.keys();
    await Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* --------------------------------------------------------------------- fetch */
self.addEventListener('fetch', (ev) => {
  const req = ev.request;

  // só GET e mesma origem do app
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // nunca interceptar endpoints de dados: eles não pertencem a este cache
  if (url.pathname.includes('/api/') || url.pathname.includes('/estado')) return;

  // navegação (abrir o app): rede primeiro, cache como rede de segurança
  if (req.mode === 'navigate') {
    ev.respondWith((async () => {
      try {
        const resp = await fetch(req);
        const cache = await caches.open(VERSAO);
        cache.put('./index.html', resp.clone());
        return resp;
      } catch {
        const cache = await caches.open(VERSAO);
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
          new Response('Sem conexão e sem cópia local do aplicativo.', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
      }
    })());
    return;
  }

  // arquivos estáticos: cache primeiro, atualizando em segundo plano
  ev.respondWith((async () => {
    const cache = await caches.open(VERSAO);
    const guardado = await cache.match(req);
    const daRede = fetch(req).then((resp) => {
      if (resp && resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
      return resp;
    }).catch(() => null);

    return guardado || (await daRede) || new Response('', { status: 504 });
  })());
});

/* ------------------------------------------------------------- comunicação */
self.addEventListener('message', (ev) => {
  if (ev.data === 'limpar-cache') {
    caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))));
  }
});
