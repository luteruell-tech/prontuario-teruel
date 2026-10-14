/* ============================================================================
 * Tela · Sinais vitais  (assets/js/views/sinais.js)
 * ----------------------------------------------------------------------------
 * Pressão, glicemia, peso, temperatura, saturação, frequência cardíaca e dor.
 * Gráfico feito à mão em canvas (sem biblioteca externa) com faixas de
 * referência desenhadas — a família enxerga tendência, não número solto.
 * ==========================================================================*/

'use strict';

import { estado, inserir, remover, auditar, novoId, sessao, ultimosSinais } from '../store.js';
import { pode } from '../auth.js';
import {
  esc, $, modal, confirmar, toast, vazio, fmtData, fmtDataHora, relativo, paraData,
  paciente, campoTexto, campoSelect, campoArea,
} from '../ui.js';

const TIPOS = {
  pa:          { nome: 'Pressão arterial', unidade: 'mmHg',  icone: '🩸', cor: '#B62A2A', min: 90,  max: 140, composto: true },
  glicemia:    { nome: 'Glicemia',         unidade: 'mg/dL', icone: '🍬', cor: '#8A5A00', min: 70,  max: 180 },
  peso:        { nome: 'Peso',             unidade: 'kg',    icone: '⚖️', cor: '#1440BE', min: null, max: null },
  temperatura: { nome: 'Temperatura',      unidade: '°C',    icone: '🌡️', cor: '#0A6F73', min: 35.5, max: 37.5 },
  saturacao:   { nome: 'Saturação O₂',     unidade: '%',     icone: '💨', cor: '#0A7B6B', min: 92,  max: 100 },
  fc:          { nome: 'Freq. cardíaca',   unidade: 'bpm',   icone: '❤️', cor: '#C13030', min: 55,  max: 100 },
  dor:         { nome: 'Dor (0 a 10)',     unidade: '/10',   icone: '😖', cor: '#9A6500', min: 0,   max: 5 },
};

let pacFiltro = null;
let tipoFiltro = 'pa';

export function render(host) {
  if (!pacFiltro) pacFiltro = estado.pacientes[0].id;

  host.innerHTML = '<div class="wrap stack">'
    + '<div class="row-between">'
    +   '<div><h1>Sinais vitais</h1><p class="muted small">Medições e evolução</p></div>'
    +   (pode('escrever') ? '<button class="btn btn-primary" data-acao="novo">＋ Medir</button>' : '')
    + '</div>'
    + '<div class="pac-tabs">' + estado.pacientes.map((p) =>
        '<button class="pac-tab' + (pacFiltro === p.id ? ' on' : '') + '" data-pac="' + esc(p.id) + '">'
        + p.avatarEmoji + ' ' + esc(p.nome.split(' ')[0]) + '</button>').join('') + '</div>'
    + '<div class="pac-tabs" style="margin-top:-4px">' + Object.entries(TIPOS).map(([k, t]) =>
        '<button class="pac-tab' + (tipoFiltro === k ? ' on' : '') + '" data-tipo="' + k + '">' + t.icone + ' ' + esc(t.nome.split(' ')[0]) + '</button>').join('') + '</div>'
    + '<div id="painel"></div>'
    + '</div>';

  pintar(host);

  host.addEventListener('click', (ev) => {
    const p = ev.target.closest('[data-pac]');
    if (p) { pacFiltro = p.dataset.pac; render(host); return; }
    const t = ev.target.closest('[data-tipo]');
    if (t) { tipoFiltro = t.dataset.tipo; render(host); return; }
    const ac = ev.target.closest('[data-acao]');
    if (!ac) return;
    if (ac.dataset.acao === 'novo') formNovo(host);
    else if (ac.dataset.acao === 'excluir') excluir(ac.dataset.id, host);
  });

  // redesenha o gráfico ao girar o celular / redimensionar
  let t = null;
  const redim = () => { clearTimeout(t); t = setTimeout(() => pintar(host), 180); };
  window.addEventListener('resize', redim, { once: true });
}

function pintar(host) {
  const p = paciente(pacFiltro);
  const t = TIPOS[tipoFiltro];
  const serie = estado.sinais
    .filter((s) => s.pacienteId === pacFiltro && s.tipo === tipoFiltro)
    .sort((a, b) => a.medidoEm - b.medidoEm);

  const box = $('#painel', host);
  box.innerHTML = '<div class="stack">'
    + cartaoResumo(p, t, serie)
    + '<div class="card"><div class="card-head"><h3>' + t.icone + ' Evolução · ' + esc(t.nome) + '</h3>'
    + '<span class="pill">' + serie.length + ' medição(ões)</span></div>'
    + '<div class="card-body">'
    + (serie.length >= 2 ? '<div class="chart-box"><canvas id="graf" height="230"></canvas></div>'
        : '<p class="muted small center" style="padding:24px 0">'
          + (serie.length ? 'Com duas ou mais medições aparece o gráfico de evolução.' : 'Nenhuma medição registrada para este sinal.')
          + '</p>')
    + (pode('escrever') ? '<button class="btn btn-soft btn-block" style="margin-top:14px" data-acao="novo">＋ Registrar medição</button>' : '')
    + '</div></div>'
    + '<div class="section-title">Histórico</div>'
    + (serie.length
      ? '<div class="card"><div class="table-wrap"><table class="table">'
        + '<thead><tr><th>Quando</th><th>Valor</th><th>Situação</th><th>Quem mediu</th><th></th></tr></thead><tbody>'
        + [...serie].reverse().slice(0, 60).map((s) => {
          const num = parseFloat(String(s.valor).replace(',', '.'));
          let sit = '<span class="pill ok">dentro da faixa</span>';
          if (tipoFiltro === 'pa') {
            const m = String(s.valor).match(/(\d+)\s*\/\s*(\d+)/);
            if (m && (Number(m[1]) >= 140 || Number(m[2]) >= 90)) sit = '<span class="pill danger">acima do alvo</span>';
            else if (m && (Number(m[1]) < 90 || Number(m[2]) < 60)) sit = '<span class="pill warn">baixa</span>';
          } else if (t.max != null && num > t.max) sit = '<span class="pill danger">acima</span>';
          else if (t.min != null && num < t.min) sit = '<span class="pill warn">abaixo</span>';
          return '<tr><td class="small">' + esc(fmtDataHora(s.medidoEm)) + '</td>'
            + '<td class="mono strong">' + esc(s.valor) + ' <span class="muted" style="font-weight:400">' + esc(s.unidade || t.unidade) + '</span></td>'
            + '<td>' + sit + '</td>'
            + '<td class="small muted">' + esc(s.registradoPorNome || '—') + '</td>'
            + '<td>' + (pode('excluir') ? '<button class="btn btn-sm btn-ghost" data-acao="excluir" data-id="' + esc(s.id) + '">🗑</button>' : '') + '</td></tr>';
        }).join('')
        + '</tbody></table></div></div>'
      : '<div class="card card-pad"><p class="muted small">Sem medições deste sinal. '
        + (pode('escrever') ? 'Registre a primeira para começar o acompanhamento.' : '') + '</p></div>')
    + '</div>';

  if (serie.length >= 2) desenharGrafico(serie, t);
}

function cartaoResumo(p, t, serie) {
  const ult = serie[serie.length - 1];
  const anterior = serie[serie.length - 2];
  const num = ult ? parseFloat(String(ult.valor).replace(',', '.')) : null;
  let cor = 'var(--ink)';
  if (ult) {
    if (tipoFiltro === 'pa') {
      const m = String(ult.valor).match(/(\d+)\s*\/\s*(\d+)/);
      if (m && (Number(m[1]) >= 140 || Number(m[2]) >= 90)) cor = 'var(--danger)';
    } else if (t.max != null && num > t.max) cor = 'var(--danger)';
    else if (t.min != null && num < t.min) cor = 'var(--warn)';
    else cor = 'var(--ok)';
  }
  const variacao = (ult && anterior)
    ? (() => {
        const a = parseFloat(String(anterior.valor).replace(',', '.'));
        if (isNaN(a) || isNaN(num)) return '';
        const dif = num - a;
        if (Math.abs(dif) < 0.05) return '<span class="pill">estável</span>';
        return '<span class="pill ' + (dif > 0 ? 'warn' : 'info') + '">'
          + (dif > 0 ? '▲ subiu ' : '▼ desceu ') + Math.abs(dif).toFixed(1) + '</span>';
      })() : '';

  return '<div class="card card-pad" style="border-left:5px solid ' + p.cor + '">'
    + '<div class="row-between" style="align-items:flex-start">'
    +   '<div>'
    +     '<div class="tiny muted" style="font-weight:700;text-transform:uppercase;letter-spacing:.05em">'
    +       esc(t.nome) + ' · ' + esc(p.nome.split(' ')[0]) + '</div>'
    +     '<div class="kpi-n" style="color:' + cor + ';margin-top:5px">' + (ult ? esc(ult.valor) : '—')
    +       '<span style="font-size:.9rem;font-weight:600;color:var(--ink-3);margin-left:6px">' + esc(t.unidade) + '</span></div>'
    +     '<div class="row-wrap" style="margin-top:7px">' + variacao
    +       (ult ? '<span class="pill ghost">' + esc(relativo(ult.medidoEm)) + '</span>' : '') + '</div>'
    +   '</div>'
    +   '<div style="font-size:2rem">' + t.icone + '</div>'
    + '</div>'
    + (t.min != null || t.max != null
      ? '<div class="tiny muted" style="margin-top:11px;padding-top:10px;border-top:1px solid var(--line)">'
        + 'Faixa de referência: ' + (t.min != null ? t.min : '—') + ' a ' + (t.max != null ? t.max : '—') + ' ' + esc(t.unidade)
        + (tipoFiltro === 'pa' ? ' (alvo usual abaixo de 140/90 — confirme com o médico)' : '')
        + '</div>' : '')
    + '</div>';
}

/* ------------------------------------------------------------------ gráfico */

function desenharGrafico(serie, t) {
  const canvas = document.getElementById('graf');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const largura = canvas.parentElement.clientWidth - 20;
  const altura = 230;
  canvas.width = largura * dpr; canvas.height = altura * dpr;
  canvas.style.width = largura + 'px'; canvas.style.height = altura + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const pontos = serie.map((s) => {
    const v = tipoFiltro === 'pa' ? parseFloat(String(s.valor).split('/')[0]) : parseFloat(String(s.valor).replace(',', '.'));
    return { x: s.medidoEm, y: v, bruto: s.valor };
  }).filter((p) => !isNaN(p.y));

  if (pontos.length < 2) return;

  const pad = { l: 46, r: 16, t: 20, b: 40 };
  const PW = largura - pad.l - pad.r;
  const PH = altura - pad.t - pad.b;

  const ys = pontos.map((p) => p.y);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (t.min != null) minY = Math.min(minY, t.min);
  if (t.max != null) maxY = Math.max(maxY, t.max);
  const folga = (maxY - minY) * 0.15 || 1;
  minY -= folga; maxY += folga;

  const xs = pontos.map((p) => p.x);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const px = (x) => pad.l + (maxX === minX ? PW / 2 : PW * (x - minX) / (maxX - minX));
  const py = (y) => pad.t + PH * (1 - (y - minY) / (maxY - minY));

  ctx.clearRect(0, 0, largura, altura);

  // grade + eixo Y
  ctx.strokeStyle = '#DCE1EC'; ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace,monospace'; ctx.fillStyle = '#9AA7B8';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + PH * (i / 4);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + PW, y); ctx.stroke();
    const val = maxY - (maxY - minY) * (i / 4);
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(val < 10 ? 1 : 0), pad.l - 6, y + 3);
  }

  // faixa de referência
  if (t.min != null && t.max != null) {
    const yTopo = py(Math.min(t.max, maxY));
    const yBase = py(Math.max(t.min, minY));
    ctx.fillStyle = 'rgba(18,114,60,.07)';
    ctx.fillRect(pad.l, yTopo, PW, Math.max(1, yBase - yTopo));
  }
  if (t.max != null) {
    const y = py(t.max);
    if (y > pad.t && y < pad.t + PH) {
      ctx.strokeStyle = 'rgba(182,42,42,.45)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + PW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#B62A2A'; ctx.font = '500 9px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('alvo ' + t.max, pad.l + 5, y - 4);
    }
  }

  // linha
  ctx.strokeStyle = t.cor; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  ctx.beginPath();
  pontos.forEach((p, i) => { const X = px(p.x), Y = py(p.y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
  ctx.stroke();

  // área suave
  ctx.lineTo(px(pontos[pontos.length - 1].x), pad.t + PH);
  ctx.lineTo(px(pontos[0].x), pad.t + PH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + PH);
  grad.addColorStop(0, t.cor + '2E'); grad.addColorStop(1, t.cor + '00');
  ctx.fillStyle = grad; ctx.fill();

  // pontos + rótulo do último (só o último evita poluição visual)
  pontos.forEach((p, i) => {
    const X = px(p.x), Y = py(p.y);
    ctx.beginPath(); ctx.arc(X, Y, i === pontos.length - 1 ? 5.5 : 3.4, 0, Math.PI * 2);
    ctx.fillStyle = t.cor; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  });
  const ultimo = pontos[pontos.length - 1];
  ctx.fillStyle = t.cor; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(ultimo.bruto, px(ultimo.x), py(ultimo.y) - 12);

  // eixo X (até 5 rótulos)
  ctx.fillStyle = '#9AA7B8'; ctx.font = '10px ui-monospace,monospace'; ctx.textAlign = 'center';
  const passo = Math.max(1, Math.ceil(pontos.length / 5));
  pontos.forEach((p, i) => {
    if (i % passo && i !== pontos.length - 1) return;
    const d = new Date(p.x);
    ctx.fillText(String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'), px(p.x), altura - 14);
  });
}

/* ------------------------------------------------------------------- ações */

async function formNovo(host) {
  const t = TIPOS[tipoFiltro];
  const ultimo = estado.sinais.filter((s) => s.pacienteId === pacFiltro && s.tipo === tipoFiltro).slice(-1)[0];
  const r = await modal({
    titulo: 'Registrar ' + t.nome.toLowerCase(),
    corpo: '<div class="stack">'
      + campoSelect({ id: 'f-pacienteId', label: 'Paciente', valor: pacFiltro, vazio: null,
          opcoes: estado.pacientes.map((p) => ({ valor: p.id, texto: p.avatarEmoji + ' ' + p.nome })) })
      + campoSelect({ id: 'f-tipo', label: 'Sinal', valor: tipoFiltro, vazio: null,
          opcoes: Object.entries(TIPOS).map(([k, v]) => ({ valor: k, texto: v.icone + ' ' + v.nome })) })
      + campoTexto({ id: 'f-valor', label: 'Valor medido', obrigatorio: true,
          placeholder: tipoFiltro === 'pa' ? '140/90' : 'Ex.: 12.5',
          dica: 'No caso da pressão, use o formato 120/80.' + (ultimo ? ' Última medição: ' + ultimo.valor : '') })
      + campoTexto({ id: 'f-medidoEm', label: 'Quando foi medido', tipo: 'datetime-local',
          valor: paraInputAgora(), obrigatorio: true })
      + campoArea({ id: 'f-nota', label: 'Observação', linhas: 2,
          placeholder: 'Ex.: medido antes do remédio, estava nervosa' })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;
  if (!d.valor) return toast('Informe o valor medido.', 'warn');

  inserir('sinais', {
    id: novoId('sig'), pacienteId: d.pacienteId, tipo: d.tipo, valor: d.valor,
    unidade: TIPOS[d.tipo].unidade, nota: d.nota,
    medidoEm: d.medidoEm ? new Date(d.medidoEm).getTime() : Date.now(),
    registradoPor: sessao.membro.id, registradoPorNome: sessao.membro.nome,
  });
  auditar('sinal-registrado', TIPOS[d.tipo].nome + ': ' + d.valor, d.pacienteId);
  toast('Medição registrada.', 'ok');
  pacFiltro = d.pacienteId; tipoFiltro = d.tipo;
  render(host);
}

function paraInputAgora() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

async function excluir(id, host) {
  const s = estado.sinais.find((x) => x.id === id);
  if (!s) return;
  if (!await confirmar('Excluir medição?', s.valor + ' ' + (s.unidade || '') + ' de ' + fmtDataHora(s.medidoEm) + ' será removida.', 'Excluir')) return;
  remover('sinais', id);
  auditar('sinal-excluido', s.valor, s.pacienteId);
  toast('Medição excluída.');
  render(host);
}
