/* ============================================================================
 * Tela · Modo Consulta  (assets/js/views/consulta.js)
 * ----------------------------------------------------------------------------
 * Esta tela existe para UM momento: o app aberto na frente do médico.
 *
 * Como ela foi pensada:
 *   · O médico escolhe (ou a família já escolheu) a ESPECIALIDADE dele.
 *   · A tela mostra, em primeiro lugar, os exames que cabem àquela
 *     especialidade — imagem, laboratoriais e demais.
 *   · NADA fica escondido: abaixo sempre existe o bloco "também no prontuário",
 *     com os exames das outras áreas, e a aba "Tudo" mostra o acervo completo.
 *   · No topo, o resumo de 30 segundos: condições, alergias, medicações em uso
 *     e os valores fora da faixa.
 *   · O botão de imprimir gera a via em papel para anexar ao prontuário.
 *
 * Regra de ouro: aqui NÃO se opina. Só se apresenta o que está registrado.
 * ==========================================================================*/

'use strict';

import { estado, sessao } from '../store.js';
import {
  esc, $, toast, vazio, fmtData, relativo, paciente, pillsCondicoes, gravidade,
} from '../ui.js';

/* ---------------------------------------------------------------- constantes */

const CATEGORIAS = {
  imagem:       { nome: 'Imagem',       icone: '🖼',  ordem: 1 },
  laboratorial: { nome: 'Laboratorial', icone: '🧪', ordem: 2 },
  outro:        { nome: 'Outros exames', icone: '📋', ordem: 3 },
};

/** Especialidades conhecidas: ícone + palavras que denunciam a área no título. */
const AREAS = [
  { nome: 'Neurologia',       icone: '🧠', chaves: ['crânio', 'cranio', 'cerebral', 'encefalo', 'encéfalo', 'neurolog', 'eletroencefal', 'neuropsicol', 'meem', 'carótida', 'carotida', 'doppler de carótidas', 'cognitiv', 'alzheimer'] },
  { nome: 'Cardiologia',      icone: '❤️', chaves: ['ecocardiograma', 'eletrocardiograma', 'ecg', 'holter', 'cardio', 'mapa', 'troponina', 'bnp', 'fração de ejeção'] },
  { nome: 'Pneumologia',      icone: '🫁', chaves: ['tórax', 'torax', 'pulmonar', 'espirometria', 'pneumo', 'broncoscop', 'satura'] },
  { nome: 'Gastroenterologia', icone: '🩺', chaves: ['abdome', 'abdominal', 'endoscopia', 'colonoscopia', 'hepát', 'hepat', 'gastro', 'colon', 'vesícula', 'vesicula', 'bilirrub'] },
  { nome: 'Ortopedia',        icone: '🦴', chaves: ['coluna', 'lombar', 'cervical', 'joelho', 'ombro', 'quadril', 'ortoped', 'densitometria', 'óssea', 'ossea', 'fratura'] },
  { nome: 'Nefrologia',       icone: '💧', chaves: ['creatinina', 'ureia', 'urina', 'renal', 'rins', 'nefro', 'proteinúria', 'proteinuria', 'eletrólitos', 'eletrolitos'] },
  { nome: 'Endocrinologia',   icone: '⚖️', chaves: ['glicemia', 'glicada', 'hba1c', 'tsh', 'tireoid', 'hormôn', 'hormon', 'cortisol', 'insulina', 'perfil lipídico', 'colesterol', 'triglicér', 'triglicer', 'vitamina d', 'cálcio', 'calcio'] },
  { nome: 'Hematologia',      icone: '🩸', chaves: ['hemograma', 'hematócrit', 'hematocrit', 'hemoglobina', 'plaqueta', 'ferritina', 'coagulograma', 'inr', 'leucócitos', 'leucocitos'] },
  { nome: 'Oftalmologia',     icone: '👁',  chaves: ['oftalm', 'fundo de olho', 'retina', 'acuidade', 'tonometria'] },
  { nome: 'Otorrinolaringologia', icone: '👂', chaves: ['audiometria', 'otorrino', 'laring', 'nasal', 'seios da face'] },
  { nome: 'Psiquiatria',      icone: '🧩', chaves: ['psiquiatr', 'ansiedade', 'depress', 'lítio', 'litio', 'sertralina'] },
  { nome: 'Geriatria',        icone: '🧓', chaves: ['geriát', 'geriat', 'avaliação geriátrica', 'idoso'] },
  { nome: 'Oncologia',        icone: '🎗',  chaves: ['oncol', 'tomografia por emissão', 'pet', 'biópsia', 'biopsia', 'marcador'] },
  { nome: 'Infectologia',     icone: '🦠',  chaves: ['sorolog', 'pcr', 'infecc', 'hepatite', 'hiv', 'covid', 'cultura'] },
];

const AREA_PADRAO = { nome: 'Clínica geral', icone: '🩺' };

let pacienteId = null;
let area = '';
let modo = 'area';   // 'area' = por especialidade · 'tudo' = acervo completo

/* ------------------------------------------------------------------- helpers */

/** Descobre a área de um exame: usa o campo `area`; se faltar, deduz do título. */
export function areaDoExame(e) {
  if (e.area && String(e.area).trim()) return String(e.area).trim();
  const texto = (String(e.titulo || '') + ' ' + String(e.especialidade || '') + ' ' + String(e.conclusao || '')).toLowerCase();
  for (const a of AREAS) {
    if (a.chaves.some((k) => texto.includes(k))) return a.nome;
  }
  return AREA_PADRAO.nome;
}

export function iconeDaArea(nome) {
  const a = AREAS.find((x) => x.nome === nome);
  return a ? a.icone : AREA_PADRAO.icone;
}

/* --------------------------------------------------------------------- render */

export function render(host, params) {
  if (params && params.paciente) pacienteId = params.paciente;
  if (params && params.area) { area = params.area; modo = 'area'; }
  if (!pacienteId) pacienteId = estado.pacientes[0] && estado.pacientes[0].id;

  const p = paciente(pacienteId);
  const meus = estado.exames.filter((e) => e.pacienteId === pacienteId);
  const areas = contarAreas(meus);

  host.innerHTML = '<div class="wrap stack">'

    + '<div class="row-between no-print">'
    +   '<div><h1>Modo consulta</h1>'
    +     '<p class="muted small">Os exames que cabem a cada especialidade — imagem, laboratoriais e demais.</p></div>'
    +   '<button class="btn btn-soft" data-acao="imprimir">🖨 Imprimir / salvar PDF</button>'
    + '</div>'

    + seletorPaciente()
    + resumo30s(p)

    + '<div class="card card-pad stack no-print" style="gap:12px">'
    +   '<div class="row-wrap" style="gap:8px">'
    +     botaoModo('area', '🎯 Por especialidade')
    +     botaoModo('tudo', '📚 Tudo (' + meus.length + ')')
    +   '</div>'
    +   (modo === 'area'
        ? '<div><label class="tiny muted" style="font-weight:700;display:block;margin-bottom:6px">ESPECIALIDADE</label>'
          + '<div class="row-wrap" style="gap:8px">'
          +   '<button class="btn btn-sm ' + (!area ? 'btn-primary' : 'btn-ghost') + '" data-area="">Todas as áreas</button>'
          +   areas.map((a) => '<button class="btn btn-sm ' + (area === a.nome ? 'btn-primary' : 'btn-ghost')
              + '" data-area="' + esc(a.nome) + '">' + a.icone + ' ' + esc(a.nome)
              + ' <span class="mono">' + a.total + '</span></button>').join('')
          + '</div></div>'
        : '<p class="tiny muted" style="margin:0">O acervo completo do paciente, agrupado por tipo de exame.</p>')
    + '</div>'

    + '<div id="corpo"></div>'
    + '</div>';

  pintarCorpo(host);

  host.addEventListener('click', (ev) => {
    const troca = ev.target.closest('[data-pac]');
    if (troca) { pacienteId = troca.dataset.pac; area = ''; render(host, { paciente: pacienteId }); return; }

    const m = ev.target.closest('[data-modo]');
    if (m) { modo = m.dataset.modo; render(host, { paciente: pacienteId }); return; }

    const a = ev.target.closest('[data-area]');
    if (a) { area = a.dataset.area; render(host, { paciente: pacienteId }); return; }

    const ac = ev.target.closest('[data-acao]');
    if (!ac) return;
    if (ac.dataset.acao === 'imprimir') {
      toast('Escolha "Salvar como PDF" para guardar ou imprimir para o consultório.', '', 5000);
      setTimeout(() => window.print(), 350);
    } else if (ac.dataset.acao === 'ver-doc') {
      verDoc(ac.dataset.doc);
    }
  });
}

/* ---------------------------------------------------------------- sub-telas */

function seletorPaciente() {
  return '<div class="row-wrap no-print" style="gap:8px">'
    + estado.pacientes.map((p) => {
      const on = p.id === pacienteId;
      return '<button class="btn ' + (on ? 'btn-primary' : 'btn-ghost') + '" data-pac="' + esc(p.id) + '">'
        + (p.avatarEmoji || '👤') + ' ' + esc(p.nome) + '</button>';
    }).join('')
    + '</div>';
}

function botaoModo(chave, texto) {
  return '<button class="btn btn-sm ' + (modo === chave ? 'btn-primary' : 'btn-ghost')
    + '" data-modo="' + chave + '">' + esc(texto) + '</button>';
}

function contarAreas(exames) {
  const mapa = new Map();
  for (const e of exames) {
    const nome = areaDoExame(e);
    const atual = mapa.get(nome) || { nome, icone: iconeDaArea(nome), total: 0 };
    atual.total++;
    mapa.set(nome, atual);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
}

/** O que o médico precisa saber antes de olhar qualquer laudo. */
function resumo30s(p) {
  const meds = estado.medicamentos.filter((m) => m.pacienteId === p.id && m.ativo !== false);
  const exames = estado.exames.filter((e) => e.pacienteId === p.id);
  const fora = [];
  for (const e of exames) {
    for (const v of (e.valores || [])) {
      const n = parseFloat(String(v.valor).replace(',', '.'));
      const g = gravidade(n, v.min, v.max);
      if (g === 'danger' || g === 'warn') fora.push({ exame: e.titulo, data: e.data, v, g });
    }
  }
  const ultimo = exames.map((e) => e.data).filter(Boolean).sort().reverse()[0];

  return '<div class="card" style="border-left:6px solid ' + p.cor + '">'
    + '<div class="card-body stack" style="gap:12px">'
    +   '<div class="row" style="gap:12px">'
    +     '<div class="avatar" style="background:' + p.cor + ';width:52px;height:52px;font-size:1.5rem">' + (p.avatarEmoji || '👤') + '</div>'
    +     '<div class="grow">'
    +       '<div class="strong" style="font-size:1.05rem">' + esc(p.nome) + '</div>'
    +       '<div class="tiny muted">' + esc(idade(p)) + (ultimo ? ' · último exame em ' + esc(fmtData(ultimo)) : '')
    +         ' · ' + exames.length + (exames.length === 1 ? ' exame' : ' exames') + ' no prontuário</div>'
    +     '</div>'
    +   '</div>'

    +   '<div class="grid grid-3" style="gap:12px">'
    +     blocoResumo('Condições', (p.condicoes || []).length
        ? pillsCondicoes(p.condicoes || [])
        : '<span class="tiny muted">nada registrado</span>')
    +     blocoResumo('Alergias', (p.alergias || []).length
        ? (p.alergias || []).map((a) => '<span class="pill danger">' + esc(a) + '</span>').join('')
        : '<span class="tiny muted">nada registrado</span>')
    +     blocoResumo('Medicações em uso', meds.length
        ? meds.map((m) => '<span class="pill brand">' + esc(m.nome) + (m.dose ? ' ' + esc(m.dose) : '') + '</span>').join('')
        : '<span class="tiny muted">nenhuma ativa</span>')
    +   '</div>'

    +   (fora.length
        ? '<div class="note ' + (fora.some((f) => f.g === 'danger') ? 'danger' : 'warn') + '" style="margin:0">'
          + '<div class="note-title">⚠️ Valores fora da faixa de referência (' + fora.length + ')</div>'
          + esc(fora.slice(0, 8).map((f) => f.v.nome + ' ' + f.v.valor + ' ' + (f.v.unidade || '')).join(' · '))
          + (fora.length > 8 ? ' …' : '')
          + '<br><span class="tiny">Referência do próprio laboratório. Confirme nos laudos originais.</span></div>'
        : '')

    +   '<div class="note" style="margin:0"><div class="note-title">💬 Como abrir a consulta</div>'
    +     '"Doutor(a), aqui está o resumo e os laudos dele(a) — os originais estão com a gente. '
    +     'A senha de autorização do convênio também está no app."</div>'
    + '</div></div>';
}

function blocoResumo(titulo, conteudo) {
  return '<div><div class="tiny muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px">'
    + esc(titulo) + '</div><div class="row-wrap" style="gap:5px">' + conteudo + '</div></div>';
}

function idade(p) {
  if (!p.nascimento) return '';
  const d = new Date(p.nascimento);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const anos = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  return anos + ' anos';
}

/* ------------------------------------------------------------------- corpo */

function pintarCorpo(host) {
  const corpo = $('#corpo', host);
  const todos = estado.exames.filter((e) => e.pacienteId === pacienteId);

  if (!todos.length) {
    corpo.innerHTML = vazio('🔬', 'Nenhum exame registrado para ' + paciente(pacienteId).nome,
      'Registre os exames em "Exames" (com o PDF do laudo em "Documentos"). Assim que houver exames, '
      + 'esta tela os organiza por especialidade automaticamente.');
    return;
  }

  const ordenar = (lista) => [...lista].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));

  if (modo === 'tudo') {
    const grupos = ['imagem', 'laboratorial', 'outro'].map((cat) => ({
      cat, itens: ordenar(todos.filter((e) => (e.categoria || 'outro') === cat)),
    })).filter((g) => g.itens.length);

    corpo.innerHTML = '<div class="stack">'
      + '<div class="note info"><div class="note-title">📚 Acervo completo</div>'
      +   'Todos os exames do paciente: ' + grupos.map((g) => g.itens.length + ' ' + CATEGORIAS[g.cat].nome.toLowerCase()).join(' · ')
      +   '. Nada foi filtrado.</div>'
      + grupos.map((g) => secaoCategoria(g.cat, g.itens)).join('')
      + '</div>';
    return;
  }

  const daArea = area ? todos.filter((e) => areaDoExame(e) === area) : todos;
  const outras = area ? todos.filter((e) => areaDoExame(e) !== area) : [];

  const porCat = ['imagem', 'laboratorial', 'outro'].map((cat) => ({
    cat, itens: ordenar(daArea.filter((e) => (e.categoria || 'outro') === cat)),
  })).filter((g) => g.itens.length);

  corpo.innerHTML = '<div class="stack">'

    + '<div class="note ' + (area ? 'info' : '') + '"><div class="note-title">'
    +   (area ? iconeDaArea(area) + ' ' + esc(area) : '🎯 Todas as áreas')
    +   ' — ' + daArea.length + (daArea.length === 1 ? ' exame' : ' exames') + '</div>'
    +   (area
        ? 'Estes são os exames que cabem a esta especialidade: '
          + porCat.map((g) => g.itens.length + ' de ' + CATEGORIAS[g.cat].nome.toLowerCase()).join(' · ')
          + '. Os exames de imagem estão todos aqui, inclusive os pedidos por outra área.'
        : 'Escolha a especialidade acima para o médico ver o que lhe cabe — ou navegue por todas.')
    + '</div>'

    + (porCat.length
        ? porCat.map((g) => secaoCategoria(g.cat, g.itens)).join('')
        : '<div class="card card-pad"><p class="muted small" style="margin:0">Nenhum exame classificado nesta especialidade ainda.</p></div>')

    // Garantia explícita: nada fica escondido.
    + (area && outras.length
        ? '<details class="card no-print"><summary style="cursor:pointer;padding:14px 16px;font-weight:700">'
          + '📂 Também no prontuário — outras áreas (' + outras.length + ' exames) </summary>'
          + '<div class="card-body stack" style="padding-top:0">'
          + '<p class="tiny muted" style="margin:0">Aberto para o médico não perder nada: exames de imagem, '
          + 'laboratoriais e demais registrados em outras especialidades.</p>'
          + ordenar(outras).map((e) => cartaoExame(e, { compacto: true })).join('')
          + '</div></details>'
        : '')

    + '</div>';
}

function secaoCategoria(cat, itens) {
  const c = CATEGORIAS[cat] || CATEGORIAS.outro;
  const nImagem = cat === 'imagem' ? '<span class="pill info">todos disponíveis</span>' : '';
  return '<div class="section-title">' + c.icone + ' ' + esc(c.nome) + ' · ' + itens.length + ' ' + nImagem + '</div>'
    + itens.map((e) => cartaoExame(e)).join('');
}

/* -------------------------------------------------------------- cartão exame */

function cartaoExame(e, opcoes = {}) {
  const p = paciente(e.pacienteId);
  const cat = CATEGORIAS[e.categoria] || CATEGORIAS.outro;
  const a = areaDoExame(e);
  const alertas = (e.valores || []).filter((v) => {
    const n = parseFloat(String(v.valor).replace(',', '.'));
    return (v.max != null && !isNaN(n) && n > v.max) || (v.min != null && !isNaN(n) && n < v.min);
  });

  return '<div class="card">'
    + '<div class="card-head" style="background:var(--surface);align-items:flex-start">'
    +   '<div class="grow">'
    +     '<div class="item-title">' + cat.icone + ' ' + esc(e.titulo) + '</div>'
    +     '<div class="item-meta" style="margin-top:6px">'
    +       (e.data ? '<span>📅 ' + esc(fmtData(e.data)) + '</span>' : '')
    +       '<span class="pill brand">' + iconeDaArea(a) + ' ' + esc(a) + '</span>'
    +       (e.unidade ? '<span>🏥 ' + esc(e.unidade) + '</span>' : '')
    +       (e.especialidade ? '<span>👤 solicitado por ' + esc(e.especialidade) + '</span>' : '')
    +     '</div>'
    +   '</div>'
    +   (alertas.length ? '<span class="pill danger">⚠️ ' + alertas.length + '</span>' : '')
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
            + (g === 'danger' || g === 'warn' ? ' ⚠️' : '') + '</td>'
            + '<td class="small muted">' + esc(v.referencia || '—') + '</td></tr>';
        }).join('')
        + '</tbody></table></div>'
      : '')

    + (e.conclusao
      ? '<div class="card-body" style="padding-top:14px"><div class="note ' + (alertas.length ? 'warn' : 'info') + '" style="margin:0">'
        + '<div class="note-title">Conclusão do laudo</div>' + esc(e.conclusao) + '</div></div>'
      : '')

    + (e.documentoId || !opcoes.compacto
      ? '<div class="card-foot row-wrap">'
        + (e.documentoId ? '<button class="btn btn-sm btn-soft" data-acao="ver-doc" data-doc="' + esc(e.documentoId) + '">📄 Abrir laudo</button>' : '')
        + '<span class="grow"></span>'
        + '<span class="tiny muted">registrado ' + esc(relativo(e.criadoEm || e.data)) + '</span>'
        + '</div>'
      : '')

    + '</div>';
}

/* ------------------------------------------------------------------- ações */

async function verDoc(arquivoId) {
  try {
    const { abrirDocumento } = await import('../store.js');
    await abrirDocumento(arquivoId, 'application/pdf');
  } catch (err) { toast(err.message, 'danger'); }
}
