/* ============================================================================
 * Tela · Painel  (assets/js/views/painel.js)
 * ----------------------------------------------------------------------------
 * A primeira coisa que a família vê. Responde, sem rolagem:
 *   1. O que precisa ser feito AGORA (doses, quem está de plantão)
 *   2. Qual é o próximo compromisso
 *   3. Como os dois estão hoje
 * ==========================================================================*/

'use strict';

import {
  estado, sessao, dosesPendentesHoje, agoraProximo, eventosDoDia,
  ultimosSinais, resumoDocumentos, inserir, novoId, auditar,
} from '../store.js';
import { pode, PAPEIS } from '../auth.js';
import {
  esc, $, toast, vazio, fmtData, fmtHora, fmtDiaLongo, relativo, paraData,
  tipoEvento, paciente, pillsCondicoes, irPara,
} from '../ui.js';

export function render(host) {
  const membro = sessao.membro;
  const hora = new Date().getHours();
  const saudacao = hora < 6 ? 'Boa madrugada' : hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const pendentes = dosesPendentesHoje();
  const proximo = agoraProximo();
  const hoje = eventosDoDia();
  const docs = resumoDocumentos();
  const muralFixado = (estado.mural || []).filter((m) => m.fixado).slice(0, 3);
  const plantao = plantaoDeHoje();

  host.innerHTML = '<div class="wrap stack">'

    /* ---- cabeçalho pessoal ---- */
    + '<div class="card card-pad" style="background:linear-gradient(135deg,var(--brand) 0%,var(--brand-dark) 100%);border:none;color:#fff">'
    +   '<div class="row-between" style="align-items:flex-start">'
    +     '<div><div style="font-size:1.28rem;font-weight:800;letter-spacing:-.02em">'
    +       esc(saudacao) + ', ' + esc(membro.nome.split(' ')[0]) + '</div>'
    +       '<div style="font-size:.85rem;opacity:.86;margin-top:3px">'
    +       esc(fmtDiaLongo(new Date())) + ' · ' + esc((PAPEIS[membro.papel] || {}).nome || '') + '</div></div>'
    +     '<div style="font-size:2rem">🩺</div>'
    +   '</div>'
    +   (plantao ? '<div style="margin-top:14px;padding-top:13px;border-top:1px solid rgba(255,255,255,.24);font-size:.86rem">'
        + '👥 <b>Plantão de hoje:</b> ' + esc(plantao) + '</div>' : '')
    + '</div>'

    /* ---- o que fazer agora ---- */
    + (pendentes.length
      ? '<div class="card">'
        + '<div class="card-head"><h3>💊 Medicações para agora</h3>'
        + '<span class="pill danger">' + pendentes.length + '</span></div>'
        + '<div class="card-body stack" style="gap:9px">'
        + pendentes.slice(0, 4).map((p) => {
          const pac = paciente(p.medicamento.pacienteId);
          const atrasado = p.quando.getTime() < Date.now() - 900000;
          return '<div class="item" style="padding:11px 13px">'
            + '<div class="item-bar" style="background:' + (atrasado ? 'var(--danger)' : pac.cor) + '"></div>'
            + '<div class="item-main"><div class="item-title">' + esc(p.medicamento.nome) + '</div>'
            + '<div class="item-meta"><span>' + pac.avatarEmoji + ' ' + esc(pac.nome.split(' ')[0]) + '</span>'
            + '<span>🕒 ' + esc(p.horario) + '</span>'
            + '<span class="' + (atrasado ? 'strong' : 'muted') + '" style="' + (atrasado ? 'color:var(--danger)' : '') + '">'
            + esc(atrasado ? 'atrasada ' + relativo(p.quando) : relativo(p.quando)) + '</span></div></div>'
            + '<button class="btn btn-sm btn-ok" data-dose="' + esc(p.medicamento.id) + '" data-janela="' + esc(p.horario) + '">Dar</button>'
            + '</div>';
        }).join('')
        + (pendentes.length > 4 ? '<button class="btn btn-soft btn-block" data-ir="medicamentos">Ver todas as ' + pendentes.length + ' doses</button>' : '')
        + '</div></div>'
      : '<div class="note ok"><div class="note-title">✓ Em dia</div>'
        + 'Nenhuma dose pendente neste momento. Continue registrando para manter o histórico confiável.</div>')

    /* ---- próximo compromisso ---- */
    + '<div class="section-title">Próximo compromisso</div>'
    + (proximo ? (() => {
        const te = tipoEvento(proximo.tipo);
        const pac = paciente(proximo.pacienteId);
        return '<div class="card card-pad stack" style="gap:9px">'
          + '<div class="row-between"><h3>' + te.icone + ' ' + esc(proximo.titulo || te.nome) + '</h3>'
          + '<span class="pill ' + (paraData(proximo.inicio) && paraData(proximo.inicio).getTime() - Date.now() < 86400000 ? 'warn' : 'brand') + '">'
          + esc(relativo(proximo.inicio)) + '</span></div>'
          + '<div class="row-wrap">'
          + '<span class="pill" style="color:' + pac.cor + ';border-color:' + pac.cor + '">' + pac.avatarEmoji + ' ' + esc(pac.nome) + '</span>'
          + '<span class="pill">📅 ' + esc(fmtData(proximo.inicio)) + ' às ' + esc(fmtHora(proximo.inicio)) + '</span>'
          + (proximo.local ? '<span class="pill">📍 ' + esc(proximo.local) + '</span>' : '')
          + (proximo.profissional ? '<span class="pill">👤 ' + esc(proximo.profissional) + '</span>' : '')
          + (proximo.precisaAcompanhante ? '<span class="pill warn">⚠️ Precisa acompanhante</span>' : '')
          + '</div>'
          + (proximo.observacoes ? '<div class="item-text">' + esc(proximo.observacoes) + '</div>' : '')
          + '<div class="btn-row"><button class="btn btn-sm btn-soft" data-ir="agenda">📅 Abrir agenda</button></div>'
          + '</div>';
      })() : '<div class="card card-pad"><p class="muted small">Nenhum compromisso agendado. '
        + (pode('escrever') ? '<button class="btn btn-sm btn-soft" data-ir="agenda" style="margin-left:6px">Agendar</button>' : '') + '</p></div>')

    /* ---- agenda de hoje ---- */
    + (hoje.length && (!proximo || fmtData(hoje[0].inicio) !== fmtData(proximo.inicio))
      ? '<div class="section-title">Também hoje</div>'
        + '<div class="stack" style="gap:8px">' + hoje.slice(0, 3).map((e) => {
          const te = tipoEvento(e.tipo);
          return '<div class="item" style="padding:11px 13px">'
            + '<div class="item-bar" style="background:' + te.cor + '"></div>'
            + '<div class="item-main"><div class="item-title">' + te.icone + ' ' + esc(e.titulo || te.nome) + '</div>'
            + '<div class="item-meta"><span>🕒 ' + esc(fmtHora(e.inicio)) + '</span>'
            + '<span>' + esc(paciente(e.pacienteId).nome.split(' ')[0]) + '</span>'
            + (e.local ? '<span>📍 ' + esc(e.local) + '</span>' : '') + '</div></div></div>';
        }).join('') + '</div>'
      : '')

    /* ---- os dois pacientes ---- */
    + '<div class="section-title">Como estão hoje</div>'
    + '<div class="grid grid-2">' + estado.pacientes.map(cartaoPaciente).join('') + '</div>'

    /* ---- mural fixado ---- */
    + (muralFixado.length
      ? '<div class="section-title">📌 Recados fixados</div>'
        + muralFixado.map((m) => '<div class="note"><div class="note-title">'
          + esc(m.autorNome || 'Família') + ' · ' + esc(relativo(m.criadoEm)) + '</div>' + esc(m.texto) + '</div>').join('')
      : '')

    /* ---- rodapé de estado ---- */
    + '<div class="card card-pad">'
    +   '<div class="row-between"><span class="small muted">Documentos no cofre</span>'
    +     '<span class="strong">' + docs.total + '</span></div>'
    +   '<div class="row-between" style="margin-top:7px"><span class="small muted">Última sincronização</span>'
    +     '<span class="strong">' + esc(estado.dor.ultimaSincronizacao ? relativo(estado.dor.ultimaSincronizacao) : 'nunca') + '</span></div>'
    +   (pode('sincronizar')
        ? '<button class="btn btn-soft btn-block btn-sm" style="margin-top:12px" data-ir="ajustes">🔄 Sincronizar com a família</button>' : '')
    + '</div>'

    + '</div>';

  host.addEventListener('click', (ev) => {
    const ir = ev.target.closest('[data-ir]');
    if (ir) { irPara(ir.dataset.ir); return; }

    const dose = ev.target.closest('[data-dose]');
    if (dose) { registrarDose(dose.dataset.dose, dose.dataset.janela, host); return; }
  });
}

/* ------------------------------------------------------------------ auxiliares */

function cartaoPaciente(p) {
  const sinais = ultimosSinais(p.id, null, 40);
  const pa = sinais.find((s) => s.tipo === 'pa');
  const glic = sinais.find((s) => s.tipo === 'glicemia');
  const peso = sinais.find((s) => s.tipo === 'peso');
  const eventosFuturos = estado.eventos.filter((e) =>
    e.pacienteId === p.id && e.status !== 'cancelado' && paraData(e.inicio) && paraData(e.inicio).getTime() > Date.now()).length;
  const medsAtivos = estado.medicamentos.filter((m) => m.pacienteId === p.id && m.ativo !== false).length;

  return '<div class="card" style="border-left:5px solid ' + p.cor + '">'
    + '<div class="card-body stack" style="gap:11px">'
    +   '<div class="row" style="gap:10px">'
    +     '<div class="avatar" style="background:' + p.cor + ';width:44px;height:44px;font-size:1.25rem">' + (p.avatarEmoji || '👤') + '</div>'
    +     '<div class="grow"><div class="strong">' + esc(p.nome) + '</div>'
    +       '<div class="tiny muted">' + (p.apelido ? esc(p.apelido) + ' · ' : '')
    +       medsAtivos + ' medicação(ões) ativa(s)</div></div>'
    +   '</div>'
    +   '<div class="pills">' + pillsCondicoes(p.condicoes || [], 4) + '</div>'
    +   (pa || glic || peso
        ? '<div class="grid grid-3" style="gap:7px">'
          + (pa ? miniSinal('PA', pa.valor, 'mmHg') : '')
          + (glic ? miniSinal('Glicemia', glic.valor, glic.unidade || 'mg/dL') : '')
          + (peso ? miniSinal('Peso', peso.valor, 'kg') : '')
          + '</div>'
        : '<div class="tiny muted">Nenhum sinal vital registrado ainda.</div>')
    +   '<div class="btn-row">'
    +     '<button class="btn btn-sm btn-soft" data-ir="prontuario" onclick="location.hash=\'#/prontuario?paciente=' + p.id + '\'">📋 Prontuário</button>'
    +     '<button class="btn btn-sm btn-ghost" data-ir="sinais">📈 ' + eventosFuturos + ' agendado(s)</button>'
    +   '</div>'
    + '</div></div>';
}

function miniSinal(rotulo, valor, unidade) {
  const num = parseFloat(String(valor).replace(',', '.'));
  let cls = '';
  if (rotulo === 'PA') { const s = String(valor).match(/(\d+)\s*\/\s*(\d+)/); if (s && (Number(s[1]) >= 140 || Number(s[2]) >= 90)) cls = 'danger'; }
  if (rotulo === 'Glicemia' && !isNaN(num) && (num > 180 || num < 70)) cls = 'danger';
  return '<div style="background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r);padding:8px 9px;text-align:center">'
    + '<div class="tiny muted" style="font-weight:700">' + esc(rotulo) + '</div>'
    + '<div class="mono strong" style="font-size:.94rem;' + (cls ? 'color:var(--danger)' : '') + '">' + esc(valor) + '</div>'
    + '<div class="tiny muted">' + esc(unidade) + '</div></div>';
}

/** Quem está escalado hoje (vem dos recados do mural marcados como escala). */
function plantaoDeHoje() {
  const hoje = new Date().toISOString().slice(0, 10);
  const escalas = (estado.mural || []).filter((m) => m.tipo === 'escala' && m.data === hoje);
  if (!escalas.length) return '';
  return escalas.map((e) => e.texto).join(' · ');
}

/* ------------------------------------------------------------------ dose */

async function registrarDose(medicamentoId, janela, host) {
  const m = estado.medicamentos.find((x) => x.id === medicamentoId);
  if (!m) return;
  inserir('doses', {
    id: novoId('dose'),
    medicamentoId,
    pacienteId: m.pacienteId,
    janela,
    horario: Date.now(),
  });
  auditar('dose-registrada', m.nome + ' (' + janela + ')', m.pacienteId);
  toast('Dose de ' + m.nome + ' registrada.', 'ok');
  render(host);
}
