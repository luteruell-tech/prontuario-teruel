/* ============================================================================
 * TERUEL · Interface: helpers, componentes e roteador  (assets/js/ui.js)
 * ==========================================================================*/

'use strict';

import { sessao, estado, agoraProximo, dosesPendentesHoje } from './store.js';
import { PAPEIS, pode } from './auth.js';

/* --------------------------------------------------------------- utilidades */

/** Escapa HTML. Tudo que vem do usuário passa por aqui antes de virar tela. */
export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Atalho para querySelector. */
export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/** Delegação de eventos: um listener no container, vários botões. */
export function aoClicar(raiz, seletor, fn) {
  raiz.addEventListener('click', (ev) => {
    const alvo = ev.target.closest(seletor);
    if (alvo && raiz.contains(alvo)) fn(alvo, ev);
  });
}

/** Debounce simples para campos de busca. */
export function debounce(fn, ms = 220) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ------------------------------------------------------------- formatação */

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DIAS_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function paraData(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function fmtData(v) {
  const d = paraData(v);
  if (!d) return '—';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}

export function fmtHora(v) {
  const d = paraData(v);
  if (!d) return '—';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function fmtDataHora(v) {
  const d = paraData(v);
  if (!d) return '—';
  return fmtData(d) + ' às ' + fmtHora(d);
}

export function fmtDiaLongo(v) {
  const d = paraData(v);
  if (!d) return '—';
  return DIAS[d.getDay()] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()];
}

export function fmtDiaCurto(v) {
  const d = paraData(v);
  if (!d) return '—';
  return DIAS_CURTO[d.getDay()] + ' ' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

/** "há 3 h", "em 2 dias" — leitura rápida, sem números mentais. */
export function relativo(v) {
  const d = paraData(v);
  if (!d) return '—';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const futuro = diff > 0;
  const min = Math.round(abs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return futuro ? 'em ' + min + ' min' : 'há ' + min + ' min';
  const h = Math.round(min / 60);
  if (h < 24) return futuro ? 'em ' + h + ' h' : 'há ' + h + ' h';
  const dias = Math.round(h / 24);
  if (dias === 1) return futuro ? 'amanhã' : 'ontem';
  if (dias < 30) return futuro ? 'em ' + dias + ' dias' : 'há ' + dias + ' dias';
  return fmtData(d);
}

/** Valor datetime-local a partir de um instante. */
export function paraInputLocal(v) {
  const d = paraData(v) || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* ------------------------------------------------------------- retornos seguros */

/**
 * Envolve uma ação em try/catch e mostra o erro ao usuário.
 * Evita que uma falha de permissão ou de rede quebre a tela inteira.
 */
export async function comSeguranca(fn, aviso = 'Não foi possível concluir a ação.') {
  try {
    return await fn();
  } catch (e) {
    toast(e && e.message ? e.message : aviso, 'danger');
    return null;
  }
}

/* ----------------------------------------------------------------- toasts */

export function toast(msg, tipo = '', ms = 3800) {
  let hostBox = $('#toasts');
  if (!hostBox) {
    hostBox = document.createElement('div');
    hostBox.id = 'toasts';
    hostBox.className = 'toasts';
    document.body.appendChild(hostBox);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + tipo;
  el.innerHTML = '<span>' + esc(msg) + '</span>';
  hostBox.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    setTimeout(() => el.remove(), 320);
  }, ms);
}

/* ---------------------------------------------------------------- modais */

/**
 * Abre um modal e resolve com o valor retornado pelo botão clicado.
 * acoes: [{ texto, valor, tipo }]  ·  tipo: primary | soft | ghost | danger
 */
export function modal({ titulo, corpo, acoes = [{ texto: 'Fechar', valor: null, tipo: 'ghost' }], largura }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true"' + (largura ? ' style="max-width:' + largura + '"' : '') + '>'
      + '<div class="modal-head"><h2>' + esc(titulo) + '</h2>'
      + '<button class="modal-x" data-fechar aria-label="Fechar">✕</button></div>'
      + '<div class="modal-body">' + corpo + '</div>'
      + (acoes.length ? '<div class="modal-foot">' + acoes.map((a, i) =>
        '<button class="btn ' + (a.tipo ? 'btn-' + a.tipo : 'btn-ghost') + '" data-acao="' + i + '">' + esc(a.texto) + '</button>'
      ).join('') + '</div>' : '')
      + '</div>';

    const fechar = (valor) => {
      bg.remove();
      document.removeEventListener('keydown', onKey);
      resolve(valor);
    };
    const onKey = (e) => { if (e.key === 'Escape') fechar(null); };

    bg.addEventListener('click', (e) => {
      if (e.target === bg) return fechar(null);
      const x = e.target.closest('[data-fechar]');
      if (x) return fechar(null);
      const a = e.target.closest('[data-acao]');
      if (a) {
        const acao = acoes[Number(a.dataset.acao)];
        if (acao.antesDeFechar) { const r = acao.antesDeFechar(bg); if (r === false) return; }
        // ações com valor 'FORM' devolvem os campos preenchidos
        if (acao.valor === 'FORM') {
          const dados = {};
          $$('[data-campo]', bg).forEach((campo) => {
            const nome = campo.dataset.campo;
            if (campo.type === 'checkbox') dados[nome] = campo.checked;
            else if (campo.type === 'number') dados[nome] = campo.value === '' ? null : Number(campo.value);
            else if (campo.multiple) dados[nome] = [...campo.selectedOptions].map((o) => o.value);
            else dados[nome] = campo.value.trim ? campo.value.trim() : campo.value;
          });
          return fechar({ botao: acao.valor, dados });
        }
        return fechar(acao.valor);
      }
    });

    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    const primeiro = $('input, select, textarea', bg);
    if (primeiro) setTimeout(() => primeiro.focus(), 60);
  });
}

/** Confirmação destrutiva — sempre em vermelho, sempre explícita. */
export function confirmar(titulo, texto, textoOk = 'Confirmar') {
  return modal({
    titulo,
    corpo: '<p class="item-text" style="font-size:.92rem">' + esc(texto) + '</p>',
    acoes: [
      { texto: 'Cancelar', valor: false, tipo: 'ghost' },
      { texto: textoOk, valor: true, tipo: 'danger' },
    ],
  });
}

/* --------------------------------------------------------------- ficha HTML */

export function vazio(icone, titulo, sub, botao) {
  return '<div class="empty"><div class="empty-ic">' + icone + '</div>'
    + '<div class="empty-t">' + esc(titulo) + '</div>'
    + '<div class="empty-s">' + esc(sub) + '</div>'
    + (botao ? '<div style="margin-top:18px">' + botao + '</div>' : '')
    + '</div>';
}

export function campoTexto({ id, label, valor = '', tipo = 'text', placeholder = '', dica, obrigatorio, passo, min, max, autocomplete }) {
  return '<div class="field"><label for="' + id + '">' + esc(label) + (obrigatorio ? ' *' : '') + '</label>'
    + '<input class="input" id="' + id + '" data-campo="' + (id.replace(/^f-/, '')) + '" type="' + tipo + '"'
    + ' value="' + esc(valor) + '" placeholder="' + esc(placeholder) + '"'
    + (passo != null ? ' step="' + passo + '"' : '') + (min != null ? ' min="' + min + '"' : '')
    + (max != null ? ' max="' + max + '"' : '') + (autocomplete ? ' autocomplete="' + autocomplete + '"' : '')
    + '>' + (dica ? '<div class="field-hint">' + esc(dica) + '</div>' : '') + '</div>';
}

export function campoSelect({ id, label, valor = '', opcoes = [], dica, vazio: vazioTxt, obrigatorio }) {
  return '<div class="field"><label for="' + id + '">' + esc(label) + (obrigatorio ? ' *' : '') + '</label>'
    + '<select class="select" id="' + id + '" data-campo="' + (id.replace(/^f-/, '')) + '">'
    + (vazioTxt != null ? '<option value="">' + esc(vazioTxt) + '</option>' : '')
    + opcoes.map((o) => {
      const v = typeof o === 'string' ? o : o.valor;
      const t = typeof o === 'string' ? o : o.texto;
      return '<option value="' + esc(v) + '"' + (String(v) === String(valor) ? ' selected' : '') + '>' + esc(t) + '</option>';
    }).join('')
    + '</select>' + (dica ? '<div class="field-hint">' + esc(dica) + '</div>' : '') + '</div>';
}

export function campoArea({ id, label, valor = '', placeholder = '', dica, linhas = 4 }) {
  return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>'
    + '<textarea class="textarea" id="' + id + '" data-campo="' + (id.replace(/^f-/, '')) + '" rows="' + linhas + '"'
    + ' placeholder="' + esc(placeholder) + '">' + esc(valor) + '</textarea>'
    + (dica ? '<div class="field-hint">' + esc(dica) + '</div>' : '') + '</div>';
}

export function campoCheck({ id, label, marcado, dica }) {
  return '<label class="check"><input type="checkbox" id="' + id + '" data-campo="' + (id.replace(/^f-/, '')) + '"'
    + (marcado ? ' checked' : '') + '><span><b>' + esc(label) + '</b>'
    + (dica ? '<div class="field-hint" style="margin-top:3px">' + esc(dica) + '</div>' : '') + '</span></label>';
}

/* --------------------------------------------------------------- domínio */

/** Cor e emoji do paciente por id. */
export function paciente(id) {
  return (estado.pacientes || []).find((p) => p.id === id) || { nome: 'Paciente', cor: 'var(--ink-3)', avatarEmoji: '👤', id };
}

/** Gravidade visual a partir de um valor x faixa de referência. */
export function gravidade(valor, min, max) {
  if (valor == null || isNaN(valor)) return '';
  if (max != null && valor > max) return 'danger';
  if (min != null && valor < min) return 'warn';
  return 'ok';
}

/** Ícone e cor por tipo de evento clínico. */
export const TIPOS_EVENTO = {
  consulta:    { nome: 'Consulta',     icone: '🩺', cor: 'var(--brand)' },
  exame:       { nome: 'Exame',        icone: '🔬', cor: 'var(--info)' },
  internação:  { nome: 'Internação',   icone: '🏥', cor: 'var(--danger)' },
  'internacao':{ nome: 'Internação',   icone: '🏥', cor: 'var(--danger)' },
  terapia:     { nome: 'Terapia',      icone: '💪', cor: 'var(--ok)' },
  procedimento:{ nome: 'Procedimento', icone: '⚕️', cor: 'var(--warn)' },
  visita:      { nome: 'Visita',       icone: '🏠', cor: 'var(--ink-2)' },
  outro:       { nome: 'Outro',        icone: '📌', cor: 'var(--ink-3)' },
};

export function tipoEvento(t) { return TIPOS_EVENTO[t] || TIPOS_EVENTO.outro; }

/** Lista formatada de condições como pills, com destaque para risco. */
export function pillsCondicoes(lista = [], limite = 99) {
  const risco = /avc|stent|c[âa]ncer|neoplasia|interna|avc|dem[êe]ncia|alzheimer|cadeirante|piora|queda/i;
  return lista.slice(0, limite).map((c) =>
    '<span class="pill ' + (risco.test(c) ? 'danger' : 'brand') + '">' + esc(c) + '</span>'
  ).join('');
}

/* ================================================================ roteador == */

const rotas = new Map();
let rotaAtual = '';
let renderAtual = null;

export function registrarRota(nome, def) { rotas.set(nome, def); }

export function irPara(nome, params = {}) {
  const q = new URLSearchParams(params).toString();
  location.hash = '#/' + nome + (q ? '?' + q : '');
}

export function paramsAtuais() {
  const h = location.hash.replace(/^#\/?/, '');
  const [nome, q] = h.split('?');
  return { nome: nome || 'painel', params: Object.fromEntries(new URLSearchParams(q || '')) };
}

export async function renderRota() {
  const { nome, params } = paramsAtuais();
  const def = rotas.get(nome) || rotas.get('painel');
  const host = $('#view');
  if (!host || !def) return;

  // trava de permissão: mostra aviso em vez de tela quebrada
  if (def.permissao && !pode(def.permissao)) {
    host.innerHTML = '<div class="wrap">' + vazio('🔒', 'Acesso restrito',
      'Seu perfil (' + (PAPEIS[sessao.membro ? sessao.membro.papel : 'leitor'] || {}).nome
      + ') não tem permissão para ver esta área. Fale com o gestor do canal.') + '</div>';
    marcarNav(nome);
    return;
  }

  rotaAtual = nome;
  marcarNav(nome);
  const inicio = performance.now();
  await def.render(host, params);
  renderAtual = nome;
  if (def.after) def.after(host, params);
  const ms = Math.round(performance.now() - inicio);
  if (ms > 400) console.debug('[teruel] ' + nome + ' renderizou em ' + ms + 'ms');
}

function marcarNav(nome) {
  $$('.nav-btn').forEach((b) => b.classList.toggle('on', b.dataset.rota === nome));
  $$('.nav-btn').forEach((b) => {
    const el = $('#' + b.dataset.rota);
    if (el && el.offsetParent !== null) el.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
}

export function navegacaoAtual() { return rotaAtual; }

/* ================================================================ badges === */

export function contadores() {
  const proximo = agoraProximo();
  const pend = dosesPendentesHoje();
  const muralNovo = (estado.mural || []).filter((m) => m.fixado).length;
  return { proximo, pendentes: pend.length, muralNovo };
}

/** Redesenha os números do cabeçalho e da navegação. */
export function atualizarBadges() {
  const c = contadores();
  const bdDoses = $('#badge-doses');
  if (bdDoses) {
    bdDoses.textContent = c.pendentes;
    bdDoses.className = 'nav-badge' + (c.pendentes > 0 ? ' alert' : '');
    bdDoses.style.display = c.pendentes > 0 ? '' : 'none';
  }
  const bdMural = $('#badge-mural');
  if (bdMural) bdMural.textContent = (estado.mural || []).length;

  const elProx = $('#hdr-proximo');
  if (elProx) {
    elProx.textContent = c.proximo
      ? tipoEvento(c.proximo.tipo).icone + ' ' + (c.proximo.titulo || tipoEvento(c.proximo.tipo).nome)
        + ' · ' + relativo(c.proximo.inicio)
      : 'Sem compromissos agendados';
  }
}

/* ================================================================ cabeçalho = */

export function desenharShell(rotasVisiveis) {
  const m = sessao.membro;
  const papel = PAPEIS[m.papel] || PAPEIS.leitor;

  document.body.innerHTML =
    '<div class="app">'
    + '<header class="topbar"><div class="wrap topbar-in">'
    +   '<div class="brand"><div class="brand-mark">🩺</div>'
    +     '<div class="brand-txt"><div class="brand-title">' + esc(estado.config.nomeCanal || 'Canal Teruel') + '</div>'
    +     '<div class="brand-sub" id="hdr-proximo">—</div></div></div>'
    +   '<div class="grow"></div>'
    +   '<span class="seal" title="Cofre cifrado neste aparelho">🔐 <span class="tiny mono">'
    +     esc((sessao.fingerprint || '').replace('TERUEL-', '')) + '</span></span>'
    +   '<button class="avatar" id="btn-conta" style="background:' + esc(m.cor || 'var(--brand)') + '" '
    +     'title="' + esc(m.nome + ' · ' + papel.nome) + '">' + (m.avatarEmoji || '🙂') + '</button>'
    + '</div></header>'
    + '<nav class="nav"><div class="wrap nav-in">'
    +   rotasVisiveis.map((r) =>
      '<button class="nav-btn" data-rota="' + r.rota + '" onclick="location.hash=\'#/' + r.rota + '\'">'
      + r.icone + ' ' + esc(r.titulo)
      + (r.rota === 'medicamentos' ? ' <span class="nav-badge alert" id="badge-doses" style="display:none"></span>' : '')
      + (r.rota === 'mural' ? ' <span class="nav-badge" id="badge-mural"></span>' : '')
      + '</button>').join('')
    + '</div></nav>'
    + '<main class="page" id="view"></main>'
    + '<footer class="foot"><div class="wrap"><p class="foot-txt">'
    +   'Canal privado da família · dados cifrados neste aparelho com a chave do cofre.<br>'
    +   'Este aplicativo organiza informações e <b>não substitui avaliação, diagnóstico ou prescrição médica</b>. '
    +   'Confira sempre os documentos originais.'
    + '</p></div></footer>'
    + '</div>';

  $('#btn-conta').addEventListener('click', () => {
    irPara('ajustes');
  });

  atualizarBadges();
}

export function atualizarTituloCanal() {
  const t = $('.brand-title');
  if (t) t.textContent = estado.config.nomeCanal || 'Canal Teruel';
}
