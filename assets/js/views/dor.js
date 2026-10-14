/* ============================================================================
 * Tela · Central Rede D'Or  (assets/js/views/dor.js)
 * ----------------------------------------------------------------------------
 * IMPORTANTE — leia antes de usar:
 *
 * A Rede D'Or NÃO publica uma API pública de pacientes. O acesso aos resultados
 * exige o login do próprio paciente no portal/app oficial, com proteção
 * anti-robô e dupla verificação. Por isso este app NÃO faz login automático
 * na conta de ninguém. O que ele faz:
 *
 *   1. Reúne os atalhos OFICIAIS (portal do paciente, app, Dora no WhatsApp).
 *   2. Guarda as credenciais do paciente CIFRADAS dentro do cofre da família,
 *      para não ficarem no bloco de notas do celular.
 *   3. Importa os laudos que o paciente baixa do portal — ficam junto do
 *      prontuário, disponíveis para toda a família e para o médico.
 *   4. Mantém uma lista de acompanhamento: o que já foi baixado, o que está
 *      pendente, e quando conferir de novo (lazy: sem cron, sem robô).
 *
 * Isso é o que é tecnicamente legítimo e seguro. Automatizar login em portal
 * de saúde quebraria os termos de uso, exigiria burlar a verificação em duas
 * etapas e exporia a senha do paciente — o oposto do objetivo aqui.
 * ==========================================================================*/

'use strict';

import {
  estado, inserir, atualizar, remover, auditar, novoId, porId, sessao,
  selarSegredo, abrirSegredo, guardarArquivo, abrirDocumento,
} from '../store.js';
import { pode } from '../auth.js';
import {
  esc, $, modal, confirmar, toast, vazio, fmtData, fmtDataHora, relativo,
  paciente, campoTexto, campoSelect, campoArea, irPara,
} from '../ui.js';

const CANAIS = [
  {
    nome: 'Portal do Paciente — Rede D\'Or',
    url: 'https://www.rededorsaoluiz.com.br/paciente/',
    o_que: 'Resultados de exames, laudos e imagens das unidades Rede D\'Or e Star.',
    como: 'Entre com o CPF e a senha do paciente. Em "Resultados de exames", escolha o exame e baixe o PDF.',
    icone: '💻',
  },
  {
    nome: 'App Rede D\'Or (celular)',
    url: 'https://www.rededorsaoluiz.com.br/app',
    o_que: 'Agendar consultas e exames, ver laudos e imagens, receber aviso quando o resultado sai.',
    como: 'Instale, faça login com o cadastro do paciente e ative as notificações. Depois baixe o laudo e envie aqui.',
    icone: '📱',
  },
  {
    nome: 'Dora — assistente no WhatsApp',
    url: 'https://www.rededorsaoluiz.com.br/dora',
    o_que: 'Consulta de documentos e agendamento pelo WhatsApp oficial da Rede D\'Or.',
    como: 'Útil para quem tem dificuldade com app. Não substitui o app para baixar laudos completos.',
    icone: '💬',
  },
  {
    nome: 'Área do Médico',
    url: 'https://www.rededorsaoluiz.com.br/medico',
    o_que: 'Acesso do profissional de saúde aos resultados dos pacientes dele.',
    como: 'Se o médico assistente usar, ele pode consultar os laudos direto com o CPF do paciente.',
    icone: '🩺',
  },
];

let aba = 'acompanhar';

export function render(host) {
  const cred = estado.dor.credenciais || {};
  const monitorias = estado.dor.monitorias || [];

  host.innerHTML = '<div class="wrap stack">'
    + '<div class="row-between">'
    +   '<div><h1>Rede D\'Or</h1><p class="muted small">Resultados, laudos e acompanhamento</p></div>'
    +   (pode('escrever') ? '<button class="btn btn-primary" data-acao="novo">＋ Item</button>' : '')
    + '</div>'

    + '<div class="note warn"><div class="note-title">⚠️ Por que este app não faz login sozinho no portal</div>'
    + 'A Rede D\'Or não oferece acesso automático (API pública) aos resultados. O portal é protegido contra '
    + 'robôs e exige a senha do paciente e verificação em duas etapas. Fazer login automático significaria '
    + 'burlar essa proteção, guardar a senha do paciente de forma insegura e descumprir os termos de uso do '
    + 'convênio — além de colocar o acesso dele em risco.<br><br>'
    + '<b>O que fazemos em vez disso:</b> reunimos tudo em um só lugar, guardamos as credenciais '
    + '<b>cifradas</b> para não precisar procurar, e importamos os laudos que o paciente baixa do portal. '
    + 'O resultado para a família é o mesmo: <b>um acervo único, atualizado e seguro</b>.</div>'

    + '<div class="pac-tabs">'
    +   [['acompanhar', '📋 Acompanhamento'], ['importar', '⬆️ Importar laudos'],
         ['credenciais', '🔑 Acesso e senha'], ['canais', '🔗 Canais oficiais']]
      .map(([k, t]) => '<button class="pac-tab' + (aba === k ? ' on' : '') + '" data-aba="' + k + '">' + t + '</button>').join('')
    + '</div>'

    + '<div id="painel"></div>'
    + '</div>';

  pintar();

  host.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-aba]');
    if (t) { aba = t.dataset.aba; render(host); return; }
    const ac = ev.target.closest('[data-acao]');
    if (!ac) return;
    const a = ac.dataset.acao, id = ac.dataset.id;
    if (a === 'novo') formMonitoria(null);
    else if (a === 'editar') formMonitoria(porId('dor-monitorias', id) || (estado.dor.monitorias || []).find((x) => x.id === id));
    else if (a === 'baixado') marcarBaixado(id);
    else if (a === 'excluir') excluirMonitoria(id);
    else if (a === 'salvar-cred') formCredencial(ac.dataset.pac);
    else if (a === 'ver-cred') verCredencial(ac.dataset.pac);
    else if (a === 'apagar-cred') apagarCredencial(ac.dataset.pac, host);
    else if (a === 'importar') importarLaudo(ac.dataset.pac);
    else if (a === 'abrir-doc') abrirDocPorId(id);
  });
}

function pintar() {
  const box = $('#painel');
  if (aba === 'acompanhar') box.innerHTML = cenaAcompanhar();
  else if (aba === 'canais') box.innerHTML = cenaCanais();
  else if (aba === 'credenciais') box.innerHTML = cenaCredenciais();
  else if (aba === 'importar') box.innerHTML = cenaImportar();
}

/* ------------------------------------------------------- acompanhamento */

function cenaAcompanhar() {
  const m = estado.dor.monitorias || [];
  const abertos = m.filter((x) => x.status !== 'baixado');
  const baixados = m.filter((x) => x.status === 'baixado');

  return '<div class="stack">'
    + '<div class="grid grid-3">'
    + '<div class="kpi brand"><div class="kpi-n">' + m.length + '</div><div class="kpi-l">Itens</div></div>'
    + '<div class="kpi warn"><div class="kpi-n">' + abertos.length + '</div><div class="kpi-l">Aguardando</div></div>'
    + '<div class="kpi ok"><div class="kpi-n">' + baixados.length + '</div><div class="kpi-l">Baixados</div></div>'
    + '</div>'

    + (abertos.length
      ? '<div class="section-title">⏳ Aguardando resultado</div>'
        + '<div class="stack" style="gap:8px">' + abertos.map(cartaoMonitoria).join('') + '</div>'
      : '')

    + (baixados.length
      ? '<div class="section-title">✓ Laudos já reunidos</div>'
        + '<div class="stack" style="gap:8px">' + baixados.map(cartaoMonitoria).join('') + '</div>'
      : '')

    + (!m.length
      ? vazio('🏥', 'Nada em acompanhamento ainda',
        'Registre cada exame solicitado: quando o resultado estiver pronto no portal, você baixa e anexa aqui. '
        + 'Assim a família sabe exatamente o que falta.',
        pode('escrever') ? '<button class="btn btn-primary" data-acao="novo">＋ Registrar item</button>' : '')
      : '')

    + '<div class="note info"><div class="note-title">🔄 Rotina sugerida</div>'
    + 'Toda <b>segunda-feira</b>, uma pessoa da família abre o portal da Rede D\'Or, confere se saiu resultado novo, '
    + 'baixa os PDFs e importa aqui. Depois marca o item como baixado. Cinco minutos por semana bastam.</div>'
    + '</div>';
}

function cartaoMonitoria(x) {
  const p = paciente(x.pacienteId);
  const baixado = x.status === 'baixado';
  const atrasado = x.previsao && new Date(x.previsao).getTime() < Date.now() && !baixado;
  return '<div class="item" style="border-left:4px solid ' + (baixado ? 'var(--ok)' : atrasado ? 'var(--danger)' : 'var(--warn)') + '">'
    + '<div class="item-main">'
    +   '<div class="row-between"><div class="item-title" style="font-size:.92rem">' + esc(x.titulo) + '</div>'
    +     '<span class="pill ' + (baixado ? 'ok' : atrasado ? 'danger' : 'warn') + '">'
    +     esc(baixado ? 'baixado' : atrasado ? 'atrasado' : 'aguardando') + '</span></div>'
    +   '<div class="item-meta">'
    +     '<span class="pill" style="color:' + p.cor + ';border-color:' + p.cor + '">' + p.avatarEmoji + ' ' + esc(p.nome.split(' ')[0]) + '</span>'
    +     (x.solicitadoEm ? '<span>solicitado ' + esc(fmtData(x.solicitadoEm)) + '</span>' : '')
    +     (x.previsao ? '<span>previsão ' + esc(fmtData(x.previsao)) + '</span>' : '')
    +     (x.unidade ? '<span>🏥 ' + esc(x.unidade) + '</span>' : '')
    +     (x.protocolo ? '<span class="mono tiny">protocolo ' + esc(x.protocolo) + '</span>' : '')
    +   '</div>'
    +   (x.observacao ? '<div class="item-text">' + esc(x.observacao) + '</div>' : '')
    +   '<div class="item-actions">'
    +     (baixado && x.documentoId
        ? '<button class="btn btn-sm btn-soft" data-acao="abrir-doc" data-id="' + esc(x.documentoId) + '">📄 Ver laudo</button>'
        : (pode('escrever') ? '<button class="btn btn-sm btn-ok" data-acao="importar" data-pac="' + esc(x.pacienteId) + '">⬆️ Importar laudo</button>' : ''))
    +     (pode('escrever') && !baixado ? '<button class="btn btn-sm btn-ghost" data-acao="baixado" data-id="' + esc(x.id) + '">✓ Já baixei</button>' : '')
    +     (pode('escrever') ? '<button class="btn btn-sm btn-ghost" data-acao="editar" data-id="' + esc(x.id) + '">✏️</button>' : '')
    +     (pode('excluir') ? '<button class="btn btn-sm btn-danger-soft" data-acao="excluir" data-id="' + esc(x.id) + '">🗑</button>' : '')
    +   '</div>'
    + '</div></div>';
}

/* ------------------------------------------------------------- credenciais */

function cenaCredenciais() {
  return '<div class="stack">'
    + '<div class="note"><div class="note-title">🔐 Por que guardar a senha aqui é melhor</div>'
    + 'A senha do portal costuma acabar no bloco de notas do celular ou num papel na gaveta. '
    + 'Aqui ela é cifrada com a chave do cofre: <b>sem o PIN de um membro, o conteúdo é ilegível</b>, '
    + 'inclusive para quem copiar o arquivo do aparelho.</div>'

    + estado.pacientes.map((p) => {
      const c = (estado.dor.credenciais || {})[p.id];
      return '<div class="card" style="border-left:5px solid ' + p.cor + '">'
        + '<div class="card-body stack" style="gap:11px">'
        +   '<div class="row" style="gap:10px">'
        +     '<div class="avatar" style="background:' + p.cor + '">' + p.avatarEmoji + '</div>'
        +     '<div class="grow"><div class="strong">' + esc(p.nome) + '</div>'
        +       '<div class="tiny muted">' + (c ? 'credenciais guardadas · ' + esc(relativo(c.atualizadoEm)) : 'sem credenciais guardadas') + '</div></div>'
        +   '</div>'
        +   (c
            ? '<div class="item-meta"><span class="pill ok">usuário guardado</span>'
              + (c.temSenha ? '<span class="pill ok">senha guardada</span>' : '<span class="pill warn">sem senha</span>')
              + (c.cpf ? '<span class="mono tiny">CPF ' + esc(c.cpf.replace(/(\d{3})\d{3}(\d{3})(\d{2})/, '$1.***.$2-$3')) + '</span>' : '')
              + '</div>'
            : '<p class="small muted">Guarde aqui o CPF/login do portal e, se quiser, a senha — cifrada.</p>')
        +   '<div class="item-actions">'
        +     (pode('gerirCredenciais')
              ? '<button class="btn btn-sm btn-soft" data-acao="salvar-cred" data-pac="' + esc(p.id) + '">'
                + (c ? '✏️ Atualizar' : '＋ Guardar acesso') + '</button>'
              : '')
        +     (c && pode('ver') ? '<button class="btn btn-sm btn-ghost" data-acao="ver-cred" data-pac="' + esc(p.id) + '">👁 Ver</button>' : '')
        +     (c && pode('gerirCredenciais') ? '<button class="btn btn-sm btn-danger-soft" data-acao="apagar-cred" data-pac="' + esc(p.id) + '">Apagar</button>' : '')
        +   '</div>'
        + '</div></div>';
    }).join('')

    + '<div class="note danger"><div class="note-title">⚠️ Sobre senhas de terceiros</div>'
    + 'Guarde a senha do paciente <b>com o consentimento dele</b>. Se ele ainda consegue administrar o próprio '
    + 'acesso, o mais correto é ajudá-lo a entrar, sem reter a senha. Em caso de demência avançada, o '
    + 'responsável legal é quem responde pelo acesso.</div>'
    + '</div>';
}

async function formCredencial(pacId) {
  if (!pode('gerirCredenciais')) return toast('Seu perfil não altera credenciais.', 'warn');
  const p = paciente(pacId);
  const c = (estado.dor.credenciais || {})[pacId] || {};
  const r = await modal({
    titulo: 'Acesso ao portal — ' + p.nome,
    corpo: '<div class="stack">'
      + '<div class="note info"><div class="note-title">Onde encontrar</div>'
      + 'No portal da Rede D\'Or, o login costuma ser o <b>CPF</b> do paciente. A senha foi definida por você '
      + 'ou pela pessoa na primeira consulta de resultados.</div>'
      + campoTexto({ id: 'f-cpf', label: 'CPF / login', valor: c.cpf || '', placeholder: '000.000.000-00' })
      + campoTexto({ id: 'f-usuario', label: 'Usuário, se diferente do CPF', valor: c.usuario || '' })
      + campoTexto({ id: 'f-senha', label: 'Senha', valor: '', tipo: 'password',
          placeholder: c.temSenha ? '(guardada — deixe vazio para manter)' : 'Senha do portal',
          dica: 'Fica cifrada. Não é enviada para lugar nenhum.' })
      + campoTexto({ id: 'f-email', label: 'E-mail do cadastro', valor: c.email || '' })
      + campoTexto({ id: 'f-telefone', label: 'Telefone do cadastro', valor: c.telefone || '' })
      + campoArea({ id: 'f-obs', label: 'Observações', valor: c.observacao || '', linhas: 2,
          placeholder: 'Ex.: e-mail de recuperação é o da Ana; verificação vai para o celular dela.' })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Guardar cifrado', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;

  const registro = {
    cpf: d.cpf, usuario: d.usuario, email: d.email, telefone: d.telefone,
    observacao: d.obs, atualizadoEm: Date.now(),
    temSenha: c.temSenha || !!d.senha,
  };
  if (d.senha) registro.senha = await selarSegredo(d.senha);
  else if (c.senha) registro.senha = c.senha;

  estado.dor.credenciais = estado.dor.credenciais || {};
  estado.dor.credenciais[pacId] = registro;
  auditar('credencial-guardada', 'Acesso ao portal · ' + p.nome, pacId);
  const { salvar } = await import('../store.js');
  await salvar(true);
  toast('Acesso guardado cifrado.', 'ok');
  render(document.getElementById('view'));
}

async function verCredencial(pacId) {
  const c = (estado.dor.credenciais || {})[pacId];
  if (!c) return;
  const senha = await abrirSegredo(c.senha);
  await modal({
    titulo: 'Acesso ao portal',
    corpo: '<div class="stack">'
      + '<div class="note warn"><div class="note-title">Confira se ninguém está olhando</div>'
      + 'Esta tela mostra a senha guardada. Feche ao terminar.</div>'
      + linha('CPF / login', c.cpf || '—')
      + linha('Usuário', c.usuario || '—')
      + linha('Senha', senha ? '<span class="mono strong" style="font-size:1.05rem">' + esc(senha) + '</span>' : 'não guardada')
      + linha('E-mail', c.email || '—')
      + linha('Telefone', c.telefone || '—')
      + (c.observacao ? linha('Observações', esc(c.observacao)) : '')
      + '<p class="tiny muted">Acessos a esta tela ficam registrados na Auditoria.</p>'
      + '</div>',
    acoes: [{ texto: 'Fechar', valor: null, tipo: 'ghost' }],
  });
  auditar('credencial-visualizada', 'Acesso ao portal', pacId);
  const { salvar } = await import('../store.js');
  await salvar(true);
}

function linha(rotulo, valor) {
  return '<div class="row-between" style="padding:9px 0;border-bottom:1px solid var(--line)">'
    + '<span class="small muted">' + esc(rotulo) + '</span><span class="small strong">' + valor + '</span></div>';
}

async function apagarCredencial(pacId, host) {
  const p = paciente(pacId);
  if (!await confirmar('Apagar credenciais?', 'As credenciais de acesso ao portal de ' + p.nome + ' serão removidas do cofre.', 'Apagar')) return;
  delete estado.dor.credenciais[pacId];
  auditar('credencial-apagada', 'Acesso ao portal · ' + p.nome, pacId);
  const { salvar } = await import('../store.js');
  await salvar(true);
  toast('Credenciais apagadas.');
  render(host);
}

/* --------------------------------------------------------------- importação */

function cenaImportar() {
  return '<div class="stack">'
    + '<div class="note info"><div class="note-title">Como trazer o laudo para cá</div>'
    + '1. Abra o <b>portal ou o app</b> da Rede D\'Or no celular ou computador.<br>'
    + '2. Entre com o CPF e a senha do paciente.<br>'
    + '3. Baixe o PDF do resultado (ou tire print, se for só para conferência rápida).<br>'
    + '4. Volte aqui e envie o arquivo — ele é <b>cifrado</b> e fica disponível para toda a família.</div>'

    + '<div class="section-title">Enviar laudo</div>'
    + '<div class="stack" style="gap:9px">'
    + estado.pacientes.map((p) => '<div class="card card-pad" style="border-left:5px solid ' + p.cor + '">'
      + '<div class="row-between" style="align-items:center">'
      +   '<div class="row" style="gap:10px"><div class="avatar" style="background:' + p.cor + '">' + p.avatarEmoji + '</div>'
      +   '<div><div class="strong">' + esc(p.nome) + '</div><div class="tiny muted">'
      +     estado.documentos.filter((d) => d.pacienteId === p.id && d.origem === "Rede D'Or").length
      +     ' laudo(s) da Rede D\'Or já guardados</div></div></div>'
      +   (pode('escrever') ? '<button class="btn btn-primary" data-acao="importar" data-pac="' + esc(p.id) + '">⬆️ Enviar laudo</button>' : '')
      + '</div></div>').join('')
    + '</div>'

    + '<div class="section-title">Atalhos oficiais</div>'
    + '<div class="stack" style="gap:9px">' + CANAIS.map(cartaoCanal).join('') + '</div>'
    + '</div>';
}

function cenaCanais() {
  return '<div class="stack">'
    + CANAIS.map(cartaoCanal).join('')
    + '<div class="note ok"><div class="note-title">✓ Como usar na prática</div>'
    + 'Deixe o app da Rede D\'Or instalado no celular de quem acompanha, com notificações ligadas. '
    + 'Quando chegar o aviso de resultado liberado, baixe o PDF e importe aqui. '
    + 'Toda a família passa a ver o mesmo documento, na hora.</div></div>';
}

function cartaoCanal(c) {
  return '<div class="card card-pad stack" style="gap:8px">'
    + '<div class="row" style="gap:11px"><div style="font-size:1.5rem">' + c.icone + '</div>'
    + '<div class="grow"><div class="strong">' + esc(c.nome) + '</div>'
    + '<div class="small muted">' + esc(c.o_que) + '</div></div></div>'
    + '<div class="note" style="margin:0"><div class="note-title">Como usar</div>' + esc(c.como) + '</div>'
    + '<a class="btn btn-soft btn-sm" href="' + esc(c.url) + '" target="_blank" rel="noopener">🔗 Abrir canal oficial</a>'
    + '</div>';
}

/* ------------------------------------------------------------------- ações */

async function formMonitoria(x) {
  const editando = !!x;
  const r = await modal({
    titulo: editando ? 'Editar item' : 'Registrar exame a acompanhar',
    corpo: '<div class="stack">'
      + campoSelect({ id: 'f-pacienteId', label: 'Paciente', valor: x ? x.pacienteId : '', vazio: 'Escolha', obrigatorio: true,
          opcoes: estado.pacientes.map((p) => ({ valor: p.id, texto: p.avatarEmoji + ' ' + p.nome })) })
      + campoTexto({ id: 'f-titulo', label: 'Exame / exame solicitado', valor: x ? x.titulo : '', obrigatorio: true,
          placeholder: 'Ex.: Ressonância magnética de crânio, Creatinina, Ecocardiograma' })
      + '<div class="grid grid-2" style="gap:12px">'
      + campoTexto({ id: 'f-solicitadoEm', label: 'Solicitado em', valor: x ? x.solicitadoEm || '' : new Date().toISOString().slice(0, 10), tipo: 'date' })
      + campoTexto({ id: 'f-previsao', label: 'Previsão do resultado', valor: x ? x.previsao || '' : '', tipo: 'date',
          dica: 'O app sinaliza como atrasado depois dessa data.' })
      + '</div>'
      + '<div class="grid grid-2" style="gap:12px">'
      + campoTexto({ id: 'f-unidade', label: 'Unidade', valor: x ? x.unidade || '' : '', placeholder: 'Ex.: Hospital São Luiz Morumbi' })
      + campoTexto({ id: 'f-protocolo', label: 'Protocolo / pedido', valor: x ? x.protocolo || '' : '' })
      + '</div>'
      + campoArea({ id: 'f-observacao', label: 'Observação', valor: x ? x.observacao || '' : '', linhas: 2,
          placeholder: 'Ex.: pedido pelo Dr. Almeida; levar o resultado no retorno de 20/10' })
      + campoSelect({ id: 'f-status', label: 'Situação', valor: x ? x.status : 'aguardando', vazio: null,
          opcoes: [{ valor: 'aguardando', texto: 'Aguardando resultado' },
            { valor: 'baixado', texto: 'Laudo já reunido' },
            { valor: 'revisar', texto: 'Precisa revisar / conferir' }] })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;
  if (!d.pacienteId || !d.titulo) return toast('Informe paciente e exame.', 'warn');

  estado.dor.monitorias = estado.dor.monitorias || [];
  if (editando) {
    Object.assign(x, d, { atualizadoEm: Date.now() });
    auditar('dor-item-editado', d.titulo, d.pacienteId);
  } else {
    estado.dor.monitorias.unshift({ id: novoId('dorm'), ...d, criadoEm: Date.now() });
    auditar('dor-item-criado', d.titulo, d.pacienteId);
  }
  const { salvar } = await import('../store.js');
  await salvar(true);
  toast(editando ? 'Item atualizado.' : 'Item em acompanhamento.', 'ok');
  render(document.getElementById('view'));
}

async function marcarBaixado(id) {
  const x = (estado.dor.monitorias || []).find((m) => m.id === id);
  if (!x) return;
  x.status = 'baixado';
  x.atualizadoEm = Date.now();
  auditar('dor-marcado-baixado', x.titulo, x.pacienteId);
  const { salvar } = await import('../store.js');
  await salvar(true);
  toast('Marcado como reunido.', 'ok');
  render(document.getElementById('view'));
}

async function excluirMonitoria(id) {
  const x = (estado.dor.monitorias || []).find((m) => m.id === id);
  if (!x) return;
  if (!await confirmar('Remover do acompanhamento?', '"' + x.titulo + '" sairá da lista de acompanhamento da Rede D\'Or.', 'Remover')) return;
  estado.dor.monitorias = estado.dor.monitorias.filter((m) => m.id !== id);
  auditar('dor-item-excluido', x.titulo, x.pacienteId);
  const { salvar } = await import('../store.js');
  await salvar(true);
  toast('Item removido.');
  render(document.getElementById('view'));
}

/** Importa um laudo da Rede D'Or reaproveitando o mesmo cofre cifrado de Documentos. */
function importarLaudo(pacId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/pdf,image/*';

  input.addEventListener('change', async () => {
    const arq = input.files && input.files[0];
    if (!arq) return;
    if (arq.size > 25 * 1024 * 1024) return toast('Arquivo acima de 25 MB. Comprima antes de enviar.', 'danger', 6000);

    const p = paciente(pacId);
    const r = await modal({
      titulo: 'Laudo da Rede D\'Or',
      corpo: '<div class="stack">'
        + '<div class="note"><div class="note-title">Arquivo</div>' + esc(arq.name)
        + ' · ' + (arq.size / 1024).toFixed(0) + ' KB</div>'
        + campoSelect({ id: 'f-pacienteId', label: 'Paciente', valor: pacId, vazio: null,
            opcoes: estado.pacientes.map((x) => ({ valor: x.id, texto: x.avatarEmoji + ' ' + x.nome })) })
        + campoTexto({ id: 'f-titulo', label: 'Título', valor: arq.name.replace(/\.[^.]+$/, ''), obrigatorio: true })
        + '<div class="grid grid-2" style="gap:12px">'
        + campoSelect({ id: 'f-categoria', label: 'Categoria', valor: 'Laudo de exame', vazio: null,
            opcoes: ['Laudo de exame', 'Resultado laboratorial', 'Imagem / radiologia', 'Relatório médico', 'Alta hospitalar'] })
        + campoTexto({ id: 'f-data', label: 'Data do documento', valor: new Date().toISOString().slice(0, 10), tipo: 'date' })
        + '</div>'
        + campoTexto({ id: 'f-unidade', label: 'Unidade', placeholder: 'Hospital / laboratório Rede D\'Or' })
        + campoTexto({ id: 'f-protocolo', label: 'Protocolo (opcional)' })
        + campoArea({ id: 'f-descricao', label: 'O que importa aqui', linhas: 3,
            placeholder: 'Ex.: creatinina 1,9 — acima do valor de referência. Levar ao nefrologista.' })
        + '</div>',
      acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar e cifrar', valor: 'FORM', tipo: 'primary' }],
    });
    if (!r || !r.dados) return;
    const d = r.dados;
    if (!d.titulo) return toast('Informe um título.', 'warn');

    const arquivoId = novoId('arq');
    try { await guardarArquivo(arquivoId, arq); }
    catch (e) { return toast('Falha ao cifrar: ' + e.message, 'danger', 6000); }

    inserir('documentos', {
      id: novoId('doc'), pacienteId: d.pacienteId, titulo: d.titulo, categoria: d.categoria,
      data: d.data, unidade: d.unidade, descricao: d.descricao,
      origem: "Rede D'Or", protocolo: d.protocolo,
      arquivoId, nomeArquivo: arq.name, mime: arq.type || 'application/pdf', tamanho: arq.size,
      criadoPorNome: sessao.membro.nome,
    });

    estado.dor.monitorias = estado.dor.monitorias || [];
    estado.dor.monitorias.unshift({
      id: novoId('dorm'), pacienteId: d.pacienteId, titulo: d.titulo, unidade: d.unidade,
      protocolo: d.protocolo, observacao: d.descricao, status: 'baixado',
      documentoId: arquivoId, criadoEm: Date.now(),
    });
    estado.dor.ultimaSincronizacao = Date.now();
    auditar('dor-laudo-importado', d.titulo, d.pacienteId);

    const { salvar } = await import('../store.js');
    await salvar(true);
    toast('Laudo cifrado e anexado ao prontuário.', 'ok', 5000);
    aba = 'acompanhar';
    render(document.getElementById('view'));
  });

  input.click();
}

async function abrirDocPorId(arquivoId) {
  try { await abrirDocumento(arquivoId, 'application/pdf'); }
  catch (e) { toast(e.message, 'danger'); }
}
