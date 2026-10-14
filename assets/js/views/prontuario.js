/* ============================================================================
 * Tela · Prontuário  (assets/js/views/prontuario.js)
 * ----------------------------------------------------------------------------
 * A visão consolidada de UM paciente: tudo o que o médico precisa ver numa
 * consulta, numa tela só — resumo clínico, medicações, exames, sinais, docs
 * e o diário de evolução. Alterna entre os dois pacientes.
 * ==========================================================================*/

'use strict';

import {
  estado, inserir, atualizar, remover, auditar, novoId, porId,
  ultimosSinais, sessao,
} from '../store.js';
import { pode } from '../auth.js';
import {
  esc, $, modal, confirmar, toast, vazio, fmtData, fmtDataHora, relativo,
  paciente, pillsCondicoes, gravidade, tipoEvento,
  campoTexto, campoSelect, campoArea, irPara,
} from '../ui.js';

let pacienteId = null;
let aba = 'resumo';

export function render(host, params) {
  if (params && params.paciente) pacienteId = params.paciente;
  if (!pacienteId) pacienteId = estado.pacientes[0] && estado.pacientes[0].id;
  const p = paciente(pacienteId);

  host.innerHTML = '<div class="wrap stack">'
    + enquadramento(p)
    + abas(p)
    + '<div id="corpo"></div>'
    + '</div>';

  pintarCorpo(p);

  host.addEventListener('click', (ev) => {
    const troca = ev.target.closest('[data-pac]');
    if (troca) { pacienteId = troca.dataset.pac; aba = 'resumo'; render(host); return; }

    const t = ev.target.closest('[data-aba]');
    if (t) { aba = t.dataset.aba; render(host, { paciente: pacienteId }); return; }

    const ac = ev.target.closest('[data-acao]');
    if (ac) tratarAcao(ac.dataset.acao, ac, host);
  });
}

/* --------------------------------------------------------------- cabeçalho */

function enquadramento(p) {
  const meds = estado.medicamentos.filter((m) => m.pacienteId === p.id && m.ativo !== false);
  const condicoes = (p.condicoes || []);
  const alergias = (p.alergias || []);

  return '<div class="card" style="border-left:6px solid ' + p.cor + '">'
    + '<div class="card-body stack" style="gap:12px">'
    +   '<div class="row" style="gap:13px">'
    +     '<div class="avatar" style="background:' + p.cor + ';width:56px;height:56px;font-size:1.6rem">' + (p.avatarEmoji || '👤') + '</div>'
    +     '<div class="grow">'
    +       '<h1 style="font-size:1.3rem">' + esc(p.nome) + '</h1>'
    +       '<div class="small muted">' + esc(p.apelido || '') + (p.nascimento ? ' · nasc. ' + esc(fmtData(p.nascimento)) : '')
    +         (p.tipoSanguineo ? ' · ' + esc(p.tipoSanguineo) : '') + '</div>'
    +     '</div>'
    +     (pode('escrever') ? '<button class="btn btn-sm btn-ghost" data-acao="editar-paciente">✏️</button>' : '')
    +   '</div>'

    +   (alergias.length
        ? '<div class="note danger"><div class="note-title">⚠️ Alergias</div>' + esc(alergias.join(' · ')) + '</div>'
        : (pode('escrever') ? '<div class="note warn"><div class="note-title">Alergias não informadas</div>'
            + 'Registrar alergias evita erro grave em pronto-socorro.</div>' : ''))

    +   '<div class="pills">' + pillsCondicoes(condicoes) + '</div>'

    +   '<div class="grid grid-3" style="gap:8px">'
    +     kpiMini(meds.length, 'Medicações')
    +     kpiMini(estado.exames.filter((e) => e.pacienteId === p.id).length, 'Exames')
    +     kpiMini(estado.documentos.filter((d) => d.pacienteId === p.id).length, 'Documentos')
    +   '</div>'

    +   '<div class="small muted">' + esc(p.observacoes || 'Sem observações gerais.') + '</div>'
    + '</div></div>';
}

function kpiMini(n, rotulo) {
  return '<div style="background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);padding:10px;text-align:center">'
    + '<div class="strong mono" style="font-size:1.35rem">' + n + '</div>'
    + '<div class="tiny muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.04em">' + esc(rotulo) + '</div></div>';
}

function abas(p) {
  const defs = [
    { k: 'resumo', t: '🩺 Resumo' },
    { k: 'medicacoes', t: '💊 Medicações' },
    { k: 'exames', t: '🔬 Exames' },
    { k: 'sinais', t: '📈 Sinais' },
    { k: 'documentos', t: '📄 Documentos' },
    { k: 'diario', t: '📝 Diário' },
    { k: 'historico', t: '⏳ Histórico' },
  ];
  return '<div class="pac-tabs">'
    + defs.map((d) => '<button class="pac-tab' + (aba === d.k ? ' on' : '') + '" data-aba="' + d.k + '">' + d.t + '</button>').join('')
    + '<div class="grow"></div>'
    + (estado.pacientes.length > 1
      ? '<div class="pac-tabs">' + estado.pacientes.map((x) =>
          '<button class="pac-tab on" data-pac="' + esc(x.id) + '" style="' + (x.id === p.id ? '' : 'opacity:.5') + '">'
          + x.avatarEmoji + '</button>').join('') + '</div>'
      : '')
    + '</div>';
}

/* ------------------------------------------------------------------- corpo */

function pintarCorpo(p) {
  const c = $('#corpo');
  if (aba === 'resumo') c.innerHTML = resumo(p);
  else if (aba === 'medicacoes') c.innerHTML = listaMedicacoes(p);
  else if (aba === 'exames') c.innerHTML = listaExames(p);
  else if (aba === 'sinais') c.innerHTML = listaSinais(p);
  else if (aba === 'documentos') c.innerHTML = listaDocumentos(p);
  else if (aba === 'diario') c.innerHTML = listaDiario(p);
  else if (aba === 'historico') c.innerHTML = historico(p);
}

/* --- resumo clínico (o que levar impresso para a consulta) --- */
function resumo(p) {
  const meds = estado.medicamentos.filter((m) => m.pacienteId === p.id && m.ativo !== false);
  const ultimos = ultimosSinais(p.id, null, 6);
  const prox = estado.eventos
    .filter((e) => e.pacienteId === p.id && e.status !== 'cancelado' && e.inicio && new Date(e.inicio) > new Date())
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio))[0];

  return '<div class="stack">'
    + '<div class="note"><div class="note-title">💬 Como abrir a consulta</div>'
    +   '"Doutor(a), eu organizo o acompanhamento do meu pai/da minha mãe com a família. '
    +   'Aqui está o resumo e os laudos — os originais estão com a gente. Posso mostrar o que mudou desde a última vez?"</div>'

    + '<div class="section-title">Medicações em uso</div>'
    + (meds.length
      ? '<div class="card"><div class="table-wrap"><table class="table">'
        + '<thead><tr><th>Medicamento</th><th>Dose</th><th>Horários</th><th>Para quê</th></tr></thead><tbody>'
        + meds.map((m) => '<tr><td><b>' + esc(m.nome) + '</b>'
          + (m.controlado ? ' <span class="pill warn">controlado</span>' : '') + '</td>'
          + '<td class="mono">' + esc(m.dose || '—') + '</td>'
          + '<td class="mono">' + esc((m.horarios || []).join(' · ') || '—') + '</td>'
          + '<td class="small muted">' + esc(m.indicacao || '—') + '</td></tr>').join('')
        + '</tbody></table></div></div>'
      : '<div class="card card-pad"><p class="muted small">Nenhuma medicação ativa registrada.</p></div>')

    + '<div class="section-title">Últimos sinais</div>'
    + (ultimos.length
      ? '<div class="card"><div class="table-wrap"><table class="table">'
        + '<thead><tr><th>Quando</th><th>Sinal</th><th>Valor</th><th>Registrou</th></tr></thead><tbody>'
        + ultimos.map((s) => '<tr><td class="small">' + esc(fmtDataHora(s.medidoEm)) + '</td>'
          + '<td>' + esc(rotuloSinal(s.tipo)) + '</td>'
          + '<td class="mono strong">' + esc(s.valor) + ' <span class="muted" style="font-weight:400">' + esc(s.unidade || '') + '</span></td>'
          + '<td class="small muted">' + esc(s.registradoPorNome || '—') + '</td></tr>').join('')
        + '</tbody></table></div></div>'
      : '<div class="card card-pad"><p class="muted small">Nenhum sinal vital registrado.</p></div>')

    + (prox ? '<div class="note info"><div class="note-title">Próximo atendimento</div>'
        + esc(tipoEvento(prox.tipo).icone + ' ' + (prox.titulo || tipoEvento(prox.tipo).nome))
        + ' · ' + esc(fmtDataHora(prox.inicio))
        + (prox.local ? '<br>📍 ' + esc(prox.local) : '')
        + (prox.profissional ? '<br>👤 ' + esc(prox.profissional) : '') + '</div>' : '')

    + '<div class="btn-row">'
    +   '<button class="btn btn-soft" data-acao="imprimir">🖨 Imprimir resumo</button>'
    +   (pode('escrever') ? '<button class="btn btn-ghost" data-acao="editar-paciente">✏️ Editar ficha</button>' : '')
    + '</div>'
    + '</div>';
}

/* --- medicações --- */
function listaMedicacoes(p) {
  const meds = estado.medicamentos.filter((m) => m.pacienteId === p.id)
    .sort((a, b) => (b.ativo !== false) - (a.ativo !== false));
  if (!meds.length) return vazio('💊', 'Nenhuma medicação cadastrada',
    'Cadastre cada remédio com dose e horários: o app calcula as doses do dia e avisa quem está de plantão.',
    pode('escrever') ? '<button class="btn btn-primary" data-acao="nova-medicacao">＋ Cadastrar medicação</button>' : '');

  return '<div class="stack">'
    + (pode('escrever') ? '<button class="btn btn-primary btn-sm" data-acao="nova-medicacao" style="align-self:flex-start">＋ Nova medicação</button>' : '')
    + meds.map((m) => '<div class="item" style="border-left:4px solid ' + (m.ativo === false ? 'var(--ink-4)' : 'var(--ok)') + '">'
      + '<div class="item-main">'
      +   '<div class="item-title">' + esc(m.nome) + ' <span class="mono muted" style="font-weight:600">' + esc(m.dose || '') + '</span>'
      +     (m.controlado ? ' <span class="pill warn">controlado</span>' : '')
      +     (m.ativo === false ? ' <span class="pill">suspensa</span>' : '') + '</div>'
      +   '<div class="item-meta">'
      +     '<span>🕒 ' + esc((m.horarios || []).join(' · ') || 'sem horário') + '</span>'
      +     (m.via ? '<span>' + esc(m.via) + '</span>' : '')
      +     (m.diasSemana && m.diasSemana.length ? '<span>' + esc(nomesDias(m.diasSemana)) + '</span>' : '<span>todos os dias</span>')
      +   '</div>'
      +   (m.indicacao ? '<div class="item-text">' + esc(m.indicacao) + '</div>' : '')
      +   (m.prescricaoPor ? '<div class="tiny muted">Prescrito por ' + esc(m.prescricaoPor)
          + (m.inicio ? ' · desde ' + esc(fmtData(m.inicio)) : '') + '</div>' : '')
      +   '<div class="item-actions">'
      +     (pode('escrever') ? '<button class="btn btn-sm btn-ghost" data-acao="editar-medicacao" data-id="' + esc(m.id) + '">✏️ Editar</button>' : '')
      +     (pode('escrever') ? '<button class="btn btn-sm ' + (m.ativo === false ? 'btn-soft' : 'btn-ghost') + '" data-acao="alternar-medicacao" data-id="' + esc(m.id) + '">'
            + (m.ativo === false ? '↻ Reativar' : '⏸ Suspender') + '</button>' : '')
      +     (pode('excluir') ? '<button class="btn btn-sm btn-danger-soft" data-acao="excluir-medicacao" data-id="' + esc(m.id) + '">🗑</button>' : '')
      +   '</div>'
      + '</div></div>').join('')
    + '</div>';
}

function nomesDias(dias) {
  const n = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  return dias.map((d) => n[d]).join(', ');
}

/* --- exames --- */
function listaExames(p) {
  const ex = estado.exames.filter((e) => e.pacienteId === p.id)
    .sort((a, b) => (b.data || b.criadoEm || 0) - (a.data || a.criadoEm || 0));
  if (!ex.length) return vazio('🔬', 'Nenhum exame registrado',
    'Registre o resultado dos exames com os valores principais. Na consulta, o médico vê a evolução em segundos.',
    pode('escrever') ? '<button class="btn btn-primary" data-acao="novo-exame">＋ Registrar exame</button>' : '');

  return '<div class="stack">'
    + (pode('escrever') ? '<button class="btn btn-primary btn-sm" data-acao="novo-exame" style="align-self:flex-start">＋ Novo exame</button>' : '')
    + ex.map((e) => '<div class="item">'
      + '<div class="item-bar" style="background:' + (e.categoria === 'imagem' ? 'var(--info)' : 'var(--brand)') + '"></div>'
      + '<div class="item-main">'
      +   '<div class="row-between"><div class="item-title">' + esc(e.titulo) + '</div>'
      +     '<span class="pill ' + (e.categoria === 'imagem' ? 'info' : 'brand') + '">'
      +     esc(e.categoria === 'imagem' ? '🖼 Imagem' : '🧪 Laboratorial') + '</span></div>'
      +   '<div class="item-meta">'
      +     (e.data ? '<span>📅 ' + esc(fmtData(e.data)) + '</span>' : '')
      +     (e.especialidade ? '<span>👤 ' + esc(e.especialidade) + '</span>' : '')
      +     (e.unidade ? '<span>🏥 ' + esc(e.unidade) + '</span>' : '')
      +   '</div>'
      +   (e.valores && e.valores.length
          ? '<div class="table-wrap" style="margin-top:4px"><table class="table" style="font-size:.82rem">'
            + '<thead><tr><th>Analito</th><th>Resultado</th><th>Referência</th></tr></thead><tbody>'
            + e.valores.map((v) => {
              const g = gravidade(parseFloat(String(v.valor).replace(',', '.')), v.min, v.max);
              return '<tr><td>' + esc(v.nome) + '</td>'
                + '<td class="mono ' + (g === 'danger' ? 'strong' : '') + '" style="' + (g === 'danger' ? 'color:var(--danger)' : g === 'warn' ? 'color:var(--warn)' : '') + '">'
                + esc(v.valor) + ' <span class="muted" style="font-weight:400">' + esc(v.unidade || '') + '</span>'
                + (g === 'danger' ? ' ⚠️' : '') + '</td>'
                + '<td class="small muted">' + esc(v.referencia || '—') + '</td></tr>';
            }).join('')
            + '</tbody></table></div>'
          : '')
      +   (e.conclusao ? '<div class="item-text">' + esc(e.conclusao) + '</div>' : '')
      +   '<div class="item-actions">'
      +     (e.documentoId ? '<button class="btn btn-sm btn-soft" data-acao="abrir-doc" data-doc="' + esc(e.documentoId) + '">📄 Abrir laudo</button>' : '')
      +     (pode('escrever') ? '<button class="btn btn-sm btn-ghost" data-acao="editar-exame" data-id="' + esc(e.id) + '">✏️ Editar</button>' : '')
      +     (pode('excluir') ? '<button class="btn btn-sm btn-danger-soft" data-acao="excluir-exame" data-id="' + esc(e.id) + '">🗑</button>' : '')
      +   '</div>'
      + '</div></div>').join('')
    + '</div>';
}

/* --- sinais --- */
function rotuloSinal(t) {
  return { pa: 'Pressão arterial', glicemia: 'Glicemia', peso: 'Peso', temperatura: 'Temperatura',
    saturacao: 'Saturação O₂', fc: 'Frequência cardíaca', dor: 'Dor (0-10)' }[t] || t;
}

function listaSinais(p) {
  const s = ultimosSinais(p.id, null, 30);
  if (!s.length) return vazio('📈', 'Nenhum sinal registrado',
    'Registre pressão, glicemia, peso e temperatura. Com o tempo isso vira o histórico que orienta ajuste de remédio.',
    pode('escrever') ? '<button class="btn btn-primary" data-acao="ir-sinais">＋ Registrar sinal</button>' : '');
  return '<div class="stack">'
    + (pode('escrever') ? '<button class="btn btn-primary btn-sm" data-acao="ir-sinais" style="align-self:flex-start">＋ Registrar sinal</button>' : '')
    + '<div class="card"><div class="table-wrap"><table class="table">'
    + '<thead><tr><th>Quando</th><th>Sinal</th><th>Valor</th><th>Quem</th></tr></thead><tbody>'
    + s.map((x) => '<tr><td class="small">' + esc(fmtDataHora(x.medidoEm)) + '</td>'
      + '<td>' + esc(rotuloSinal(x.tipo)) + '</td>'
      + '<td class="mono strong">' + esc(x.valor) + ' <span class="muted" style="font-weight:400">' + esc(x.unidade || '') + '</span></td>'
      + '<td class="small muted">' + esc(x.registradoPorNome || '—') + '</td></tr>').join('')
    + '</tbody></table></div></div>'
    + '<p class="tiny muted">Para gráficos de evolução, abra a aba <b>Sinais</b>.</p>'
    + '</div>';
}

/* --- documentos --- */
function listaDocumentos(p) {
  const docs = estado.documentos.filter((d) => d.pacienteId === p.id)
    .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
  if (!docs.length) return vazio('📄', 'Nenhum documento',
    'Guarde aqui laudos, receitas, pedidos de exame e relatórios. Ficam cifrados e disponíveis para toda a família.',
    pode('escrever') ? '<button class="btn btn-primary" data-acao="ir-documentos">＋ Enviar documento</button>' : '');
  return '<div class="stack">'
    + (pode('escrever') ? '<button class="btn btn-primary btn-sm" data-acao="ir-documentos" style="align-self:flex-start">＋ Novo documento</button>' : '')
    + docs.map((d) => '<div class="item"><div class="item-bar" style="background:var(--ink-3)"></div>'
      + '<div class="item-main"><div class="item-title">' + esc(d.titulo) + '</div>'
      + '<div class="item-meta"><span class="pill">' + esc(d.categoria || 'Documento') + '</span>'
      + (d.data ? '<span>📅 ' + esc(fmtData(d.data)) + '</span>' : '')
      + '<span class="muted">enviado ' + esc(relativo(d.criadoEm)) + '</span></div>'
      + '<div class="item-actions"><button class="btn btn-sm btn-soft" data-acao="abrir-doc" data-doc="' + esc(d.arquivoId) + '">📄 Abrir</button>'
      + '<button class="btn btn-sm btn-ghost" data-acao="baixar-doc" data-doc="' + esc(d.arquivoId) + '" data-nome="' + esc(d.titulo) + '">⬇ Baixar</button>'
      + '</div></div></div>').join('')
    + '</div>';
}

/* --- diário --- */
function listaDiario(p) {
  const d = estado.diario.filter((x) => x.pacienteId === p.id)
    .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
  if (!d.length) return vazio('📝', 'Diário vazio',
    'Anote como o dia foi: sono, apetite, humor, dor, confusão, mobilidade. É o que revela tendência antes do exame.',
    pode('escrever') ? '<button class="btn btn-primary" data-acao="nova-anotacao">＋ Nova anotação</button>' : '');
  return '<div class="stack">'
    + (pode('escrever') ? '<button class="btn btn-primary btn-sm" data-acao="nova-anotacao" style="align-self:flex-start">＋ Nova anotação</button>' : '')
    + '<div class="tl">' + d.map((x) => '<div class="tl-item">'
      + '<div class="tl-dot ' + (x.alerta ? 'warn' : '') + '"></div>'
      + '<div class="item-title" style="font-size:.9rem">' + esc(fmtDataHora(x.criadoEm)) + ' · ' + esc(x.autorNome || '—') + '</div>'
      + '<div class="item-text">' + esc(x.texto) + '</div>'
      + (x.humor ? '<div class="item-meta"><span class="pill">' + esc(x.humor) + '</span></div>' : '')
      + '</div>').join('') + '</div></div>';
}

/* --- histórico de atendimentos --- */
function historico(p) {
  const ev = estado.eventos.filter((e) => e.pacienteId === p.id)
    .sort((a, b) => new Date(b.inicio || 0) - new Date(a.inicio || 0));
  if (!ev.length) return vazio('⏳', 'Sem histórico', 'Os atendimentos aparecem aqui depois de registrados.');
  return '<div class="tl">' + ev.map((e) => {
    const te = tipoEvento(e.tipo);
    const real = e.status === 'realizado';
    return '<div class="tl-item"><div class="tl-dot ' + (real ? 'ok' : 'muted') + '"></div>'
      + '<div class="item-title" style="font-size:.9rem">' + te.icone + ' ' + esc(e.titulo || te.nome) + '</div>'
      + '<div class="item-meta"><span>' + esc(fmtData(e.inicio)) + '</span>'
      + (e.local ? '<span>📍 ' + esc(e.local) + '</span>' : '')
      + (e.profissional ? '<span>👤 ' + esc(e.profissional) + '</span>' : '')
      + '<span class="pill">' + esc(real ? 'realizado' : e.status || 'agendado') + '</span></div>'
      + (e.resultado ? '<div class="item-text">📝 ' + esc(e.resultado) + '</div>' : '')
      + '</div>';
  }).join('') + '</div>';
}

/* ------------------------------------------------------------------- ações */

async function tratarAcao(acao, el, host) {
  const p = paciente(pacienteId);

  if (acao === 'editar-paciente') return editarPaciente(p);
  if (acao === 'imprimir') return window.print();
  if (acao === 'ir-sinais') return irPara('sinais', { paciente: p.id });
  if (acao === 'ir-documentos') return irPara('documentos', { paciente: p.id });
  if (acao === 'nova-medicacao') return formMedicacao(null, p.id);
  if (acao === 'editar-medicacao') return formMedicacao(porId('medicamentos', el.dataset.id), p.id);
  if (acao === 'alternar-medicacao') return alternarMedicacao(el.dataset.id);
  if (acao === 'excluir-medicacao') return excluirMedicacao(el.dataset.id);
  if (acao === 'novo-exame') return formExame(null, p.id);
  if (acao === 'editar-exame') return formExame(porId('exames', el.dataset.id), p.id);
  if (acao === 'excluir-exame') return excluirExame(el.dataset.id);
  if (acao === 'nova-anotacao') return novaAnotacao(p.id);
  if (acao === 'abrir-doc') return abrirDoc(el.dataset.doc);
  if (acao === 'baixar-doc') return baixarDoc(el.dataset.doc, el.dataset.nome);
}

async function editarPaciente(p) {
  const r = await modal({
    titulo: 'Editar ficha',
    corpo: '<div class="stack">'
      + campoTexto({ id: 'f-nome', label: 'Nome completo', valor: p.nome, obrigatorio: true })
      + campoTexto({ id: 'f-apelido', label: 'Como a família chama', valor: p.apelido || '' })
      + campoTexto({ id: 'f-nascimento', label: 'Nascimento', valor: p.nascimento || '', tipo: 'date' })
      + campoTexto({ id: 'f-tipoSanguineo', label: 'Tipo sanguíneo', valor: p.tipoSanguineo || '', placeholder: 'Ex.: O+' })
      + campoTexto({ id: 'f-condicoes', label: 'Condições (separar por ; )', valor: (p.condicoes || []).join('; ') })
      + campoTexto({ id: 'f-alergias', label: 'Alergias (separar por ; )', valor: (p.alergias || []).join('; '), dica: 'Crucial para pronto-socorro.' })
      + campoTexto({ id: 'f-convenio', label: 'Convênio', valor: p.convenio || '' })
      + campoTexto({ id: 'f-unidade', label: 'Unidade de referência', valor: p.unidade || '' })
      + campoArea({ id: 'f-observacoes', label: 'Observações gerais', valor: p.observacoes || '', linhas: 4 })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;
  atualizar('pacientes', p.id, {
    nome: d.nome, apelido: d.apelido, nascimento: d.nascimento, tipoSanguineo: d.tipoSanguineo,
    condicoes: dividir(d.condicoes), alergias: dividir(d.alergias),
    convenio: d.convenio, unidade: d.unidade, observacoes: d.observacoes,
  });
  auditar('paciente-editado', d.nome, p.id);
  toast('Ficha atualizada.', 'ok');
  render(document.getElementById('view'), { paciente: p.id });
}

function dividir(txt) {
  return String(txt || '').split(';').map((s) => s.trim()).filter(Boolean);
}

async function formMedicacao(m, pId) {
  const editando = !!m;
  const r = await modal({
    titulo: editando ? 'Editar medicação' : 'Nova medicação',
    corpo: '<div class="stack">'
      + campoTexto({ id: 'f-nome', label: 'Nome do medicamento', valor: m ? m.nome : '', obrigatorio: true, placeholder: 'Ex.: Losartana 50mg' })
      + '<div class="grid grid-2" style="gap:12px">'
      + campoTexto({ id: 'f-dose', label: 'Dose por vez', valor: m ? m.dose || '' : '', placeholder: 'Ex.: 1 comprimido' })
      + campoSelect({ id: 'f-via', label: 'Via', valor: m ? m.via : 'oral', vazio: null,
          opcoes: ['oral', 'sublingual', 'injetável', 'tópica', 'inalatória', 'sonda'] })
      + '</div>'
      + campoTexto({ id: 'f-horarios', label: 'Horários', valor: m ? (m.horarios || []).join(', ') : '', obrigatorio: true,
          placeholder: '08:00, 20:00', dica: 'Separe por vírgula — o app monta a lista de doses do dia.' })
      + campoTexto({ id: 'f-para', label: 'Para quê / indicação', valor: m ? m.indicacao || '' : '', placeholder: 'Ex.: pressão alta' })
      + campoTexto({ id: 'f-prescricaoPor', label: 'Prescrito por', valor: m ? m.prescricaoPor || '' : '' })
      + campoTexto({ id: 'f-inicio', label: 'Início do uso', valor: m ? m.inicio || '' : '', tipo: 'date' })
      + '<label class="check"><input type="checkbox" data-campo="controlado"' + (m && m.controlado ? ' checked' : '') + '>'
      + '<span><b>Medicamento controlado</b><div class="field-hint" style="margin-top:3px">Exige receita e controle de quantidade. Aparece em destaque.</div></span></label>'
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;
  d.horarios = String(d.horarios || '').split(',').map((s) => s.trim()).filter(Boolean)
    .map((h) => { const [a, b] = h.split(':'); return String(a || '').padStart(2, '0') + ':' + String(b || '00').padStart(2, '0'); });
  d.pacienteId = pId;
  d.indicacao = d.para; delete d.para;

  if (editando) { atualizar('medicamentos', m.id, d); auditar('medicacao-editada', d.nome, pId); toast('Medicação atualizada.', 'ok'); }
  else { inserir('medicamentos', { id: novoId('med'), ...d, ativo: true }); auditar('medicacao-criada', d.nome, pId); toast('Medicação cadastrada.', 'ok'); }
  render(document.getElementById('view'), { paciente: pId });
}

function alternarMedicacao(id) {
  const m = porId('medicamentos', id);
  if (!m) return;
  atualizar('medicamentos', id, { ativo: m.ativo === false });
  auditar(m.ativo === false ? 'medicacao-reativada' : 'medicacao-suspensa', m.nome, m.pacienteId);
  toast(m.ativo === false ? 'Medicação reativada.' : 'Medicação suspensa.', 'ok');
  render(document.getElementById('view'), { paciente: pacienteId });
}

async function excluirMedicacao(id) {
  const m = porId('medicamentos', id);
  if (!m) return;
  if (!await confirmar('Excluir medicação?', '"' + m.nome + '" será removida do prontuário. Prefira "Suspender" para manter o histórico.',
    'Excluir')) return;
  remover('medicamentos', id);
  auditar('medicacao-excluida', m.nome, m.pacienteId);
  toast('Medicação excluída.');
  render(document.getElementById('view'), { paciente: pacienteId });
}

async function formExame(e, pId) {
  const editando = !!e;
  const valoresIniciais = (e && e.valores) ? e.valores.map((v) =>
    v.nome + ':' + v.valor + (v.unidade ? ' ' + v.unidade : '') + (v.referencia ? ' (ref ' + v.referencia + ')' : '')).join('\n') : '';

  const r = await modal({
    titulo: editando ? 'Editar exame' : 'Registrar exame',
    corpo: '<div class="stack">'
      + campoTexto({ id: 'f-titulo', label: 'Nome do exame', valor: e ? e.titulo : '', obrigatorio: true,
          placeholder: 'Ex.: Hemograma completo, Creatinina, Ressonância de crânio' })
      + '<div class="grid grid-2" style="gap:12px">'
      + campoSelect({ id: 'f-categoria', label: 'Categoria', valor: e ? e.categoria : 'laboratorial', vazio: null,
          opcoes: [{ valor: 'laboratorial', texto: '🧪 Laboratorial' }, { valor: 'imagem', texto: '🖼 Imagem' },
            { valor: 'outro', texto: '📋 Outro' }] })
      + campoTexto({ id: 'f-data', label: 'Data da coleta', valor: e ? e.data || '' : '', tipo: 'date', obrigatorio: true })
      + '</div>'
      + '<div class="grid grid-2" style="gap:12px">'
      + campoTexto({ id: 'f-especialidade', label: 'Especialidade', valor: e ? e.especialidade || '' : '' })
      + campoTexto({ id: 'f-unidade', label: 'Laboratório / clínica', valor: e ? e.unidade || '' : '' })
      + '</div>'
      + campoArea({ id: 'f-valores', label: 'Resultados (um por linha)', valor: valoresIniciais, linhas: 6,
          placeholder: 'Hemoglobina: 11.2 g/dL (ref 12-16)\nCreatinina: 1.9 mg/dL (ref 0.6-1.2)',
          dica: 'Formato: Nome: valor unidade (ref faixa). Só o que importa para o acompanhamento.' })
      + campoArea({ id: 'f-conclusao', label: 'Conclusão / laudo', valor: e ? e.conclusao || '' : '', linhas: 4,
          placeholder: 'O que o laudo concluiu, em linguagem simples.' })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;
  d.valores = parsearValores(d.valores);
  d.pacienteId = pId;

  if (editando) { atualizar('exames', e.id, d); auditar('exame-editado', d.titulo, pId); toast('Exame atualizado.', 'ok'); }
  else { inserir('exames', { id: novoId('ex'), ...d }); auditar('exame-criado', d.titulo, pId); toast('Exame registrado.', 'ok'); }
  render(document.getElementById('view'), { paciente: pId });
}

function parsearValores(txt) {
  return String(txt || '').split('\n').map((linha) => linha.trim()).filter(Boolean).map((linha) => {
    const m = linha.match(/^(.+?):\s*([\d.,]+)\s*([^\s(]*)?\s*(?:\(ref\s*([^)]*)\))?/);
    if (!m) return null;
    const ref = m[4] || '';
    const faixa = ref.match(/([\d.,]+)\s*[-–a]\s*([\d.,]+)/);
    return {
      nome: m[1].trim(),
      valor: m[2].replace(',', '.'),
      unidade: (m[3] || '').trim(),
      referencia: ref,
      min: faixa ? parseFloat(faixa[1].replace(',', '.')) : null,
      max: faixa ? parseFloat(faixa[2].replace(',', '.')) : null,
    };
  }).filter(Boolean);
}

async function excluirExame(id) {
  const e = porId('exames', id);
  if (!e) return;
  if (!await confirmar('Excluir exame?', '"' + e.titulo + '" será removido.', 'Excluir')) return;
  remover('exames', id);
  auditar('exame-excluido', e.titulo, e.pacienteId);
  toast('Exame excluído.');
  render(document.getElementById('view'), { paciente: pacienteId });
}

async function novaAnotacao(pId) {
  const r = await modal({
    titulo: 'Anotação do dia',
    corpo: '<div class="stack">'
      + campoTexto({ id: 'f-humor', label: 'Como estava hoje', valor: '',
          placeholder: 'Ex.: Bem disposta, mais quieta que o normal' })
      + campoArea({ id: 'f-texto', label: 'Observações', valor: '', linhas: 6, obrigatorio: true,
          placeholder: 'Sono, apetite, dor, mobilidade, confusão, humor, evacuação…' })
      + '<label class="check"><input type="checkbox" data-campo="alerta"><span><b>Marcar como ponto de atenção</b>'
      + '<div class="field-hint" style="margin-top:3px">Use quando algo preocupa e precisa ser levado ao médico.</div></span></label>'
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados || !r.dados.texto) return;
  inserir('diario', {
    id: novoId('dia'), pacienteId: pId, texto: r.dados.texto, humor: r.dados.humor,
    alerta: !!r.dados.alerta, autorNome: sessao.membro.nome,
  });
  auditar('diario-anotado', r.dados.texto.slice(0, 60), pId);
  toast('Anotação salva.', 'ok');
  render(document.getElementById('view'), { paciente: pId });
}

async function abrirDoc(arquivoId) {
  try {
    const { abrirDocumento } = await import('../store.js');
    await abrirDocumento(arquivoId, 'application/pdf');
  } catch (e) { toast(e.message, 'danger'); }
}

async function baixarDoc(arquivoId, nome) {
  try {
    const { baixarDocumento } = await import('../store.js');
    await baixarDocumento(arquivoId, nome || 'documento.pdf', 'application/pdf');
  } catch (e) { toast(e.message, 'danger'); }
}
