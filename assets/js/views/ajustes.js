/* ============================================================================
 * Tela · Ajustes  (assets/js/views/ajustes.js)
 * ----------------------------------------------------------------------------
 * O centro de controle do canal: sincronizar os aparelhos da família, gerar
 * convite, trocar o PIN, exportar/importar backup e sair com segurança.
 *
 * Importante: TODO o conteúdo sensível viaja cifrado. O arquivo de
 * sincronização pode ir por WhatsApp sem virar dado de saúde exposto.
 * ==========================================================================*/

'use strict';

import {
  estado, sessao, salvar, auditar, exportarPacote, importarPacote,
  puxarDoSincronizador, enviarParaSincronizador, setEstado, estadoInicial,
} from '../store.js';
import {
  PAPEIS, pode, exigir, trocarMeuPin, exportarConvite, importarConvite,
  apagarDesteAparelho, sair,
} from '../auth.js';
import { pinStrength, suggestPin } from '../crypto.js';
import {
  esc, $, modal, confirmar, toast, vazio, fmtDataHora, relativo, fmtData,
  campoTexto, campoSelect, campoArea, irPara, atualizarTituloCanal,
} from '../ui.js';

export function render(host) {
  const m = sessao.membro;
  const papel = PAPEIS[m.papel] || PAPEIS.leitor;
  const ultima = estado.dor.ultimaSincronizacao;

  host.innerHTML = '<div class="wrap stack">'
    + '<h1>Ajustes</h1>'

    /* --- conta --- */
    + '<div class="card" style="border-left:5px solid ' + esc(m.cor || 'var(--brand)') + '">'
    +   '<div class="card-body stack" style="gap:11px">'
    +     '<div class="row" style="gap:12px">'
    +       '<div class="avatar" style="background:' + esc(m.cor || 'var(--brand)') + ';width:50px;height:50px;font-size:1.4rem">'
    +         (m.avatarEmoji || '🙂') + '</div>'
    +       '<div class="grow"><div class="strong" style="font-size:1.05rem">' + esc(m.nome) + '</div>'
    +         '<div class="small muted">' + esc(papel.nome) + '</div></div>'
    +     '</div>'
    +     '<div class="note" style="margin:0"><div class="note-title">Seu papel</div>' + esc(papel.desc) + '</div>'
    +     '<div class="btn-row">'
    +       '<button class="btn btn-sm btn-soft" data-acao="trocar-pin">🔑 Trocar meu PIN</button>'
    +       (pode('gerirEquipe') ? '<button class="btn btn-sm btn-ghost" data-acao="ir-equipe">👥 Equipe</button>' : '')
    +       '<button class="btn btn-sm btn-ghost" data-acao="sair">🔒 Sair</button>'
    +     '</div>'
    +   '</div></div>'

    /* --- identidade do canal --- */
    + '<div class="section-title">Identidade do canal</div>'
    + '<div class="card card-pad stack" style="gap:10px">'
    +   '<div class="row-between"><span class="small muted">Código do cofre</span>'
    +     '<span class="mono strong">' + esc(sessao.fingerprint || '—') + '</span></div>'
    +   '<p class="tiny muted" style="margin:0">Todos os membros devem ver <b>este mesmo código</b>. '
    +     'Se aparecer outro número, o aparelho está num cofre diferente — os dados não vão se juntar.</p>'
    +   '<div class="row-between"><span class="small muted">Nome do canal</span>'
    +     '<span class="strong small">' + esc(estado.config.nomeCanal || 'Canal Teruel') + '</span></div>'
    +   (pode('gerirConfig') ? '<button class="btn btn-sm btn-soft" data-acao="renomear">✏️ Renomear canal</button>' : '')
    +   '<div class="row-between"><span class="small muted">Última sincronização</span>'
    +     '<span class="strong small">' + esc(ultima ? fmtDataHora(ultima) : 'nunca') + '</span></div>'
    + '</div>'

    /* --- sincronização --- */
    + '<div class="section-title">🔄 Sincronizar a família</div>'
    + '<div class="card card-pad stack" style="gap:12px">'
    +   '<p class="small muted" style="margin:0">Seis pessoas em aparelhos diferentes precisam ver os mesmos '
    +     'dados. Exporte o pacote cifrado em um aparelho e importe nos outros. Nada fica legível sem o PIN.</p>'

    +   '<div class="note info" style="margin:0"><div class="note-title">Forma mais simples (recomendada)</div>'
    +     'Uma pessoa exporta o pacote, manda no grupo da família (WhatsApp, e-mail, Drive). '
    +     'Cada uma importa no próprio celular. Depois, cada uma exporta o seu e manda de volta — assim '
    +     'ninguém perde o que anotou.</div>'

    +   '<div class="btn-row">'
    +     '<button class="btn btn-primary" data-acao="exportar">📤 Exportar pacote</button>'
    +     '<button class="btn btn-soft" data-acao="importar">📥 Importar pacote</button>'
    +   '</div>'

    +   '<div class="section-title" style="margin-top:6px">Canal automático (opcional)</div>'
    +   '<p class="small muted" style="margin:0">Se o canal automático estiver configurado, o app publica e '
    +     'busca o estado cifrado sozinho. Configure em <b>Ajustes do canal</b> depois do deploy.</p>'
    +   '<div class="btn-row">'
    +     '<button class="btn btn-soft btn-sm" data-acao="puxar">⬇️ Buscar do canal</button>'
    +     '<button class="btn btn-soft btn-sm" data-acao="enviar">⬆️ Publicar no canal</button>'
    +   '</div>'
    +   (estado.config.sincronizacaoUrl
        ? '<div class="note ok" style="margin:0"><div class="note-title">Canal configurado</div>'
          + '<span class="mono tiny">' + esc(estado.config.sincronizacaoUrl) + '</span></div>'
        : '<div class="note warn" style="margin:0"><div class="note-title">Sem canal automático</div>'
          + 'Você ainda pode sincronizar pelo pacote acima. Para automático, informe o endereço do canal.</div>')
    + '</div>'

    /* --- convite --- */
    + (pode('gerirEquipe')
      ? '<div class="section-title">📨 Convidar para um aparelho novo</div>'
        + '<div class="card card-pad stack" style="gap:11px">'
        +   '<p class="small muted" style="margin:0">O convite leva o cofre e os dados cifrados para outro '
        +     'celular. A pessoa entra com o PIN que já tem. O arquivo <b>não</b> abre sem o PIN.</p>'
        +   '<button class="btn btn-soft" data-acao="convite">📨 Gerar convite</button>'
        +   '<button class="btn btn-ghost btn-sm" data-acao="aceitar-convite">📥 Importar convite recebido</button>'
        + '</div>'
      : '')

    /* --- backup --- */
    + '<div class="section-title">💾 Cópia de segurança</div>'
    + '<div class="card card-pad stack" style="gap:11px">'
    +   '<p class="small muted" style="margin:0">Uma cópia completa (dados + laudos) num arquivo cifrado. '
    +     'Guarde em local seguro — sem o PIN não serve para ninguém.</p>'
    +   '<div class="btn-row">'
    +     '<button class="btn btn-soft" data-acao="exportar">💾 Backup completo</button>'
    +     '<button class="btn btn-ghost" data-acao="importar">📥 Restaurar backup</button>'
    +   '</div>'
    +   '<p class="tiny muted" style="margin:0">Recomendado: um backup por mês guardado em local diferente '
    +     'do aparelho de uso.</p>'
    + '</div>'

    /* --- estado do cofre --- */
    + '<div class="section-title">📦 O que está guardado agora</div>'
    + '<div class="card card-pad stack" style="gap:8px">'
    +   linha('Pacientes', estado.pacientes.length)
    +   linha('Compromissos na agenda', estado.eventos.length)
    +   linha('Medicações', estado.medicamentos.length)
    +   linha('Doses registradas', estado.doses.length)
    +   linha('Medições de sinais', estado.sinais.length)
    +   linha('Exames', estado.exames.length)
    +   linha('Documentos cifrados', estado.documentos.length)
    +   linha('Recados no mural', estado.mural.length)
    +   linha('Anotações de diário', estado.diario.length)
    +   linha('Registros de auditoria', estado.auditoria.length)
    + '</div>'

    /* --- zona de risco --- */
    + '<div class="section-title" style="color:var(--danger)">Zona de risco</div>'
    + '<div class="card card-pad stack" style="gap:11px;border-color:rgba(182,42,42,.3)">'
    +   '<div class="note danger" style="margin:0"><div class="note-title">⚠️ Leia antes</div>'
    +     'As ações abaixo afetam este aparelho ou o canal inteiro. Não há como desfazer.</div>'
    +   '<button class="btn btn-danger-soft btn-sm" data-acao="apagar-aparelho">Apagar dados deste aparelho</button>'
    +   (pode('gerirConfig') ? '<button class="btn btn-danger-soft btn-sm" data-acao="reiniciar">Apagar tudo e começar de novo</button>' : '')
    + '</div>'

    + '<div class="foot"><p class="foot-txt">'
    + 'Canal Teruel · aplicativo de organização familiar.<br>'
    + 'Não substitui avaliação, diagnóstico ou prescrição médica. Confira sempre os documentos originais.'
    + '</p></div>'
    + '</div>';

  host.addEventListener('click', (ev) => {
    const ac = ev.target.closest('[data-acao]');
    if (!ac) return;
    const a = ac.dataset.acao;
    if (a === 'trocar-pin') trocarPin(host);
    else if (a === 'ir-equipe') irPara('equipe');
    else if (a === 'sair') confirmarSaida();
    else if (a === 'renomear') renomear(host);
    else if (a === 'exportar') exportar();
    else if (a === 'importar') importar(host);
    else if (a === 'convite') gerarConvite();
    else if (a === 'aceitar-convite') aceitarConvite();
    else if (a === 'puxar') sincronizar('puxar', host);
    else if (a === 'enviar') sincronizar('enviar', host);
    else if (a === 'apagar-aparelho') apagarAparelho();
    else if (a === 'reiniciar') reiniciar();
  });
}

function linha(rotulo, valor) {
  return '<div class="row-between"><span class="small muted">' + esc(rotulo) + '</span>'
    + '<span class="strong mono">' + valor + '</span></div>';
}

/* ------------------------------------------------------------------- ações */

function baixarArquivo(conteudo, nome, mime) {
  const blob = new Blob([conteudo], { type: mime || 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function trocarPin(host) {
  const r = await modal({
    titulo: 'Trocar meu PIN',
    corpo: '<div class="stack">'
      + campoTexto({ id: 'f-atual', label: 'PIN atual', tipo: 'password', obrigatorio: true })
      + campoTexto({ id: 'f-novo', label: 'PIN novo', tipo: 'password', obrigatorio: true, valor: suggestPin(6),
          dica: 'Use 6 ou mais caracteres. Não use data de nascimento nem 123456.' })
      + campoTexto({ id: 'f-novo2', label: 'Repita o PIN novo', tipo: 'password', obrigatorio: true })
      + '<div class="note warn"><div class="note-title">Não esqueça</div>'
      + 'O PIN é a única porta do cofre. Anote num local físico seguro. Se esquecer, use a chave de recuperação.</div>'
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Trocar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;
  if (d.novo !== d.novo2) return toast('Os PINs novos não conferem.', 'warn');
  try {
    await trocarMeuPin(d.atual, d.novo);
    toast('PIN alterado. Guarde-o com cuidado.', 'ok', 5000);
    render(host);
  } catch (e) { toast(e.message, 'danger'); }
}

function confirmarSaida() {
  sair();
  location.reload();
}

async function renomear(host) {
  const r = await modal({
    titulo: 'Nome do canal',
    corpo: campoTexto({ id: 'f-nome', label: 'Como a família chama este canal', valor: estado.config.nomeCanal || 'Canal Teruel' }),
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Salvar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados || !r.dados.nome) return;
  estado.config.nomeCanal = r.dados.nome;
  estado.config.atualizadoEm = Date.now();
  auditar('config-atualizada', 'Nome do canal: ' + r.dados.nome);
  await salvar(true);
  atualizarTituloCanal();
  toast('Nome atualizado.', 'ok');
  render(host);
}

async function exportar() {
  const btn = toast('Preparando pacote cifrado…');
  try {
    const { json, nomeArquivo } = await exportarPacote(true);
    baixarArquivo(json, nomeArquivo, 'application/octet-stream');
    auditar('backup-exportado', 'Pacote completo com documentos');
    await salvar(true);
    setTimeout(() => toast('Pacote gerado. Envie para a família.', 'ok', 5000), 400);
  } catch (e) {
    toast('Falha ao exportar: ' + e.message, 'danger', 6000);
  }
}

function importar(host) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.teruel,.json,application/json';
  input.addEventListener('change', async () => {
    const arq = input.files && input.files[0];
    if (!arq) return;
    const texto = await arq.text();

    // convite ou pacote?
    let tipo = null;
    try { tipo = JSON.parse(texto).tipo; } catch { }

    if (tipo === 'teruel-convite') return aplicarConvite(texto);

    try {
      const { resumo, arquivosGravados } = await importarPacote(texto);
      const total = Object.entries(resumo).filter(([k]) => !['conflitos', 'exclusoes'].includes(k))
        .reduce((s, [, v]) => s + (typeof v === 'number' ? v : 0), 0);
      await modal({
        titulo: 'Pacote importado',
        corpo: '<div class="stack">'
          + '<div class="note ok"><div class="note-title">✓ Mesclado com sucesso</div>'
          + '<b>' + total + '</b> registro(s) novo(s) ou atualizado(s), '
          + '<b>' + arquivosGravados + '</b> documento(s) trazido(s).</div>'
          + '<p class="small muted">A mesclagem preserva o mais recente de cada item. Nada foi apagado '
          + 'além do que já havia sido excluído no aparelho de origem.</p>'
          + '</div>',
        acoes: [{ texto: 'Ótimo', valor: true, tipo: 'primary' }],
      });
      render(host);
    } catch (e) {
      toast(e.message, 'danger', 7000);
    }
  });
  input.click();
}

async function gerarConvite() {
  try {
    const { json, nomeArquivo } = await exportarConvite();
    baixarArquivo(json, nomeArquivo, 'application/json');
    toast('Convite gerado. Envie com o PIN em separado.', 'ok', 6000);
  } catch (e) { toast(e.message, 'danger'); }
}

function aceitarConvite() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const arq = input.files && input.files[0];
    if (!arq) return;
    aplicarConvite(await arq.text());
  });
  input.click();
}

async function aplicarConvite(texto) {
  try {
    importarConvite(texto);
    await modal({
      titulo: 'Convite importado',
      corpo: '<div class="stack"><div class="note ok"><div class="note-title">✓ Canal pronto neste aparelho</div>'
        + 'Agora entre com o <b>seu PIN</b> na tela inicial. O convite não contém nada legível sem ele.</div></div>',
      acoes: [{ texto: 'Entrar agora', valor: true, tipo: 'primary' }],
    });
    sair();
    location.reload();
  } catch (e) { toast(e.message, 'danger', 6000); }
}

async function sincronizar(qual, host) {
  try {
    if (qual === 'puxar') {
      const resumo = await puxarDoSincronizador();
      toast(resumo ? 'Estado do canal recebido e mesclado.' : 'O canal ainda está vazio.', resumo ? 'ok' : 'warn');
    } else {
      await enviarParaSincronizador();
      auditar('sincronizado', 'Publicado no canal');
      toast('Estado publicado no canal.', 'ok');
    }
    render(host);
  } catch (e) { toast(e.message, 'danger', 6000); }
}

async function apagarAparelho() {
  if (!await confirmar('Apagar dados deste aparelho?',
    'Os dados e o cofre serão removidos DESTE aparelho. Os outros continuam intactos. '
    + 'Você precisará do convite e do PIN para voltar a usar aqui.', 'Apagar deste aparelho')) return;
  apagarDesteAparelho();
  location.reload();
}

async function reiniciar() {
  if (!await confirmar('Apagar tudo e começar de novo?',
    'Isso apaga o cofre e TODOS os dados, inclusive deste aparelho, sem recuperação. '
    + 'Os outros aparelhos da família perdem a referência. Faça um backup antes.', 'Apagar tudo')) return;
  if (!await confirmar('Tem certeza absoluta?', 'Esta é a última confirmação. Não há como voltar atrás.', 'Sim, apagar tudo')) return;
  apagarDesteAparelho();
  location.reload();
}
