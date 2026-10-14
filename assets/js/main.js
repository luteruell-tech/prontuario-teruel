/* ============================================================================
 * TERUEL · Inicialização do app  (assets/js/main.js)
 * ----------------------------------------------------------------------------
 * Fluxo de entrada:
 *   1. Existe cofre neste aparelho?
 *        não → tela de criação (primeiro membro) ou importação de convite
 *        sim → escolher o membro e digitar o PIN
 *   2. Abre o cofre, decifra os dados e monta a interface
 *   3. Registra as rotas e liga o bloqueio automático por inatividade
 * ==========================================================================*/

'use strict';

import {
  existeCofre, membrosPublicos, lerCofre, sessao, estado, salvar, auditar,
} from './store.js';
import {
  criarCofre, entrar, PAPEIS, ligarBloqueioAutomatico, importarConvite, sair,
} from './auth.js';
import { pinStrength, suggestPin } from './crypto.js';
import {
  esc, $, modal, toast, desenharShell, registrarRota, renderRota, irPara,
  vazio, campoTexto, campoSelect, campoArea, paramsAtuais, atualizarBadges,
} from './ui.js';

/* ------------------------------------------------------------- telas (views) */
import * as painel from './views/painel.js';
import * as agenda from './views/agenda.js';
import * as prontuario from './views/prontuario.js';
import * as medicamentos from './views/medicamentos.js';
import * as exames from './views/exames.js';
import * as sinais from './views/sinais.js';
import * as documentos from './views/documentos.js';
import * as mural from './views/mural.js';
import * as dor from './views/dor.js';
import * as equipe from './views/equipe.js';
import * as auditoria from './views/auditoria.js';
import * as ajustes from './views/ajustes.js';

/* =========================================================================
 * ROTAS
 * ======================================================================= */
const MENU = [
  { rota: 'painel',       titulo: 'Painel',     icone: '🏠', def: painel },
  { rota: 'agenda',       titulo: 'Agenda',     icone: '📅', def: agenda },
  { rota: 'prontuario',   titulo: 'Prontuário', icone: '📋', def: prontuario },
  { rota: 'medicamentos', titulo: 'Medicações', icone: '💊', def: medicamentos },
  { rota: 'sinais',       titulo: 'Sinais',     icone: '📈', def: sinais },
  { rota: 'exames',       titulo: 'Exames',     icone: '🔬', def: exames },
  { rota: 'documentos',   titulo: 'Documentos', icone: '📄', def: documentos },
  { rota: 'mural',        titulo: 'Mural',      icone: '💬', def: mural },
  { rota: 'dor',          titulo: 'Rede D\'Or', icone: '🏥', def: dor },
  { rota: 'equipe',       titulo: 'Equipe',     icone: '👥', def: equipe, permissao: 'gerirEquipe' },
  { rota: 'auditoria',    titulo: 'Auditoria',  icone: '📋', def: auditoria, permissao: 'verAuditoria' },
  { rota: 'ajustes',      titulo: 'Ajustes',    icone: '⚙️', def: ajustes },
];

/* =========================================================================
 * 1. TELA DE ENTRADA (sem cofre)
 * ======================================================================= */
function telaBoasVindas() {
  document.body.innerHTML =
    '<div class="gate"><div class="gate-card">'
    + '<div class="gate-top">'
    +   '<div class="gate-mark">🩺</div>'
    +   '<div class="gate-title">Canal Teruel</div>'
    +   '<div class="gate-sub">Acompanhamento de Maria Izaulina e João Teruel,'
    +     ' reunido num só lugar e protegido pela família.</div>'
    + '</div>'
    + '<div class="gate-body">'
    +   '<div class="note"><div class="note-title">🔐 Como a proteção funciona</div>'
    +     'Tudo o que a família registrar fica <b>cifrado neste aparelho</b> com uma chave que só existe '
    +     'aqui dentro. Cada pessoa entra com o <b>próprio PIN</b>. Sem o PIN, ninguém lê — nem quem '
    +     'copiar os arquivos do celular.</div>'
    +   '<button class="btn btn-primary btn-lg btn-block" id="criar">🏛 Criar o canal da família</button>'
    +   '<button class="btn btn-ghost btn-block" id="convite">📥 Já tenho um convite</button>'
    +   '<p class="tiny muted center" style="margin-top:4px">Crie num aparelho e convide os outros depois. '
    +     'Nada é enviado para servidor nenhum.</p>'
    + '</div>'
    + '</div></div>';

  $('#criar').onclick = telaCriarCofre;
  $('#convite').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const arq = input.files && input.files[0];
      if (!arq) return;
      try {
        importarConvite(await arq.text());
        toast('Convite importado! Entre com o seu PIN.', 'ok', 5000);
        telaEntrar();
      } catch (e) { toast(e.message, 'danger', 7000); }
    });
    input.click();
  };
}

async function telaCriarCofre() {
  const pinSugerido = suggestPin(6);
  const r = await modal({
    titulo: 'Criar o canal da família',
    corpo: '<div class="stack">'
      + '<div class="note info"><div class="note-title">Você será o(a) gestor(a)</div>'
      +   'Como gestor(a), você adiciona e remove o acesso das outras pessoas, guarda as credenciais do '
      +     'portal e vê a auditoria. Depois você pode passar o papel para outro membro.</div>'
      + campoTexto({ id: 'f-nomeCanal', label: 'Nome do canal', valor: 'Canal Teruel',
          dica: 'É o título que aparece no topo do app.' })
      + campoTexto({ id: 'f-nome', label: 'Seu nome', obrigatorio: true, placeholder: 'Ex.: Luciana Teruel' })
      + '<div class="grid grid-2" style="gap:12px">'
      + campoTexto({ id: 'f-emoji', label: 'Seu emoji', valor: '🙂' })
      + campoTexto({ id: 'f-cor', label: 'Sua cor', valor: '#1440BE', tipo: 'color' })
      + '</div>'
      + campoTexto({ id: 'f-pin', label: 'Seu PIN', valor: pinSugerido, obrigatorio: true, tipo: 'password',
          dica: 'Mínimo 6 caracteres. Este PIN abre o cofre — anote em local físico seguro.' })
      + campoTexto({ id: 'f-pin2', label: 'Repita o PIN', valor: pinSugerido, obrigatorio: true, tipo: 'password' })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Criar canal', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;

  if (!d.nome) return toast('Informe o seu nome.', 'warn');
  if (d.pin !== d.pin2) return toast('Os PINs não conferem.', 'warn');
  const forca = pinStrength(d.pin);
  if (!forca.ok) return toast('PIN ' + forca.label.toLowerCase() + ': use 6 ou mais caracteres.', 'warn', 6000);

  try {
    const { chaveRecuperacao, fingerprint } = await criarCofre({
      nomeCanal: d.nomeCanal || 'Canal Teruel',
      membro: { nome: d.nome, papel: 'admin', avatarEmoji: d.emoji || '🙂', cor: d.cor || '#1440BE', pin: d.pin },
    });

    await modal({
      titulo: '⚠️ Guarde a chave de recuperação',
      corpo: '<div class="stack">'
        + '<div class="note danger"><div class="note-title">Esta é a única vez que ela aparece</div>'
        +   'Se todos esquecerem os PINs, <b>só esta chave</b> abre o cofre. Sem ela, os dados são '
        +     'matematicamente irrecuperáveis — nem nós conseguimos abrir.</div>'
        + '<div style="background:var(--surface-2);border:2px dashed var(--line-strong);border-radius:var(--r);padding:18px;text-align:center">'
        +   '<div class="tiny muted" style="font-weight:700;margin-bottom:6px">CHAVE DE RECUPERAÇÃO</div>'
        +   '<div class="mono strong" style="font-size:1.05rem;letter-spacing:.06em;word-break:break-all">'
        +   esc(chaveRecuperacao) + '</div></div>'
        + '<div class="note warn"><div class="note-title">O que fazer agora</div>'
        +   'Escreva num papel, guarde num lugar físico seguro (não no celular) e informe outro membro '
        +     'de confiança. Um cofre de família não pode depender de uma única pessoa.</div>'
        + '<div class="row-between"><span class="small muted">Identificador do cofre</span>'
        +   '<span class="mono strong small">' + esc(fingerprint) + '</span></div>'
        + '</div>',
      acoes: [{ texto: 'Anotei a chave', valor: true, tipo: 'primary' }],
    });

    toast('Canal criado. Bem-vindo(a)!', 'ok', 4000);
    iniciar();
  } catch (e) {
    toast(e.message, 'danger', 6000);
  }
}

/* =========================================================================
 * 2. TELA DE ENTRADA (com cofre existente)
 * ======================================================================= */
function telaEntrar(mensagem) {
  const membros = membrosPublicos().filter((m) => m.ativo !== false);
  const cofre = lerCofre();

  if (!membros.length) {
    document.body.innerHTML = '<div class="gate"><div class="gate-card"><div class="gate-top">'
      + '<div class="gate-mark">⚠️</div><div class="gate-title">Nenhum acesso ativo</div>'
      + '<div class="gate-sub">Todos os membros deste canal foram desativados.</div></div>'
      + '<div class="gate-body"><button class="btn btn-ghost btn-block" onclick="location.reload()">Voltar</button></div>'
      + '</div></div>';
    return;
  }

  let escolhido = membros.length === 1 ? membros[0] : null;
  let valor = '';

  document.body.innerHTML =
    '<div class="gate"><div class="gate-card">'
    + '<div class="gate-top">'
    +   '<div class="gate-mark">🔐</div>'
    +   '<div class="gate-title">' + esc(cofre?.nome || 'Canal Teruel') + '</div>'
    +   '<div class="gate-sub">' + (escolhido ? 'Digite o seu PIN para abrir o cofre.' : 'Quem está entrando?') + '</div>'
    + '</div>'
    + '<div class="gate-body">'
    +   (mensagem ? '<div class="note warn"><div class="note-title">' + esc(mensagem.titulo) + '</div>' + esc(mensagem.texto) + '</div>' : '')
    +   (membros.length > 1 && !escolhido
        ? '<div class="member-grid">' + membros.map((m) =>
            '<button class="member-pick" data-id="' + esc(m.id) + '">'
            + '<div class="avatar" style="background:' + esc(m.cor || 'var(--brand)') + '">' + (m.avatarEmoji || '🙂') + '</div>'
            + '<div class="member-name">' + esc(m.nome.split(' ')[0]) + '</div>'
            + '<div class="member-role">' + esc((PAPEIS[m.papel] || {}).nome || '') + '</div>'
            + '</button>').join('') + '</div>'
        : formPin())
    + '</div>'
    + '</div></div>';

  if (membros.length === 1) {
    const inp = $('#pin-input');
    if (inp) setTimeout(() => inp.focus(), 120);
  }

  document.body.addEventListener('click', (ev) => {
    const pick = ev.target.closest('[data-id]');
    if (pick) {
      escolhido = membros.find((m) => m.id === pick.dataset.id);
      telaEntrar();
      return;
    }
    const voltar = ev.target.closest('[data-voltar]');
    if (voltar) { escolhido = membros.length === 1 ? membros[0] : null; valor = ''; telaEntrar(); }
  });

  const inp = $('#pin-input');
  if (inp) {
    inp.addEventListener('input', () => { valor = inp.value; pintarDots(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') tentarEntrar(); });
  }
  const btn = $('#btn-entrar');
  if (btn) btn.onclick = tentarEntrar;

  const rec = $('#btn-recuperar');
  if (rec) rec.onclick = telaRecuperacao;

  function pintarDots() {
    const total = Math.max(6, valor.length);
    const host = $('#pin-dots');
    if (!host) return;
    host.innerHTML = Array.from({ length: total }, (_, i) =>
      '<div class="pin-dot' + (i === valor.length ? ' on' : valor.length > i ? ' filled' : '') + '">'
      + (valor[i] ? '•' : '') + '</div>').join('');
  }

  async function tentarEntrar() {
    if (!escolhido) return toast('Escolha quem está entrando.', 'warn');
    if (!valor) return toast('Digite o PIN.', 'warn');
    const b = $('#btn-entrar');
    if (b) { b.disabled = true; b.textContent = 'Abrindo o cofre…'; }
    try {
      await entrar(escolhido.id, valor);
      iniciar();
    } catch (e) {
      if (b) { b.disabled = false; b.textContent = 'Entrar'; }
      valor = '';
      const inp2 = $('#pin-input');
      if (inp2) { inp2.value = ''; inp2.focus(); }
      pintarDots();
      toast(e.message, 'danger', 6000);
    }
  }

  function formPin() {
    return '<div class="stack">'
      + (membros.length > 1
          ? '<div class="row" style="gap:10px;justify-content:center"><div class="avatar" style="background:'
            + esc(escolhido.cor || 'var(--brand)') + '">' + (escolhido.avatarEmoji || '🙂') + '</div>'
            + '<div><div class="strong">' + esc(escolhido.nome) + '</div>'
            + '<div class="tiny muted">' + esc((PAPEIS[escolhido.papel] || {}).nome || '') + '</div></div>'
            + '<button class="btn btn-sm btn-ghost" data-voltar>trocar</button></div>'
          : '')
      + '<div class="pin-row" id="pin-dots"></div>'
      + '<input class="input center mono" id="pin-input" type="password" inputmode="numeric" '
      +   'autocomplete="off" placeholder="PIN" style="text-align:center;font-size:1.15rem;letter-spacing:.3em">'
      + '<button class="btn btn-primary btn-lg btn-block" id="btn-entrar">Entrar</button>'
      + '<button class="btn btn-ghost btn-sm btn-block" id="btn-recuperar">Esqueci meu PIN</button>'
      + '</div>';
  }
}

async function telaRecuperacao() {
  const r = await modal({
    titulo: 'Chave de recuperação',
    corpo: '<div class="stack">'
      + '<div class="note warn"><div class="note-title">Uso do gestor</div>'
      +   'A chave de recuperação abre o cofre quando os PINs são perdidos. Ela não substitui o acesso '
      +     'normal: depois de usá-la, redefina o PIN dos membros ativos.</div>'
      + campoTexto({ id: 'f-chave', label: 'Chave de recuperação', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Validar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados || !r.dados.chave) return;

  const { entrarComRecuperacao, redefinirPinDe } = await import('./auth.js');
  try {
    await entrarComRecuperacao(r.dados.chave);
  } catch (e) { return toast(e.message, 'danger', 6000); }

  // chave válida: permite redefinir o PIN de um membro a partir dela
  const membros = membrosPublicos();
  const r2 = await modal({
    titulo: 'Chave válida ✓',
    corpo: '<div class="stack">'
      + '<div class="note ok"><div class="note-title">Acesso confirmado</div>'
      +   'Agora defina um PIN novo para o membro que precisa entrar. A chave de recuperação não permite '
      +     'abrir a interface diretamente — ela devolve o controle para a família.</div>'
      + '</div>',
    acoes: [{ texto: 'Fechar', valor: true, tipo: 'ghost' }],
  });
  toast('Chave validada. Peça ao gestor para redefinir o PIN de quem perdeu o acesso.', 'ok', 8000);
}

/* =========================================================================
 * 3. INICIALIZAÇÃO
 * ======================================================================= */
function iniciar() {
  const m = sessao.membro;

  // monta o shell ANTES de registrar rotas (desenharShell limpa o body)
  const visiveis = MENU.filter((r) => !r.permissao || temPermissao(r.permissao));
  desenharShell(visiveis.map((r) => ({ rota: r.rota, titulo: r.titulo, icone: r.icone })));

  for (const r of MENU) {
    registrarRota(r.rota, {
      permissao: r.permissao || null,
      render: async (host, params) => { await r.def.render(host, params); atualizarBadges(); },
    });
  }

  window.addEventListener('hashchange', renderRota);
  if (!location.hash) location.hash = '#/painel';
  renderRota();

  // bloqueio por inatividade (15 min)
  ligarBloqueioAutomatico(() => {
    location.reload();
  });

  // pede troca de PIN quando o gestor redefiniu
  const cofre = lerCofre();
  const entrada = cofre && cofre.membros.find((x) => x.id === m.id);
  if (entrada && entrada.precisaTrocarPin) {
    setTimeout(() => pedirTrocaDePin(), 700);
  }

  // avisa sobre a sincronização se houver muita coisa e nenhuma sincronização
  setTimeout(() => {
    const total = estado.eventos.length + estado.doses.length + estado.sinais.length + estado.documentos.length;
    if (total > 0 && !estado.dor.ultimaSincronizacao && total > 4) {
      toast('Dica: abra Ajustes e exporte o pacote para manter a família em sincronia.', '', 7000);
    }
  }, 3000);

  auditar('sessao-iniciada', 'Interface carregada.');
  salvar();
}

function temPermissao(acao) {
  const mapa = {
    admin: ['gerirEquipe', 'gerirCredenciais', 'gerirConfig', 'excluir', 'verAuditoria', 'sincronizar', 'escrever', 'ver'],
    editor: ['verAuditoria', 'sincronizar', 'escrever', 'ver'],
    cuidador: ['escrever', 'ver'],
    leitor: ['ver'],
  };
  return (mapa[sessao.membro.papel] || []).includes(acao);
}

async function pedirTrocaDePin() {
  const { trocarMeuPin } = await import('./auth.js');
  const novo = suggestPin(6);
  const r = await modal({
    titulo: 'Defina um PIN só seu',
    corpo: '<div class="stack">'
      + '<div class="note"><div class="note-title">Por que agora</div>'
      +   'Seu acesso foi liberado pelo gestor com um PIN provisório. Escolha um PIN que só você conheça.</div>'
      + campoTexto({ id: 'f-atual', label: 'PIN provisório (o que você acabou de usar)', tipo: 'password', obrigatorio: true })
      + campoTexto({ id: 'f-novo', label: 'Seu PIN novo', valor: novo, tipo: 'password', obrigatorio: true })
      + campoTexto({ id: 'f-novo2', label: 'Repita o PIN novo', valor: novo, tipo: 'password', obrigatorio: true })
      + '</div>',
    acoes: [{ texto: 'Depois', valor: null, tipo: 'ghost' }, { texto: 'Trocar agora', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  if (r.dados.novo !== r.dados.novo2) return toast('Os PINs novos não conferem.', 'warn');
  try {
    await trocarMeuPin(r.dados.atual, r.dados.novo);
    toast('PIN definido. Guarde-o com cuidado.', 'ok', 5000);
  } catch (e) { toast(e.message, 'danger', 6000); }
}

/* =========================================================================
 * 4. PONTO DE PARTIDA
 * ======================================================================= */
function boot() {
  if (!window.isSecureContext) {
    document.body.innerHTML = '<div class="gate"><div class="gate-card"><div class="gate-top">'
      + '<div class="gate-mark">🔒</div><div class="gate-title">Precisa de conexão segura</div>'
      + '<div class="gate-sub">A criptografia do app exige HTTPS (ou localhost). Abra pelo link '
      + 'seguro que a família usa.</div></div></div>';
    return;
  }
  if (existeCofre()) telaEntrar();
  else telaBoasVindas();
}

/* serviço: registro do service worker (PWA offline) */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline é opcional */ });
  });
}

/* trava extra: ao sair da aba, não deixa tela de dados exposta ao voltar */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && sessao.pronto) {
    const t = Date.now();
    sessionStorage.setItem('teruel.ocultoEm', String(t));
  }
});

boot();

/* expõe para depuração no console do navegador */
window.TERUEL = { estado, sessao, sair, irPara, paramsAtuais };
