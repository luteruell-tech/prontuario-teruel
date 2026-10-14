/* ============================================================================
 * Tela · Agenda  (assets/js/views/agenda.js)
 * ----------------------------------------------------------------------------
 * Consultas, exames, internações, terapias e procedimentos dos dois pacientes
 * num só calendário. É a tela que evita "quem leva quem, e quando".
 * ==========================================================================*/

'use strict';

import { estado, inserir, atualizar, remover, auditar, novoId, porId } from '../store.js';
import { pode } from '../auth.js';
import {
  esc, $, modal, confirmar, toast, vazio, fmtData, fmtHora,
  fmtDiaLongo, relativo, paraInputLocal, paraData, tipoEvento, TIPOS_EVENTO,
  paciente, campoTexto, campoSelect, campoArea, atualizarBadges,
} from '../ui.js';

let filtroPaciente = '';
let filtroStatus = 'proximos';

const STATUS = {
  agendado: { nome: 'Agendado', pill: 'brand' },
  confirmado: { nome: 'Confirmado', pill: 'ok' },
  realizado: { nome: 'Realizado', pill: '' },
  cancelado: { nome: 'Cancelado', pill: 'danger' },
  remarcado: { nome: 'Remarcado', pill: 'warn' },
};

export function render(host) {
  const eventos = filtrar();

  host.innerHTML = '<div class="wrap stack">'
    + '<div class="row-between">'
    +   '<div><h1>Agenda</h1><p class="muted small">Consultas, exames, internações e terapias dos dois</p></div>'
    +   (pode('escrever') ? '<button class="btn btn-primary" id="btn-novo">＋ Novo</button>' : '')
    + '</div>'
    + cabecalhoFiltros()
    + '<div id="lista" class="stack"></div>'
    + '</div>';

  pintarLista(eventos);
  ligarEventos(host);
}

function cabecalhoFiltros() {
  const tabsPac = [{ v: '', t: 'Os dois' }].concat(
    estado.pacientes.map((p) => ({ v: p.id, t: p.avatarEmoji + ' ' + p.nome.split(' ')[0] }))
  );
  return '<div class="card card-pad stack" style="padding:14px">'
    + '<div class="row-wrap">'
    +   '<div class="pac-tabs">'
    +     tabsPac.map((p) => '<button class="pac-tab' + (filtroPaciente === p.v ? ' on' : '')
          + '" data-pac="' + esc(p.v) + '">' + esc(p.t) + '</button>').join('')
    +   '</div>'
    + '</div>'
    + '<div class="field"><label for="f-status">Mostrar</label>'
    +   '<select class="select" id="f-status">'
    +     ['proximos', 'hoje', 'semana', 'passados', 'todos'].map((s) => {
          const nomes = { proximos: 'Próximos compromissos', hoje: 'Só hoje', semana: 'Próximos 7 dias', passados: 'Já realizados', todos: 'Todos' };
          return '<option value="' + s + '"' + (filtroStatus === s ? ' selected' : '') + '>' + nomes[s] + '</option>';
        }).join('')
    +   '</select></div>'
    + '</div>';
}

function filtrar() {
  const agora = Date.now();
  const seteDias = agora + 7 * 86400000;
  let lista = [...estado.eventos];

  if (filtroPaciente) lista = lista.filter((e) => e.pacienteId === filtroPaciente);

  if (filtroStatus === 'hoje') {
    const ini = new Date(); ini.setHours(0, 0, 0, 0);
    const fim = ini.getTime() + 86400000;
    lista = lista.filter((e) => { const t = paraData(e.inicio); return t && t.getTime() >= ini.getTime() && t.getTime() < fim; });
  } else if (filtroStatus === 'semana') {
    lista = lista.filter((e) => { const t = paraData(e.inicio); return t && t.getTime() >= agora - 3600000 && t.getTime() <= seteDias; });
  } else if (filtroStatus === 'proximos') {
    lista = lista.filter((e) => { const t = paraData(e.inicio); return t && t.getTime() >= agora - 3600000 && e.status !== 'cancelado'; });
  } else if (filtroStatus === 'passados') {
    lista = lista.filter((e) => { const t = paraData(e.inicio); return t && (t.getTime() < agora || e.status === 'realizado'); });
  }

  return lista.sort((a, b) => {
    const ta = paraData(a.inicio) ? paraData(a.inicio).getTime() : 0;
    const tb = paraData(b.inicio) ? paraData(b.inicio).getTime() : 0;
    return filtroStatus === 'passados' ? tb - ta : ta - tb;
  });
}

function pintarLista(eventos) {
  const box = $('#lista');
  if (!eventos.length) {
    box.innerHTML = vazio('📅', 'Nada por aqui neste filtro',
      'Cadastre a próxima consulta, exame ou sessão de fisioterapia para ninguém perder o compromisso.',
      pode('escrever') ? '<button class="btn btn-primary" data-novo>＋ Agendar compromisso</button>' : '');
    return;
  }

  // agrupa por dia
  const grupos = new Map();
  for (const e of eventos) {
    const d = paraData(e.inicio);
    const chave = d ? fmtData(d) : 'Sem data';
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(e);
  }

  box.innerHTML = [...grupos.entries()].map(([dia, itens]) => {
    const primeiro = paraData(itens[0].inicio);
    const ehHoje = primeiro && fmtData(primeiro) === fmtData(new Date());
    return '<div class="stack" style="gap:8px">'
      + '<div class="section-title">' + esc(ehHoje ? 'HOJE · ' + fmtDiaLongo(primeiro) : fmtDiaLongo(primeiro)) + '</div>'
      + itens.map(cartaoEvento).join('')
      + '</div>';
  }).join('');
}

function cartaoEvento(e) {
  const p = paciente(e.pacienteId);
  const te = tipoEvento(e.tipo);
  const st = STATUS[e.status] || STATUS.agendado;
  const atrasado = e.status === 'agendado' && paraData(e.inicio) && paraData(e.inicio).getTime() < Date.now();

  return '<div class="item" data-id="' + esc(e.id) + '">'
    + '<div class="item-bar" style="background:' + te.cor + '"></div>'
    + '<div class="item-main">'
    +   '<div class="row-between"><div class="item-title">' + te.icone + ' ' + esc(e.titulo || te.nome) + '</div>'
    +     '<span class="pill ' + st.pill + '">' + esc(atrasado ? 'Pendente' : st.nome) + '</span></div>'
    +   '<div class="item-meta">'
    +     '<span class="pill ghost" style="color:' + p.cor + ';border-color:' + p.cor + '">' + p.avatarEmoji + ' ' + esc(p.nome) + '</span>'
    +     '<span>🕒 ' + esc(fmtHora(e.inicio)) + '</span>'
    +     (e.local ? '<span>📍 ' + esc(e.local) + '</span>' : '')
    +     (e.profissional ? '<span>👤 ' + esc(e.profissional) + '</span>' : '')
    +     '<span class="muted">' + esc(relativo(e.inicio)) + '</span>'
    +   '</div>'
    +   (e.observacoes ? '<div class="item-text">' + esc(e.observacoes) + '</div>' : '')
    +   (e.precisaAcompanhante ? '<div class="tiny" style="color:var(--warn)">⚠️ Precisa de acompanhante</div>' : '')
    +   (e.transporte ? '<div class="tiny muted">🚗 ' + esc(e.transporte) + '</div>' : '')
    +   '<div class="item-actions">'
    +     (pode('escrever') ? '<button class="btn btn-sm btn-ghost" data-acao="editar">✏️ Editar</button>' : '')
    +     (pode('escrever') && e.status !== 'realizado' ? '<button class="btn btn-sm btn-ok" data-acao="realizado">✓ Realizado</button>' : '')
    +     (e.resultado ? '<button class="btn btn-sm btn-soft" data-acao="resultado">📄 Ver anotação</button>'
        : (pode('escrever') ? '<button class="btn btn-sm btn-soft" data-acao="resultado">＋ Anotar resultado</button>' : ''))
    +     (pode('excluir') ? '<button class="btn btn-sm btn-danger-soft" data-acao="excluir">🗑</button>' : '')
    +   '</div>'
    + '</div>'
    + '</div>';
}

function ligarEventos(host) {
  host.addEventListener('click', (ev) => {
    const pac = ev.target.closest('[data-pac]');
    if (pac) { filtroPaciente = pac.dataset.pac; render(host); return; }

    if (ev.target.closest('#btn-novo') || ev.target.closest('[data-novo]')) { abrirForm(); return; }

    const acao = ev.target.closest('[data-acao]');
    if (!acao) return;
    const card = acao.closest('[data-id]');
    const e = porId('eventos', card.dataset.id);
    if (!e) return;

    if (acao.dataset.acao === 'editar') abrirForm(e);
    else if (acao.dataset.acao === 'realizado') marcarRealizado(e);
    else if (acao.dataset.acao === 'resultado') anotarResultado(e);
    else if (acao.dataset.acao === 'excluir') excluir(e);
  });

  const sel = $('#f-status', host);
  if (sel) sel.addEventListener('change', () => { filtroStatus = sel.value; render(host); });

  // atalho: clicar no "+" do cabeçalho
  const btnNovo = $('#btn-novo', host);
  if (btnNovo) btnNovo.onclick = () => abrirForm();
}

/* ------------------------------------------------------------------ ações */

async function abrirForm(e = null) {
  const editando = !!e;
  const campos = [
    campoSelect({
      id: 'f-pacienteId', label: 'Paciente', valor: e ? e.pacienteId : '',
      opcoes: estado.pacientes.map((p) => ({ valor: p.id, texto: p.avatarEmoji + ' ' + p.nome })),
      obrigatorio: true, vazio: 'Escolha o paciente',
    }),
    campoSelect({
      id: 'f-tipo', label: 'Tipo', valor: e ? e.tipo : 'consulta', vazio: null, obrigatorio: true,
      opcoes: Object.entries(TIPOS_EVENTO)
        .filter(([k]) => k !== 'internacao')
        .map(([k, v]) => ({ valor: k, texto: v.icone + ' ' + v.nome })),
    }),
    campoTexto({ id: 'f-titulo', label: 'Título', valor: e ? e.titulo : '', placeholder: 'Ex.: Consulta cardiologia — Dr. Almeida', obrigatorio: true }),
    campoTexto({ id: 'f-inicio', label: 'Data e hora', valor: paraInputLocal(e ? e.inicio : Date.now() + 86400000), tipo: 'datetime-local', obrigatorio: true }),
    campoTexto({ id: 'f-local', label: 'Local', valor: e ? e.local || '' : '', placeholder: 'Hospital, clínica, endereço' }),
    campoTexto({ id: 'f-profissional', label: 'Profissional', valor: e ? e.profissional || '' : '', placeholder: 'Nome do médico ou terapeuta' }),
    campoTexto({ id: 'f-transporte', label: 'Transporte / quem leva', valor: e ? e.transporte || '' : '', placeholder: 'Ex.: Ambulância, carro da Ana' }),
    campoSelect({
      id: 'f-status', label: 'Situação', valor: e ? e.status : 'agendado', vazio: null,
      opcoes: Object.entries(STATUS).map(([k, v]) => ({ valor: k, texto: v.nome })),
    }),
    '<label class="check"><input type="checkbox" data-campo="precisaAcompanhante"' + (e && e.precisaAcompanhante ? ' checked' : '') + '>'
      + '<span><b>Precisa de acompanhante</b><div class="field-hint" style="margin-top:3px">Marque quando não pode ir sozinho(a) — aparece em destaque na agenda.</div></span></label>',
    campoArea({ id: 'f-observacoes', label: 'Observações', valor: e ? e.observacoes || '' : '', placeholder: 'O que levar, preparo, jejum, documentos…', linhas: 3 }),
  ].join('');

  const r = await modal({
    titulo: editando ? 'Editar compromisso' : 'Novo compromisso',
    corpo: '<div class="stack">' + campos + '</div>',
    acoes: [
      { texto: 'Cancelar', valor: null, tipo: 'ghost' },
      { texto: editando ? 'Salvar' : 'Agendar', valor: 'FORM', tipo: 'primary' },
    ],
  });

  if (!r || !r.dados) return;
  const d = r.dados;
  if (!d.pacienteId) return toast('Escolha o paciente.', 'warn');
  if (!d.titulo) return toast('Dê um título ao compromisso.', 'warn');
  if (!d.inicio) return toast('Informe data e hora.', 'warn');

  if (editando) {
    atualizar('eventos', e.id, d);
    auditar('evento-editado', d.titulo, d.pacienteId);
    toast('Compromisso atualizado.', 'ok');
  } else {
    inserir('eventos', { id: novoId('evt'), ...d });
    auditar('evento-criado', d.titulo, d.pacienteId);
    toast('Compromisso agendado.', 'ok');
  }
  render(document.getElementById('view'));
}

async function marcarRealizado(e) {
  const r = await modal({
    titulo: 'Marcar como realizado',
    corpo: '<p class="item-text">Isso atualiza a agenda para todos da família.</p>'
      + campoArea({ id: 'f-resultado', label: 'O que ficou combinado / resultado', valor: e.resultado || '', placeholder: 'Orientações recebidas, próxima data, exames pedidos…', linhas: 4 }),
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Confirmar', valor: 'FORM', tipo: 'ok' }],
  });
  if (!r) return;
  atualizar('eventos', e.id, { status: 'realizado', resultado: r.dados.resultado || '', realizadoEm: Date.now() });
  auditar('evento-realizado', e.titulo, e.pacienteId);
  toast('Registrado como realizado.', 'ok');
  render(document.getElementById('view'));
}

async function anotarResultado(e) {
  const r = await modal({
    titulo: 'Anotação do atendimento',
    corpo: '<div class="stack">'
      + '<p class="muted small">' + esc((e.titulo || '') + ' · ' + fmtData(e.inicio)) + '</p>'
      + campoArea({ id: 'f-resultado', label: 'Anotações', valor: e.resultado || '', placeholder: 'O que o médico disse, o que foi pedido, próxima consulta…', linhas: 7 })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r) return;
  atualizar('eventos', e.id, { resultado: r.dados.resultado || '' });
  auditar('evento-anotado', e.titulo, e.pacienteId);
  toast('Anotação salva.', 'ok');
  render(document.getElementById('view'));
}

async function excluir(e) {
  if (!await confirmar('Excluir compromisso?', 'O compromisso "' + (e.titulo || '') + '" será removido para todos os aparelhos da família.', 'Excluir')) return;
  remover('eventos', e.id);
  auditar('evento-excluido', e.titulo, e.pacienteId);
  toast('Compromisso excluído.');
  render(document.getElementById('view'));
}
