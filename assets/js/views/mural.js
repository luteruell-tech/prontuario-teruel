/* ============================================================================
 * Tela · Mural da família  (assets/js/views/mural.js)
 * ----------------------------------------------------------------------------
 * "Falar a mesma língua": aqui a família combina quem faz o quê, registra o
 * que mudou e deixa recado. Três tipos de recado:
 *   · Aviso    — informação importante para todos
 *   · Recado   — combinado do dia a dia
 *   · Escala   — quem acompanha em qual dia (aparece no Painel como plantão)
 * ==========================================================================*/

'use strict';

import { estado, inserir, atualizar, remover, auditar, novoId, sessao, porId } from '../store.js';
import { pode } from '../auth.js';
import {
  esc, $, modal, confirmar, toast, vazio, fmtData, fmtDataHora, relativo,
  paciente, campoTexto, campoSelect, campoArea, atualizarBadges,
} from '../ui.js';

const TIPOS = {
  aviso:  { nome: 'Aviso',  icone: '📢', pill: 'brand' },
  recado: { nome: 'Recado', icone: '💬', pill: '' },
  escala: { nome: 'Escala', icone: '🗓',  pill: 'warn' },
  conquista: { nome: 'Conquista', icone: '⭐', pill: 'ok' },
};

let fTipo = '';

export function render(host) {
  const lista = estado.mural.filter((m) => !fTipo || m.tipo === fTipo)
    .sort((a, b) => (b.fixado ? 1 : 0) - (a.fixado ? 1 : 0) || (b.criadoEm - a.criadoEm));

  const escalas = estado.mural.filter((m) => m.tipo === 'escala').sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  const escalaSemana = escalas.filter((e) => {
    if (!e.data) return false;
    const d = new Date(e.data + 'T12:00:00').getTime();
    return d >= Date.now() - 86400000 && d <= Date.now() + 7 * 86400000;
  });

  host.innerHTML = '<div class="wrap stack">'
    + '<div class="row-between">'
    +   '<div><h1>Mural</h1><p class="muted small">Canal da família · todos veem o mesmo</p></div>'
    +   (pode('escrever') ? '<button class="btn btn-primary" data-acao="novo">＋ Recado</button>' : '')
    + '</div>'

    + '<div class="note ok"><div class="note-title">🤝 Combinado do canal</div>'
    + 'O que for decidido aqui vale para todos. Antes de agir na dúvida, escreva no mural — '
    + 'assim ninguém fica desencontrado.</div>'

    + (escalaSemana.length
      ? '<div class="card card-pad stack" style="gap:10px">'
        + '<div class="row-between"><h3>🗓 Quem acompanha esta semana</h3>'
        + '<button class="btn btn-sm btn-soft" data-acao="nova-escala">＋ Escala</button></div>'
        + escalaSemana.map((e) => {
          const d = new Date(e.data + 'T12:00:00');
          const ehHoje = e.data === new Date().toISOString().slice(0, 10);
          return '<div class="item" style="padding:11px 13px;' + (ehHoje ? 'border-color:var(--brand);background:var(--brand-soft)' : '') + '">'
            + '<div class="item-bar" style="background:' + (ehHoje ? 'var(--brand)' : 'var(--warn)') + '"></div>'
            + '<div class="item-main"><div class="item-title" style="font-size:.9rem">'
            + esc(diaSemana(d) + ' · ' + fmtData(e.data)) + (ehHoje ? ' <span class="pill brand">hoje</span>' : '') + '</div>'
            + '<div class="item-text">' + esc(e.texto) + '</div></div>'
            + (pode('escrever') ? '<button class="btn btn-sm btn-ghost" data-acao="editar" data-id="' + esc(e.id) + '">✏️</button>' : '')
            + '</div>';
        }).join('')
        + '</div>'
      : '')

    + '<div class="pac-tabs">'
    +   '<button class="pac-tab' + (fTipo === '' ? ' on' : '') + '" data-tipo="">Todos</button>'
    +   Object.entries(TIPOS).map(([k, t]) => '<button class="pac-tab' + (fTipo === k ? ' on' : '')
        + '" data-tipo="' + k + '">' + t.icone + ' ' + t.nome + '</button>').join('')
    + '</div>'

    + (lista.length
      ? '<div class="stack" style="gap:9px">' + lista.map(cartao).join('') + '</div>'
      : vazio('💬', 'Mural vazio',
        'Escreva o primeiro recado: um combinado, uma mudança que você notou, uma conquista dos seus pais.',
        pode('escrever') ? '<button class="btn btn-primary" data-acao="novo">＋ Escrever</button>' : ''))

    + '<div class="section-title">Equipe do canal</div>'
    + '<div class="card card-pad"><div class="row-wrap">'
    + (sessao.membro ? '<span class="pill brand">' + esc(sessao.membro.avatarEmoji + ' ' + sessao.membro.nome) + ' (você)</span>' : '')
    + autoresUnicos().map((a) => '<span class="pill">' + esc(a) + '</span>').join('')
    + '</div></div>'
    + '</div>';

  host.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tipo]');
    if (t) { fTipo = t.dataset.tipo; render(host); return; }

    const ac = ev.target.closest('[data-acao]');
    if (!ac) return;
    const a = ac.dataset.acao;
    if (a === 'novo') formRecado(null, 'recado');
    else if (a === 'nova-escala') formRecado(null, 'escala');
    else if (a === 'editar') formRecado(porId('mural', ac.dataset.id));
    else if (a === 'fixar') fixar(ac.dataset.id, host);
    else if (a === 'excluir') excluir(ac.dataset.id, host);
  });
}

function autoresUnicos() {
  const nomes = [...new Set(estado.mural.map((m) => m.autorNome).filter(Boolean))];
  return nomes.filter((n) => n !== (sessao.membro && sessao.membro.nome));
}

function diaSemana(d) {
  return ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][d.getDay()];
}

function cartao(m) {
  const t = TIPOS[m.tipo] || TIPOS.recado;
  const meu = sessao.membro && m.autorId === sessao.membro.id;
  return '<div class="card" style="' + (m.fixado ? 'border-color:var(--brand);box-shadow:0 0 0 2px rgba(20,64,190,.08)' : '') + '">'
    + '<div class="card-body stack" style="gap:9px;padding:15px 17px">'
    +   '<div class="row-between">'
    +     '<div class="row" style="gap:8px">'
    +       '<span class="pill ' + t.pill + '">' + t.icone + ' ' + esc(t.nome) + '</span>'
    +       (m.pacienteId ? '<span class="pill ghost" style="color:' + paciente(m.pacienteId).cor + '">'
            + paciente(m.pacienteId).avatarEmoji + ' ' + esc(paciente(m.pacienteId).nome.split(' ')[0]) + '</span>' : '')
    +     '</div>'
    +     (m.fixado ? '<span class="pill brand">📌 fixado</span>' : '')
    +   '</div>'
    +   (m.titulo ? '<div class="item-title">' + esc(m.titulo) + '</div>' : '')
    +   '<div class="item-text">' + esc(m.texto) + '</div>'
    +   (m.data ? '<div class="item-meta"><span>📅 ' + esc(fmtData(m.data)) + '</span></div>' : '')
    +   '<div class="row-between"><span class="tiny muted">'
    +     esc((m.autorNome || 'Família') + ' · ' + relativo(m.criadoEm)) + (meu ? ' · você' : '') + '</span>'
    +     '<div class="item-actions">'
    +       (pode('escrever') ? '<button class="btn btn-sm btn-ghost" data-acao="editar" data-id="' + esc(m.id) + '">✏️</button>' : '')
    +       (pode('gerirConfig') ? '<button class="btn btn-sm btn-ghost" data-acao="fixar" data-id="' + esc(m.id) + '">'
            + (m.fixado ? 'desafixar' : 'fixar') + '</button>' : '')
    +       (pode('excluir') ? '<button class="btn btn-sm btn-danger-soft" data-acao="excluir" data-id="' + esc(m.id) + '">🗑</button>' : '')
    +     '</div>'
    +   '</div>'
    + '</div></div>';
}

/* ------------------------------------------------------------------- ações */

async function formRecado(m, tipoInicial) {
  const editando = !!m;
  const r = await modal({
    titulo: editando ? 'Editar recado' : (tipoInicial === 'escala' ? 'Nova escala' : 'Novo recado'),
    corpo: '<div class="stack">'
      + campoSelect({ id: 'f-tipo', label: 'Tipo', valor: m ? m.tipo : tipoInicial, vazio: null,
          opcoes: Object.entries(TIPOS).map(([k, t]) => ({ valor: k, texto: t.icone + ' ' + t.nome })) })
      + campoTexto({ id: 'f-titulo', label: 'Título (opcional)', valor: m ? m.titulo || '' : '',
          placeholder: 'Ex.: Fisioterapia às terças' })
      + campoArea({ id: 'f-texto', label: 'Recado', valor: m ? m.texto : '', linhas: 5, obrigatorio: true,
          placeholder: 'Escreva de forma direta. Ex.: "Terça e quinta eu levo a mãe na fisio. '
            + 'Se alguém puder trocar em setembro, avise."' })
      + campoTexto({ id: 'f-data', label: 'Data (para escala)', valor: m ? m.data || '' : new Date().toISOString().slice(0, 10), tipo: 'date' })
      + campoSelect({ id: 'f-pacienteId', label: 'Sobre quem', valor: m ? m.pacienteId || '' : '', vazio: 'Geral (os dois)',
          opcoes: estado.pacientes.map((p) => ({ valor: p.id, texto: p.avatarEmoji + ' ' + p.nome })) })
      + (pode('gerirConfig') ? '<label class="check"><input type="checkbox" data-campo="fixado"'
          + (m && m.fixado ? ' checked' : '') + '><span><b>Fixar no topo do Painel</b>'
          + '<div class="field-hint" style="margin-top:3px">Use para o que todos precisam ver todos os dias.</div></span></label>' : '')
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Publicar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;
  if (!d.texto) return toast('Escreva o recado.', 'warn');
  d.autorId = sessao.membro.id;
  d.autorNome = sessao.membro.nome;

  if (editando) { atualizar('mural', m.id, d); toast('Recado atualizado.', 'ok'); }
  else { inserir('mural', { id: novoId('mur'), ...d }); toast('Publicado no mural.',
    d.tipo === 'escala' ? 'ok' : ''); }

  auditar(editando ? 'mural-editado' : 'mural-publicado', d.tipo + ': ' + d.texto.slice(0, 60), d.pacienteId || null);
  atualizarBadges();
  render(document.getElementById('view'));
}

function fixar(id, host) {
  const m = porId('mural', id);
  if (!m) return;
  atualizar('mural', id, { fixado: !m.fixado });
  auditar('mural-fixado', m.titulo || m.texto.slice(0, 40));
  toast(m.fixado ? 'Recado desafixado.' : 'Recado fixado no Painel.', 'ok');
  render(host);
}

async function excluir(id, host) {
  const m = porId('mural', id);
  if (!m) return;
  if (!await confirmar('Excluir recado?', 'Ele desaparecerá para todos os membros da família.', 'Excluir')) return;
  remover('mural', id);
  auditar('mural-excluido', m.texto.slice(0, 50));
  atualizarBadges();
  toast('Recado excluído.');
  render(host);
}
