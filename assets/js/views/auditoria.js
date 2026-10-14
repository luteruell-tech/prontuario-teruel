/* ============================================================================
 * Tela · Auditoria  (assets/js/views/auditoria.js)
 * ----------------------------------------------------------------------------
 * Quem fez o quê e quando. Não é burocracia: quando seis pessoas cuidam de
 * dois idosos, saber "quem alterou a dose da Losartana" evita discussão e erro.
 * Também é o que a LGPD chama de rastreabilidade de dados sensíveis.
 * ==========================================================================*/

'use strict';

import { estado, sessao } from '../store.js';
import {
  esc, $, debounce, vazio, fmtData, fmtHora, paciente,
} from '../ui.js';

let busca = '';
let fMembro = '';

const ICONES = {
  'dose-registrada': '💊', 'dose-desfeita': '↩️',
  'medicacao-criada': '💊', 'medicacao-editada': '✏️', 'medicacao-suspensa': '⏸', 'medicacao-reativada': '↻',
  'medicacao-excluida': '🗑', 'evento-criado': '📅', 'evento-editado': '✏️',
  'evento-realizado': '✓', 'evento-anotado': '📝', 'evento-excluido': '🗑',
  'sinal-registrado': '📈', 'sinal-excluido': '🗑',
  'exame-criado': '🔬', 'exame-editado': '✏️', 'exame-excluido': '🗑',
  'documento-enviado': '📄', 'documento-editado': '✏️', 'documento-excluido': '🗑',
  'diario-anotado': '📝', 'mural-publicado': '💬', 'mural-editado': '✏️', 'mural-excluido': '🗑',
  'mural-fixado': '📌', 'membro-adicionado': '👤', 'membro-removido': '🚫',
  'membro-desativado': '🚫', 'membro-reativado': '↻', 'papel-alterado': '🔁',
  'pin-trocado': '🔑', 'pin-redefinido': '🔑', 'credencial-guardada': '🔐',
  'credencial-visualizada': '👁', 'credencial-apagada': '🗑',
  'entrou': '🔓', 'saiu': '🔒', 'cofre-criado': '🏛', 'convite-gerado': '📨',
  'importacao': '📥', 'sincronizado': '🔄', 'dor-item-criado': '🏥',
  'dor-item-editado': '✏️', 'dor-item-excluido': '🗑', 'dor-laudo-importado': '⬆️',
  'dor-marcado-baixado': '✓', 'canal-configurado': '⚙️', 'backup-exportado': '💾',
  'backup-importado': '📥', 'config-atualizada': '⚙️', 'cuidados-atualizados': '✏️',
};

export function render(host) {
  const todos = estado.auditoria || [];
  const membros = [...new Set(todos.map((a) => a.membroNome).filter(Boolean))];

  const lista = todos.filter((a) => {
    if (fMembro && a.membroNome !== fMembro) return false;
    if (busca) {
      const t = [a.acao, a.detalhe, a.membroNome].filter(Boolean).join(' ').toLowerCase();
      if (!t.includes(busca.toLowerCase())) return false;
    }
    return true;
  });

  host.innerHTML = '<div class="wrap stack">'
    + '<div class="row-between">'
    +   '<div><h1>Auditoria</h1><p class="muted small">Histórico de tudo que foi feito no canal</p></div>'
    +   '<span class="pill">' + todos.length + ' registro(s)</span>'
    + '</div>'

    + '<div class="note"><div class="note-title">Por que isso existe</div>'
    + 'Com várias pessoas cuidando dos mesmos pais, o registro de quem fez o quê é o que evita '
    + 'dose dobrada, exame perdido e mal-entendido entre irmãos. Nada aqui é apagável — nem pelo gestor.</div>'

    + '<div class="card card-pad stack" style="padding:14px;gap:10px">'
    +   '<input class="input input-search" id="q" type="search" placeholder="Buscar por ação, pessoa, detalhe…" autocomplete="off">'
    +   '<select class="select" id="f-membro"><option value="">Toda a equipe</option>'
    +     membros.map((m) => '<option' + (fMembro === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('')
    +   '</select>'
    + '</div>'

    + '<div id="lista"></div>'
    + '</div>';

  pintar(lista);

  const q = $('#q', host);
  q.value = busca;
  q.addEventListener('input', debounce(() => { busca = q.value; render(host); }, 200));
  $('#f-membro', host).addEventListener('change', (e) => { fMembro = e.target.value; render(host); });
}

function pintar(lista) {
  const box = $('#lista');
  if (!lista.length) {
    box.innerHTML = vazio('📋', 'Nada registrado',
      busca || fMembro ? 'Nenhum registro com esse filtro.' : 'As ações aparecem aqui conforme a família usa o canal.');
    return;
  }

  // agrupa por dia
  const grupos = new Map();
  for (const a of lista) {
    const k = fmtData(a.em);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  }

  box.innerHTML = '<div class="stack">'
    + [...grupos.entries()].map(([dia, itens]) => '<div class="stack" style="gap:6px">'
      + '<div class="section-title">' + esc(dia === fmtData(new Date()) ? 'HOJE' : dia) + ' · ' + itens.length + '</div>'
      + '<div class="card"><div class="card-body stack" style="gap:0;padding:6px 16px">'
      + itens.map((a, i) => '<div class="row" style="gap:11px;padding:11px 0;align-items:flex-start;'
          + (i < itens.length - 1 ? 'border-bottom:1px solid var(--line)' : '') + '">'
        + '<span style="font-size:1.05rem;flex-shrink:0;margin-top:1px">' + (ICONES[a.acao] || '•') + '</span>'
        + '<div class="grow">'
        +   '<div class="small"><b>' + esc(a.membroNome || 'Sistema') + '</b> '
        +     '<span class="muted">' + esc(rotulo(a.acao)) + '</span></div>'
        +   (a.detalhe ? '<div class="small muted" style="margin-top:2px">' + esc(a.detalhe) + '</div>' : '')
        +   (a.pacienteId ? '<span class="pill ghost tiny" style="margin-top:5px;display:inline-flex">'
            + paciente(a.pacienteId).avatarEmoji + ' ' + esc(paciente(a.pacienteId).nome.split(' ')[0]) + '</span>' : '')
        + '</div>'
        + '<span class="tiny muted mono" style="white-space:nowrap">' + esc(fmtHora(a.em)) + '</span>'
        + '</div>').join('')
      + '</div></div></div>').join('')
    + '</div>';
}

function rotulo(acao) {
  return String(acao || '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
