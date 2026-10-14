/* ============================================================================
 * Tela · Exames  (assets/js/views/exames.js)
 * ----------------------------------------------------------------------------
 * O acervo de exames dos dois pacientes, com busca, filtros e — o ponto
 * central — o VALOR em destaque com a faixa de referência. É isso que o médico
 * precisa ver em 30 segundos de consulta.
 * ==========================================================================*/

'use strict';

import { estado, inserir, atualizar, remover, auditar, novoId, porId, sessao } from '../store.js';
import { pode } from '../auth.js';
import {
  esc, $, debounce, modal, confirmar, toast, vazio, fmtData, fmtDataHora, relativo,
  paciente, gravidade, campoTexto, campoSelect, campoArea, irPara,
} from '../ui.js';

const CATEGORIAS = {
  laboratorial: { nome: 'Laboratorial', icone: '🧪', pill: 'brand' },
  imagem:       { nome: 'Imagem',       icone: '🖼',  pill: 'info' },
  outro:        { nome: 'Outro',        icone: '📋', pill: '' },
};

let busca = '';
let fPac = '';
let fCat = '';
let fAno = '';

export function render(host, params) {
  if (params && params.paciente) fPac = params.paciente;

  host.innerHTML = '<div class="wrap stack">'
    + '<div class="row-between">'
    +   '<div><h1>Exames</h1><p class="muted small">Resultados e laudos dos dois</p></div>'
    +   (pode('escrever') ? '<button class="btn btn-primary" data-acao="novo">＋ Exame</button>' : '')
    + '</div>'
    + filtros()
    + '<div id="res"></div>'
    + '</div>';

  pintar(host);

  const campo = $('#q', host);
  if (campo) {
    campo.value = busca;
    campo.addEventListener('input', debounce(() => { busca = campo.value; pintar(host); }, 200));
  }
  $('#f-pac', host).addEventListener('change', (e) => { fPac = e.target.value; pintar(host); });
  $('#f-cat', host).addEventListener('change', (e) => { fCat = e.target.value; pintar(host); });
  $('#f-ano', host).addEventListener('change', (e) => { fAno = e.target.value; pintar(host); });

  host.addEventListener('click', (ev) => {
    const ac = ev.target.closest('[data-acao]');
    if (!ac) return;
    const a = ac.dataset.acao;
    if (a === 'novo') formExame(null);
    else if (a === 'editar') formExame(porId('exames', ac.dataset.id));
    else if (a === 'excluir') excluir(ac.dataset.id, host);
    else if (a === 'ver-doc') verDoc(ac.dataset.doc);
  });
}

function filtros() {
  const anos = [...new Set(estado.exames
    .map((e) => (e.data || '').slice(0, 4))
    .filter((a) => /^\d{4}$/.test(a)))].sort().reverse();

  return '<div class="card card-pad stack" style="padding:14px;gap:10px">'
    + '<input class="input input-search" id="q" type="search" placeholder="Buscar por exame, analito, unidade, conclusão…" autocomplete="off">'
    + '<div class="grid grid-3" style="gap:10px">'
    +   '<select class="select" id="f-pac"><option value="">Todos os pacientes</option>'
    +     estado.pacientes.map((p) => '<option value="' + esc(p.id) + '"' + (fPac === p.id ? ' selected' : '') + '>'
          + p.avatarEmoji + ' ' + esc(p.nome) + '</option>').join('') + '</select>'
    +   '<select class="select" id="f-cat"><option value="">Todas as categorias</option>'
    +     Object.entries(CATEGORIAS).map(([k, c]) => '<option value="' + k + '"' + (fCat === k ? ' selected' : '') + '>'
          + c.icone + ' ' + c.nome + '</option>').join('') + '</select>'
    +   '<select class="select" id="f-ano"><option value="">Todos os anos</option>'
    +     anos.map((a) => '<option value="' + a + '"' + (fAno === a ? ' selected' : '') + '>' + a + '</option>').join('') + '</select>'
    + '</div>'
    + '</div>';
}

function filtrar() {
  const q = busca.trim().toLowerCase();
  return estado.exames.filter((e) => {
    if (fPac && e.pacienteId !== fPac) return false;
    if (fCat && e.categoria !== fCat) return false;
    if (fAno && (e.data || '').slice(0, 4) !== fAno) return false;
    if (q) {
      const amostra = [e.titulo, e.especialidade, e.unidade, e.conclusao,
        ...(e.valores || []).map((v) => v.nome + ' ' + v.valor)]
        .filter(Boolean).join(' ').toLowerCase();
      if (!amostra.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
}

function pintar(host) {
  const lista = filtrar();
  const res = $('#res', host);

  const comAlerta = lista.filter((e) => (e.valores || []).some((v) => {
    const n = parseFloat(String(v.valor).replace(',', '.'));
    return v.max != null && !isNaN(n) && n > v.max;
  }));

  res.innerHTML = '<div class="stack">'
    + '<div class="row-between"><span class="small muted">'
    +   '<b style="color:var(--brand)">' + lista.length + '</b> exame(s) no filtro atual</span>'
    +   (comAlerta.length ? '<span class="pill danger">⚠️ ' + comAlerta.length + ' com valor acima da faixa</span>' : '')
    + '</div>'
    + (lista.length ? lista.map(cartaoExame).join('')
      : vazio('🔬', 'Nenhum exame encontrado',
        'Ajuste os filtros ou registre um novo exame. Você pode anexar o PDF do laudo junto do resultado.',
        pode('escrever') ? '<button class="btn btn-primary" data-acao="novo">＋ Registrar exame</button>' : ''))
    + '</div>';
}

function cartaoExame(e) {
  const p = paciente(e.pacienteId);
  const cat = CATEGORIAS[e.categoria] || CATEGORIAS.outro;
  const alertas = (e.valores || []).filter((v) => {
    const n = parseFloat(String(v.valor).replace(',', '.'));
    return (v.max != null && !isNaN(n) && n > v.max) || (v.min != null && !isNaN(n) && n < v.min);
  });

  return '<div class="card">'
    + '<div class="card-head" style="background:var(--surface);align-items:flex-start">'
    +   '<div class="grow">'
    +     '<div class="row" style="gap:8px"><span class="item-title">' + cat.icone + ' ' + esc(e.titulo) + '</span></div>'
    +     '<div class="item-meta" style="margin-top:6px">'
    +       '<span class="pill" style="color:' + p.cor + ';border-color:' + p.cor + '">' + p.avatarEmoji + ' ' + esc(p.nome.split(' ')[0]) + '</span>'
    +       (e.data ? '<span>📅 ' + esc(fmtData(e.data)) + '</span>' : '')
    +       (e.unidade ? '<span>🏥 ' + esc(e.unidade) + '</span>' : '')
    +       (e.especialidade ? '<span>👤 ' + esc(e.especialidade) + '</span>' : '')
    +     '</div>'
    +   '</div>'
    +   '<span class="pill ' + cat.pill + '">' + esc(cat.nome) + '</span>'
    + '</div>'

    + (e.valores && e.valores.length
      ? '<div class="table-wrap"><table class="table">'
        + '<thead><tr><th>Analito</th><th>Resultado</th><th>Referência</th></tr></thead><tbody>'
        + e.valores.map((v) => {
          const n = parseFloat(String(v.valor).replace(',', '.'));
          const g = gravidade(n, v.min, v.max);
          const cor = g === 'danger' ? 'color:var(--danger)' : g === 'warn' ? 'color:var(--warn)' : '';
          return '<tr><td>' + esc(v.nome) + '</td>'
            + '<td class="mono" style="font-weight:700;' + cor + '">' + esc(v.valor) + ' '
            + '<span class="muted" style="font-weight:400">' + esc(v.unidade || '') + '</span>'
            + (g === 'danger' ? ' ⚠️' : '') + '</td>'
            + '<td class="small muted">' + esc(v.referencia || '—') + '</td></tr>';
        }).join('')
        + '</tbody></table></div>'
      : '')

    + (e.conclusao
      ? '<div class="card-body" style="padding-top:14px"><div class="note ' + (alertas.length ? 'warn' : 'info') + '" style="margin:0">'
        + '<div class="note-title">Conclusão do laudo</div>' + esc(e.conclusao) + '</div></div>'
      : '')

    + (alertas.length
      ? '<div class="card-body" style="padding-top:0"><div class="note danger" style="margin:0"><div class="note-title">⚠️ '
        + alertas.length + ' valor(es) fora da faixa</div>'
        + esc(alertas.map((v) => v.nome + ': ' + v.valor + ' ' + (v.unidade || '')).join(' · '))
        + '<br><span class="tiny">Leve ao conhecimento do médico assistente. Não altere medicação por conta própria.</span></div></div>'
      : '')

    + '<div class="card-foot row-wrap">'
    +   (e.documentoId ? '<button class="btn btn-sm btn-soft" data-acao="ver-doc" data-doc="' + esc(e.documentoId) + '">📄 Abrir laudo</button>' : '')
    +   (pode('escrever') ? '<button class="btn btn-sm btn-ghost" data-acao="editar" data-id="' + esc(e.id) + '">✏️ Editar</button>' : '')
    +   (pode('excluir') ? '<button class="btn btn-sm btn-danger-soft" data-acao="excluir" data-id="' + esc(e.id) + '">🗑 Excluir</button>' : '')
    +   '<span class="grow"></span>'
    +   '<span class="tiny muted">registrado ' + esc(relativo(e.criadoEm)) + (e.criadoPorNome ? ' por ' + esc(e.criadoPorNome) : '') + '</span>'
    + '</div>'
    + '</div>';
}

/* ------------------------------------------------------------------- ações */

async function formExame(e) {
  const editando = !!e;
  const inicial = (e && e.valores) ? e.valores.map((v) =>
    v.nome + ': ' + v.valor + (v.unidade ? ' ' + v.unidade : '') + (v.referencia ? ' (ref ' + v.referencia + ')' : '')).join('\n') : '';

  const r = await modal({
    titulo: editando ? 'Editar exame' : 'Registrar exame',
    corpo: '<div class="stack">'
      + campoSelect({ id: 'f-pacienteId', label: 'Paciente', valor: e ? e.pacienteId : (fPac || ''), vazio: 'Escolha', obrigatorio: true,
          opcoes: estado.pacientes.map((p) => ({ valor: p.id, texto: p.avatarEmoji + ' ' + p.nome })) })
      + campoTexto({ id: 'f-titulo', label: 'Nome do exame', valor: e ? e.titulo : '', obrigatorio: true,
          placeholder: 'Ex.: Hemograma completo · Creatinina · Ressonância de crânio' })
      + '<div class="grid grid-2" style="gap:12px">'
      + campoSelect({ id: 'f-categoria', label: 'Categoria', valor: e ? e.categoria : 'laboratorial', vazio: null,
          opcoes: Object.entries(CATEGORIAS).map(([k, c]) => ({ valor: k, texto: c.icone + ' ' + c.nome })) })
      + campoTexto({ id: 'f-data', label: 'Data', valor: e ? e.data || '' : new Date().toISOString().slice(0, 10), tipo: 'date', obrigatorio: true })
      + '</div>'
      + '<div class="grid grid-2" style="gap:12px">'
      + campoTexto({ id: 'f-unidade', label: 'Laboratório / clínica', valor: e ? e.unidade || '' : '' })
      + campoTexto({ id: 'f-especialidade', label: 'Solicitado por', valor: e ? e.especialidade || '' : '' })
      + '</div>'
      + campoArea({ id: 'f-valores', label: 'Resultados (um por linha)', valor: inicial, linhas: 6,
          placeholder: 'Hemoglobina: 11.2 g/dL (ref 12-16)\nCreatinina: 1.9 mg/dL (ref 0.6-1.2)',
          dica: 'Formato: Nome: valor unidade (ref mínimo-máximo). Os valores fora da faixa são sinalizados automaticamente.' })
      + campoArea({ id: 'f-conclusao', label: 'Conclusão do laudo', valor: e ? e.conclusao || '' : '', linhas: 4,
          placeholder: 'Resumo do que o laudo diz, em palavras simples.' })
      + (editando ? '' : '<div class="note info"><div class="note-title">💡 Dica</div>'
          + 'Depois de salvar, vá em <b>Documentos</b> e anexe o PDF do laudo. Assim fica tudo junto.</div>')
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;
  if (!d.pacienteId || !d.titulo) return toast('Escolha o paciente e o nome do exame.', 'warn');

  d.valores = parsear(d.valores);
  const dados = { ...d, criadoPorNome: sessao.membro.nome };

  if (editando) {
    atualizar('exames', e.id, dados);
    auditar('exame-editado', d.titulo, d.pacienteId);
    toast('Exame atualizado.', 'ok');
  } else {
    inserir('exames', { id: novoId('ex'), ...dados });
    auditar('exame-criado', d.titulo, d.pacienteId);
    toast('Exame registrado.', 'ok');
  }
  const host = document.getElementById('view');
  if (host) render(host);
}

function parsear(txt) {
  return String(txt || '').split('\n').map((l) => l.trim()).filter(Boolean).map((linha) => {
    const m = linha.match(/^(.+?):\s*([\d.,]+)\s*([^\s(]*)?\s*(?:\(ref\s*([^)]*)\))?/);
    if (!m) return { nome: linha, valor: '', unidade: '', referencia: '' };
    const ref = m[4] || '';
    const faixa = ref.match(/([\d.,]+)\s*[-–a]\s*([\d.,]+)/);
    return {
      nome: m[1].trim(), valor: m[2].replace(',', '.'), unidade: (m[3] || '').trim(), referencia: ref,
      min: faixa ? parseFloat(faixa[1].replace(',', '.')) : null,
      max: faixa ? parseFloat(faixa[2].replace(',', '.')) : null,
    };
  });
}

async function excluir(id, host) {
  const e = porId('exames', id);
  if (!e) return;
  if (!await confirmar('Excluir exame?', '"' + e.titulo + '" (' + fmtData(e.data) + ') será removido do prontuário.', 'Excluir')) return;
  remover('exames', id);
  auditar('exame-excluido', e.titulo, e.pacienteId);
  toast('Exame excluído.');
  render(host);
}

async function verDoc(arquivoId) {
  try {
    const { abrirDocumento } = await import('../store.js');
    await abrirDocumento(arquivoId, 'application/pdf');
  } catch (err) { toast(err.message, 'danger'); }
}
