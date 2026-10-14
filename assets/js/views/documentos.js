/* ============================================================================
 * Tela · Documentos  (assets/js/views/documentos.js)
 * ----------------------------------------------------------------------------
 * O cofre de arquivos: laudos em PDF, receitas, pedidos de exame, relatórios,
 * fotos de receita. O arquivo em si é gravado CIFRADO no IndexedDB, com chave
 * própria derivada da chave-mestra do cofre — nem outro app do celular lê.
 *
 * Aqui também entra a importação dos resultados da Rede D'Or: o paciente baixa
 * o laudo no portal/app oficial (com o login e a senha DELE) e traz o arquivo
 * para cá. Assim a família reúne tudo sem que ninguém guarde a senha do banco.
 * ==========================================================================*/

'use strict';

import {
  estado, inserir, atualizar, remover, auditar, novoId, porId,
  guardarArquivo, lerArquivo, abrirDocumento, baixarDocumento, apagarArquivo, sessao,
} from '../store.js';
import { pode } from '../auth.js';
import {
  esc, $, debounce, modal, confirmar, toast, vazio, fmtData, relativo,
  paciente, campoTexto, campoSelect, campoArea, irPara,
} from '../ui.js';

const CATEGORIAS = [
  'Laudo de exame', 'Resultado laboratorial', 'Imagem / radiologia', 'Receita médica',
  'Pedido de exame', 'Relatório médico', 'Alta hospitalar', 'Internação',
  'Relatório de enfermagem', 'Carteira / documento', 'Autorização de convênio', 'Outro',
];

const MIMES = 'application/pdf,image/*,.doc,.docx';
const LIMITE_MB = 25;

let busca = '';
let fPac = '';
let fCat = '';

export function render(host, params) {
  if (params && params.paciente) fPac = params.paciente;

  host.innerHTML = '<div class="wrap stack">'
    + '<div class="row-between">'
    +   '<div><h1>Documentos</h1><p class="muted small">Tudo reunido num lugar, cifrado</p></div>'
    +   (pode('escrever') ? '<button class="btn btn-primary" data-acao="enviar">＋ Enviar</button>' : '')
    + '</div>'

    + '<div class="note info"><div class="note-title">🔐 Como funciona a proteção</div>'
    + 'Cada arquivo é cifrado <b>antes</b> de ser gravado, com uma chave derivada da chave do cofre. '
    + 'Se o celular for perdido, ninguém lê os laudos sem o PIN de um dos membros.</div>'

    + filtros()
    + '<div id="lista"></div>'
    + '</div>';

  pintar(host);

  const q = $('#q', host);
  if (q) { q.value = busca; q.addEventListener('input', debounce(() => { busca = q.value; pintar(host); }, 200)); }
  $('#f-pac', host).addEventListener('change', (e) => { fPac = e.target.value; pintar(host); });
  $('#f-cat', host).addEventListener('change', (e) => { fCat = e.target.value; pintar(host); });

  host.addEventListener('click', async (ev) => {
    const ac = ev.target.closest('[data-acao]');
    if (!ac) return;
    const a = ac.dataset.acao, id = ac.dataset.id;

    if (a === 'enviar') abrirEnvio();
    else if (a === 'baixar') baixar(id);
    else if (a === 'abrir') abrir(id);
    else if (a === 'editar') formDocumento(porId('documentos', id));
    else if (a === 'excluir') excluir(id, host);
    else if (a === 'importar-dor') irPara('dor');
  });
}

function filtros() {
  return '<div class="card card-pad stack" style="padding:14px;gap:10px">'
    + '<input class="input input-search" id="q" type="search" placeholder="Buscar por título, descrição, unidade…" autocomplete="off">'
    + '<div class="grid grid-2" style="gap:10px">'
    +   '<select class="select" id="f-pac"><option value="">Todos os pacientes</option>'
    +     estado.pacientes.map((p) => '<option value="' + esc(p.id) + '"' + (fPac === p.id ? ' selected' : '') + '>'
          + p.avatarEmoji + ' ' + esc(p.nome) + '</option>').join('') + '</select>'
    +   '<select class="select" id="f-cat"><option value="">Todas as categorias</option>'
    +     CATEGORIAS.map((c) => '<option' + (fCat === c ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>'
    + '</div></div>';
}

function filtrar() {
  const q = busca.trim().toLowerCase();
  return estado.documentos.filter((d) => {
    if (fPac && d.pacienteId !== fPac) return false;
    if (fCat && d.categoria !== fCat) return false;
    if (q) {
      const t = [d.titulo, d.descricao, d.categoria, d.unidade, d.origem].filter(Boolean).join(' ').toLowerCase();
      if (!t.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (b.data || '').localeCompare(String(a.data || '')) || (b.criadoEm - a.criadoEm));
}

function pintar(host) {
  const lista = filtrar();
  const box = $('#lista', host);

  // agrupa por categoria para facilitar achar
  const grupos = new Map();
  for (const d of lista) {
    const k = d.categoria || 'Outro';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(d);
  }

  if (!lista.length) {
    box.innerHTML = vazio('📄', 'Nenhum documento aqui',
      'Envie laudos, receitas e relatórios. Ficam disponíveis para toda a família, em qualquer aparelho sincronizado.',
      pode('escrever') ? '<button class="btn btn-primary" data-acao="enviar">＋ Enviar documento</button>' : '');
    return;
  }

  box.innerHTML = '<div class="stack">'
    + '<div class="small muted"><b style="color:var(--brand)">' + lista.length + '</b> documento(s) no filtro atual</div>'
    + [...grupos.entries()].sort((a, b) => b[1].length - a[1].length).map(([cat, itens]) =>
        '<div class="stack" style="gap:8px">'
        + '<div class="section-title">' + esc(cat) + ' · ' + itens.length + '</div>'
        + itens.map(cartaoDocumento).join('')
        + '</div>').join('')
    + '</div>';
}

function cartaoDocumento(d) {
  const p = paciente(d.pacienteId);
  const ext = (d.nomeArquivo || '').split('.').pop().toUpperCase();
  const ehImg = (d.mime || '').startsWith('image/');
  return '<div class="item">'
    + '<div style="width:40px;height:40px;border-radius:10px;background:var(--surface-3);display:grid;place-items:center;flex-shrink:0;font-size:.66rem;font-weight:800;color:var(--ink-3)">'
    +   esc(ehImg ? 'IMG' : ext) + '</div>'
    + '<div class="item-main">'
    +   '<div class="item-title" style="font-size:.9rem">' + esc(d.titulo) + '</div>'
    +   '<div class="item-meta">'
    +     '<span class="pill" style="color:' + p.cor + ';border-color:' + p.cor + '">' + p.avatarEmoji + ' ' + esc(p.nome.split(' ')[0]) + '</span>'
    +     (d.data ? '<span>📅 ' + esc(fmtData(d.data)) + '</span>' : '')
    +     (d.unidade ? '<span>🏥 ' + esc(d.unidade) + '</span>' : '')
    +     (d.origem === 'Rede D\'Or' ? '<span class="pill info">🏥 Rede D\'Or</span>' : '')
    +   '</div>'
    +   (d.descricao ? '<div class="item-text">' + esc(d.descricao) + '</div>' : '')
    +   '<div class="item-actions">'
    +     '<button class="btn btn-sm btn-soft" data-acao="abrir" data-id="' + esc(d.id) + '">📄 Abrir</button>'
    +     '<button class="btn btn-sm btn-ghost" data-acao="baixar" data-id="' + esc(d.id) + '">⬇ Baixar</button>'
    +     (pode('escrever') ? '<button class="btn btn-sm btn-ghost" data-acao="editar" data-id="' + esc(d.id) + '">✏️</button>' : '')
    +     (pode('excluir') ? '<button class="btn btn-sm btn-danger-soft" data-acao="excluir" data-id="' + esc(d.id) + '">🗑</button>' : '')
    +   '</div>'
    +   '<span class="tiny muted">enviado ' + esc(relativo(d.criadoEm)) + (d.criadoPorNome ? ' por ' + esc(d.criadoPorNome) : '')
    +     (d.tamanho ? ' · ' + (d.tamanho / 1024 / 1024).toFixed(1) + ' MB' : '') + '</span>'
    + '</div></div>';
}

/* -------------------------------------------------------------- envio/edição */

/**
 * Fluxo de envio em duas etapas: primeiro metadados, depois o arquivo.
 * Deixar o arquivo por último evita gravar um PDF órfão se a pessoa desistir.
 */
async function abrirEnvio() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = MIMES;
  input.multiple = false;

  input.addEventListener('change', async () => {
    const arq = input.files && input.files[0];
    if (!arq) return;

    if (arq.size > LIMITE_MB * 1024 * 1024) {
      return toast('Arquivo muito grande (' + (arq.size / 1024 / 1024).toFixed(0) + ' MB). O limite é '
        + LIMITE_MB + ' MB — comprima o PDF antes de enviar.', 'danger', 6000);
    }

    const r = await modal({
      titulo: 'Enviar documento',
      corpo: '<div class="stack">'
        + '<div class="note"><div class="note-title">Arquivo selecionado</div>'
        + esc(arq.name) + ' · ' + (arq.size / 1024).toFixed(0) + ' KB</div>'
        + campoSelect({ id: 'f-pacienteId', label: 'De quem é este documento', vazio: 'Escolha', obrigatorio: true,
            valor: fPac || '', opcoes: estado.pacientes.map((p) => ({ valor: p.id, texto: p.avatarEmoji + ' ' + p.nome })) })
        + campoTexto({ id: 'f-titulo', label: 'Título', valor: arq.name.replace(/\.[^.]+$/, ''),
            obrigatorio: true, placeholder: 'Ex.: Ressonância de crânio — 12/03' })
        + '<div class="grid grid-2" style="gap:12px">'
        + campoSelect({ id: 'f-categoria', label: 'Categoria', valor: 'Laudo de exame', vazio: null,
            opcoes: CATEGORIAS })
        + campoTexto({ id: 'f-data', label: 'Data do documento', valor: new Date().toISOString().slice(0, 10), tipo: 'date' })
        + '</div>'
        + '<div class="grid grid-2" style="gap:12px">'
        + campoTexto({ id: 'f-unidade', label: 'Unidade / hospital', placeholder: 'Ex.: Hospital São Luiz' })
        + campoTexto({ id: 'f-origem', label: 'Origem', placeholder: 'Ex.: Rede D\'Or, SUS, particular' })
        + '</div>'
        + campoArea({ id: 'f-descricao', label: 'Descrição / o que importa aqui', linhas: 3,
            placeholder: 'Ex.: mostra redução do fluxo na carótida direita; levar na consulta de setembro.' })
        + '</div>',
      acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar e cifrar', valor: 'FORM', tipo: 'primary' }],
    });

    if (!r || !r.dados) return;
    const d = r.dados;
    if (!d.pacienteId || !d.titulo) return toast('Informe de quem é o documento e um título.', 'warn');

    const arquivoId = novoId('arq');
    const btn = document.querySelector('.modal-foot .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Cifrando…'; }

    try {
      await guardarArquivo(arquivoId, arq);
    } catch (e) {
      return toast('Falha ao cifrar o arquivo: ' + e.message, 'danger', 6000);
    }

    inserir('documentos', {
      id: novoId('doc'), ...d, arquivoId, nomeArquivo: arq.name,
      mime: arq.type || 'application/octet-stream', tamanho: arq.size,
      criadoPorNome: sessao.membro.nome,
    });
    auditar('documento-enviado', d.titulo + ' (' + arq.name + ')', d.pacienteId);
    toast('Documento cifrado e guardado no cofre.', 'ok');
    const host = document.getElementById('view');
    if (host) render(host);
  });

  input.click();
}

async function formDocumento(d) {
  const r = await modal({
    titulo: 'Editar documento',
    corpo: '<div class="stack">'
      + campoTexto({ id: 'f-titulo', label: 'Título', valor: d.titulo, obrigatorio: true })
      + '<div class="grid grid-2" style="gap:12px">'
      + campoSelect({ id: 'f-categoria', label: 'Categoria', valor: d.categoria, vazio: null, opcoes: CATEGORIAS })
      + campoTexto({ id: 'f-data', label: 'Data', valor: d.data || '', tipo: 'date' })
      + '</div>'
      + '<div class="grid grid-2" style="gap:12px">'
      + campoTexto({ id: 'f-unidade', label: 'Unidade', valor: d.unidade || '' })
      + campoTexto({ id: 'f-origem', label: 'Origem', valor: d.origem || '' })
      + '</div>'
      + campoArea({ id: 'f-descricao', label: 'Descrição', valor: d.descricao || '', linhas: 3 })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  atualizar('documentos', d.id, r.dados);
  auditar('documento-editado', r.dados.titulo, d.pacienteId);
  toast('Documento atualizado.', 'ok');
  const host = document.getElementById('view');
  if (host) render(host);
}

/* ------------------------------------------------------------------- ações */

async function abrir(id) {
  const d = porId('documentos', id);
  if (!d) return;
  try { await abrirDocumento(d.arquivoId, d.mime); }
  catch (e) { toast(e.message, 'danger'); }
}

async function baixar(id) {
  const d = porId('documentos', id);
  if (!d) return;
  try { await baixarDocumento(d.arquivoId, d.nomeArquivo || d.titulo, d.mime); }
  catch (e) { toast(e.message, 'danger'); }
}

async function excluir(id, host) {
  const d = porId('documentos', id);
  if (!d) return;
  if (!await confirmar('Excluir documento?',
    '"' + d.titulo + '" será removido do cofre em todos os aparelhos sincronizados. Não é possível desfazer.', 'Excluir')) return;
  try { await apagarArquivo(d.arquivoId); } catch { /* segue: o metadado importa mais */ }
  remover('documentos', id);
  auditar('documento-excluido', d.titulo, d.pacienteId);
  toast('Documento excluído.');
  render(host);
}

/* ------------------------------------------------- verificação de integridade */

/** Confere se todos os metadados têm o arquivo cifrado correspondente neste aparelho. */
export async function diagnosticar() {
  const faltando = [];
  for (const d of estado.documentos) {
    const achou = await lerArquivo(d.arquivoId);
    if (!achou) faltando.push(d.titulo);
  }
  return faltando;
}
