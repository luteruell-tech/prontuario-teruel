/* ============================================================================
 * Tela · Medicações e doses  (assets/js/views/medicamentos.js)
 * ----------------------------------------------------------------------------
 * O que a família realmente usa todo dia: o que dar agora, o que já foi dado,
 * e a adesão dos últimos dias. É aqui que mora o risco de erro de medicação —
 * por isso a tela mostra horário, quem deu e permite desfazer.
 * ==========================================================================*/

'use strict';

import { estado, inserir, remover, auditar, novoId, sessao, porId } from '../store.js';
import { pode } from '../auth.js';
import {
  esc, $, modal, confirmar, toast, vazio, fmtData, fmtHora, fmtDataHora, relativo,
  paciente, campoTexto, campoSelect, campoArea, irPara, atualizarBadges,
} from '../ui.js';

let diaRef = hojeISO();

function hojeISO() { return new Date().toISOString().slice(0, 10); }

export function render(host, params) {
  const pendentes = pendentesDoDia(diaRef);
  const registradas = registradasDoDia(diaRef);
  const meds = estado.medicamentos.filter((m) => m.ativo !== false);

  host.innerHTML = '<div class="wrap stack">'
    + '<div class="row-between">'
    +   '<div><h1>Medicações</h1><p class="muted small">Doses do dia, registro e adesão</p></div>'
    +   (pode('escrever') ? '<button class="btn btn-primary" data-acao="nova">＋ Nova</button>' : '')
    + '</div>'

    + '<div class="card card-pad stack" style="gap:12px;padding:14px">'
    +   '<div class="row-between">'
    +     '<button class="btn btn-sm btn-ghost" data-dia="-1">‹ Dia anterior</button>'
    +     '<div class="center"><div class="strong">' + esc(rotuloDia(diaRef)) + '</div>'
    +       '<div class="tiny muted">' + registradas.length + ' de ' + (pendentes.length + registradas.length) + ' doses</div></div>'
    +     '<button class="btn btn-sm btn-ghost" data-dia="1"' + (diaRef >= hojeISO() ? ' disabled' : '') + '>Próximo dia ›</button>'
    +   '</div>'
    +   barraProgresso(registradas.length, registradas.length + pendentes.length)
    + '</div>'

    + (pendentes.length
      ? '<div class="section-title">⏳ A dar</div>'
        + '<div class="stack" style="gap:8px">' + pendentes.map(cartaoPendente).join('') + '</div>'
      : '<div class="note ok"><div class="note-title">✓ Tudo registrado neste dia</div>'
        + 'Nenhuma dose pendente. Se algum horário ainda não chegou, ele aparece na hora certa.</div>')

    + (registradas.length
      ? '<div class="section-title">✓ Já registradas</div>'
        + '<div class="card"><div class="table-wrap"><table class="table">'
        + '<thead><tr><th>Hora</th><th>Medicamento</th><th>Paciente</th><th>Quem deu</th><th></th></tr></thead><tbody>'
        + registradas.map((d) => {
          const m = porId('medicamentos', d.medicamentoId);
          const p = paciente(d.pacienteId);
          return '<tr><td class="mono strong">' + esc(fmtHora(d.horario)) + '</td>'
            + '<td>' + esc(m ? m.nome : '(medicação removida)') + '</td>'
            + '<td><span class="pill ghost" style="color:' + p.cor + '">' + p.avatarEmoji + '</span></td>'
            + '<td class="small muted">' + esc(d.registradoPorNome || '—') + '</td>'
            + '<td>' + (pode('escrever') && (Date.now() - d.horario < 3600000)
                ? '<button class="btn btn-sm btn-ghost" data-acao="desfazer" data-id="' + esc(d.id) + '">desfazer</button>' : '') + '</td></tr>';
        }).join('')
        + '</tbody></table></div></div>'
      : '')

    + '<div class="section-title">💊 Medicações cadastradas</div>'
    + (meds.length
      ? '<div class="stack" style="gap:8px">' + meds.map(cartaoMedicacao).join('') + '</div>'
      : '<div class="card card-pad"><p class="muted small">Nenhuma medicação ativa. '
        + (pode('escrever') ? '<button class="btn btn-sm btn-soft" data-acao="nova" style="margin-left:6px">Cadastrar</button>' : '')
        + '</p></div>')

    /* adesão — visão de gestão para o gestor e editores */
    + (pode('verAuditoria') ? adesao() : '')
    + '</div>';

  host.addEventListener('click', (ev) => {
    const d = ev.target.closest('[data-dia]');
    if (d) {
      const nova = new Date(diaRef + 'T12:00:00');
      nova.setDate(nova.getDate() + Number(d.dataset.dia));
      diaRef = nova.toISOString().slice(0, 10);
      if (diaRef > hojeISO()) diaRef = hojeISO();
      render(host); return;
    }
    const ac = ev.target.closest('[data-acao]');
    if (!ac) return;
    const a = ac.dataset.acao;
    if (a === 'nova') abrirNovaMedicacao();
    else if (a === 'dar') registrar(ac.dataset.id, ac.dataset.janela, host);
    else if (a === 'desfazer') desfazer(ac.dataset.id, host);
    else if (a === 'info') {
      const m = porId('medicamentos', ac.dataset.id);
      modal({ titulo: m.nome, corpo: '<div class="stack">'
        + '<div class="item-meta"><span class="pill brand">' + esc(m.dose || 'dose não informada') + '</span>'
        + '<span class="pill">' + esc((m.horarios || []).join(' · ')) + '</span>'
        + (m.via ? '<span class="pill">' + esc(m.via) + '</span>' : '') + '</div>'
        + (m.indicacao ? '<p class="item-text"><b>Para quê:</b> ' + esc(m.indicacao) + '</p>' : '')
        + (m.prescricaoPor ? '<p class="item-text"><b>Prescrito por:</b> ' + esc(m.prescricaoPor) + '</p>' : '')
        + (m.observacoes ? '<p class="item-text">' + esc(m.observacoes) + '</p>' : '')
        + '<div class="note warn">Confira sempre a receita original antes de administrar.</div>'
        + '</div>', acoes: [{ texto: 'Fechar', valor: null, tipo: 'ghost' }] });
    }
  });
}

/* ------------------------------------------------------------------- listas */

function rotuloDia(iso) {
  if (iso === hojeISO()) return 'hoje, ' + fmtData(iso);
  const d = new Date(iso + 'T12:00:00');
  const dif = Math.round((Date.now() - d.getTime()) / 86400000);
  if (dif === 1) return 'ontem, ' + fmtData(iso);
  return fmtData(iso);
}

function pendentesDoDia(iso) {
  const alvo = new Date(iso + 'T23:59:59').getTime();
  const registradas = new Set(
    estado.doses.filter((d) => new Date(d.horario).toISOString().slice(0, 10) === iso)
      .map((d) => d.medicamentoId + '|' + d.janela)
  );
  const saida = [];
  for (const m of estado.medicamentos.filter((x) => x.ativo !== false)) {
    const dow = new Date(iso + 'T12:00:00').getDay();
    if (m.diasSemana && m.diasSemana.length && !m.diasSemana.includes(dow)) continue;
    for (const h of (m.horarios || [])) {
      if (registradas.has(m.id + '|' + h)) continue;
      const quando = new Date(iso + 'T' + h + ':00').getTime();
      // doses cujo horário já passou (ou é de hoje)
      if (quando <= alvo && (iso !== hojeISO() || true)) {
        saida.push({ medicamento: m, horario: h, quando, atrasado: quando < Date.now() - 900000 && iso === hojeISO() });
      }
    }
  }
  return saida.sort((a, b) => a.quando - b.quando);
}

function registradasDoDia(iso) {
  return estado.doses
    .filter((d) => new Date(d.horario).toISOString().slice(0, 10) === iso)
    .sort((a, b) => b.horario - a.horario);
}

function barraProgresso(feito, total) {
  const pct = total ? Math.round((feito / total) * 100) : 0;
  return '<div><div style="height:9px;background:var(--surface-3);border-radius:99px;overflow:hidden">'
    + '<div style="height:100%;width:' + pct + '%;background:' + (pct === 100 ? 'var(--ok)' : 'var(--brand)')
    + ';border-radius:99px;transition:width .3s"></div></div>'
    + '<div class="tiny muted center" style="margin-top:5px">' + pct + '% do dia registrado</div></div>';
}

function cartaoPendente(p) {
  const pac = paciente(p.medicamento.pacienteId);
  const atrasado = p.atrasado;
  return '<div class="item" style="border-left:4px solid ' + (atrasado ? 'var(--danger)' : pac.cor) + '">'
    + '<div class="item-main">'
    +   '<div class="item-title">' + esc(p.medicamento.nome) + ' <span class="mono muted" style="font-weight:600">'
    +     esc(p.medicamento.dose || '') + '</span>'
    +     (p.medicamento.controlado ? ' <span class="pill warn">controlado</span>' : '') + '</div>'
    +   '<div class="item-meta">'
    +     '<span class="pill" style="color:' + pac.cor + ';border-color:' + pac.cor + '">' + pac.avatarEmoji + ' ' + esc(pac.nome.split(' ')[0]) + '</span>'
    +     '<span>🕒 ' + esc(p.horario) + '</span>'
    +     '<span class="' + (atrasado ? 'strong' : 'muted') + '"' + (atrasado ? ' style="color:var(--danger)"' : '') + '>'
    +       esc(atrasado ? 'atrasada ' + relativo(p.quando) : relativo(p.quando)) + '</span>'
    +   '</div>'
    +   '<div class="item-actions">'
    +     (pode('escrever') ? '<button class="btn btn-sm btn-ok" data-acao="dar" data-id="' + esc(p.medicamento.id) + '" data-janela="' + esc(p.horario) + '">✓ Dar agora</button>' : '')
    +     '<button class="btn btn-sm btn-ghost" data-acao="info" data-id="' + esc(p.medicamento.id) + '">Detalhes</button>'
    +   '</div>'
    + '</div></div>';
}

function cartaoMedicacao(m) {
  const pac = paciente(m.pacienteId);
  return '<div class="item" style="padding:12px 14px">'
    + '<div class="item-bar" style="background:' + pac.cor + '"></div>'
    + '<div class="item-main">'
    +   '<div class="item-title" style="font-size:.9rem">' + esc(m.nome) + '</div>'
    +   '<div class="item-meta"><span class="mono">' + esc(m.dose || '') + '</span>'
    +   '<span>' + esc((m.horarios || []).join(' · ')) + '</span>'
    +   '<span class="pill ghost" style="color:' + pac.cor + '">' + pac.avatarEmoji + ' ' + esc(pac.nome.split(' ')[0]) + '</span></div>'
    +   '<div class="item-actions"><button class="btn btn-sm btn-ghost" data-acao="info" data-id="' + esc(m.id) + '">Detalhes</button></div>'
    + '</div></div>';
}

/* ------------------------------------------------------------------- adesão */

function adesao() {
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const esperado = esperadoDoDia(iso);
    const feito = registradasDoDia(iso).length;
    dias.push({ iso, esperado, feito, pct: esperado ? Math.min(100, Math.round((feito / esperado) * 100)) : 100 });
  }
  const media = Math.round(dias.reduce((s, d) => s + d.pct, 0) / dias.length);
  return '<div class="section-title">📊 Adesão dos últimos 7 dias</div>'
    + '<div class="card card-body stack">'
    + '<div class="row-between"><span class="small muted">Média do período</span>'
    + '<span class="strong" style="color:' + (media >= 90 ? 'var(--ok)' : media >= 70 ? 'var(--warn)' : 'var(--danger)') + '">' + media + '%</span></div>'
    + '<div class="row" style="gap:6px;align-items:flex-end;height:74px">'
    + dias.map((d) => '<div class="grow center" title="' + fmtData(d.iso) + '">'
      + '<div style="height:' + Math.max(4, d.pct * 0.55) + 'px;background:'
      + (d.pct >= 90 ? 'var(--ok)' : d.pct >= 70 ? 'var(--warn)' : 'var(--danger)')
      + ';border-radius:6px 6px 3px 3px"></div>'
      + '<div class="tiny muted" style="margin-top:4px">' + esc(d.iso.slice(8) + '/' + d.iso.slice(5, 7)) + '</div></div>').join('')
    + '</div>'
    + '<p class="tiny muted">Adesão baixa em um horário costuma indicar que o esquema está difícil de seguir — vale revisar com o médico, não apenas insistir.</p>'
    + '</div>';
}

function esperadoDoDia(iso) {
  let total = 0;
  const dow = new Date(iso + 'T12:00:00').getDay();
  for (const m of estado.medicamentos.filter((x) => x.ativo !== false)) {
    if (m.diasSemana && m.diasSemana.length && !m.diasSemana.includes(dow)) continue;
    total += (m.horarios || []).length;
  }
  return total;
}

/* ------------------------------------------------------------------- ações */

async function registrar(medicamentoId, janela, host) {
  const m = porId('medicamentos', medicamentoId);
  if (!m) return;
  inserir('doses', {
    id: novoId('dose'), medicamentoId, pacienteId: m.pacienteId, janela,
    horario: Date.now(), registradoPor: sessao.membro.id, registradoPorNome: sessao.membro.nome,
  });
  auditar('dose-registrada', m.nome + ' (' + janela + ')', m.pacienteId);
  toast('✓ ' + m.nome + ' registrado.', 'ok');
  atualizarBadges();
  render(host);
}

async function desfazer(doseId, host) {
  const d = porId('doses', doseId);
  if (!d) return;
  if (!await confirmar('Desfazer registro?', 'A dose voltará a aparecer como pendente.', 'Desfazer')) return;
  const m = porId('medicamentos', d.medicamentoId);
  remover('doses', doseId);
  auditar('dose-desfeita', m ? m.nome : doseId, d.pacienteId);
  toast('Registro desfeito.');
  atualizarBadges();
  render(host);
}

async function abrirNovaMedicacao() {
  const r = await modal({
    titulo: 'Nova medicação',
    corpo: '<div class="stack">'
      + campoSelect({ id: 'f-pacienteId', label: 'Paciente', vazio: 'Escolha', obrigatorio: true,
          opcoes: estado.pacientes.map((p) => ({ valor: p.id, texto: p.avatarEmoji + ' ' + p.nome })) })
      + campoTexto({ id: 'f-nome', label: 'Medicamento', obrigatorio: true, placeholder: 'Ex.: Losartana 50mg' })
      + '<div class="grid grid-2" style="gap:12px">'
      + campoTexto({ id: 'f-dose', label: 'Dose', placeholder: '1 comprimido' })
      + campoSelect({ id: 'f-via', label: 'Via', valor: 'oral', vazio: null,
          opcoes: ['oral', 'sublingual', 'injetável', 'tópica', 'inalatória', 'sonda'] })
      + '</div>'
      + campoTexto({ id: 'f-horarios', label: 'Horários', obrigatorio: true, placeholder: '08:00, 20:00',
          dica: 'Separe por vírgula.' })
      + campoTexto({ id: 'f-indicacao', label: 'Para quê', placeholder: 'pressão alta' })
      + campoTexto({ id: 'f-prescricaoPor', label: 'Prescrito por' })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Cadastrar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;
  if (!d.pacienteId || !d.nome || !d.horarios) return toast('Preencha paciente, medicamento e horários.', 'warn');
  d.horarios = d.horarios.split(',').map((h) => h.trim()).filter(Boolean)
    .map((h) => { const [a, b] = h.split(':'); return String(a || '').padStart(2, '0') + ':' + String(b || '00').padStart(2, '0'); });
  inserir('medicamentos', { id: novoId('med'), ...d, ativo: true });
  auditar('medicacao-criada', d.nome, d.pacienteId);
  toast('Medicação cadastrada.', 'ok');
  atualizarBadges();
  render(document.getElementById('view'));
}
