/* ============================================================================
 * Tela · Amil — extrato, autorizações e carteirinha  (assets/js/views/amil.js)
 * ----------------------------------------------------------------------------
 * O que muda em relação ao painel antigo:
 *
 *   ANTES: baixava-se UM arquivo por vez e digitava-se à mão. No dia seguinte
 *          já estava desatualizado ("ficou imprestável").
 *
 *   AGORA: jogam-se VÁRIOS arquivos de uma vez (ou um lote do coletor) e o app
 *          reconhece, extrai, concilia e arquiva sozinho — sem digitar nada.
 *
 * HONESTIDADE TÉCNICA (não é questão de opinião, é limitação real):
 *   Este app é um PWA que roda no aparelho. Ele NÃO faz login no Meu Amil por
 *   conta própria, por três motivos concretos:
 *     · o navegador bloqueia requisições entre sites (CORS);
 *     · não existe servidor aqui para manter a sessão autenticada;
 *     · a Amil pede verificação em duas etapas — que é uma PESSOA confirmando.
 *   Quem automatiza o download é o COLETOR (tools/coletor.mjs), rodando no
 *   computador da família, com o login feito uma vez e salvo só ali. O app
 *   recebe o resultado (um lote .teruellote) e organiza tudo. A senha nunca
 *   entra no app nem em servidor nenhum.
 * ==========================================================================*/

'use strict';

import {
  estado, inserir, auditar, novoId, sessao,
  selarSegredo, abrirSegredo, guardarArquivo,
} from '../store.js';
import { pode } from '../auth.js';
import {
  esc, $, modal, confirmar, toast, vazio, fmtData, relativo,
  paciente, campoTexto, campoArea,
} from '../ui.js';
import {
  conciliar, chaveNome, validarLote, bytesParaB64, classificarItens,
} from '../ingest.js';

/* =========================================================================
 * Canais oficiais — sempre a fonte da verdade
 * ======================================================================= */
const CANAIS = [
  {
    nome: 'Portal do Beneficiário — Amil',
    url: 'https://www.amil.com.br/beneficiario/',
    o_que: 'Extrato de utilização, boletos, carteirinha virtual, reembolsos e autorizações.',
    como: 'Entre com CPF (ou nº do beneficiário) e senha. Em "Extrato" escolha o período e baixe o PDF/CSV.',
    icone: '💻',
  },
  {
    nome: 'App Amil Clientes',
    url: 'https://institucional.amil.com.br/app-amil-clientes',
    o_que: 'Boletos, reembolsos, carteirinha/token, rede credenciada e teleatendimento 24h.',
    como: 'Instale, faça o primeiro acesso pelo CPF e ative o cadastro. Baixe o que precisar e traga para cá.',
    icone: '📱',
  },
  {
    nome: 'Central de Atendimento',
    url: 'https://www.amil.com.br/',
    o_que: 'Autorizações, segunda via e dúvidas sobre procedimentos e reembolso.',
    como: 'Capitais: 11 3004-1000 (telefone e WhatsApp) · Demais localidades: 0800-706-2363.',
    icone: '☎️',
  },
];

let aba = 'acompanhar';

export function render(host) {
  const cred = estado.amil.credenciais || {};

  host.innerHTML = '<div class="wrap stack">'
    + '<div class="row-between">'
    +   '<div><h1>Amil</h1><p class="muted small">Extrato, autorizações e carteirinha — extraídos dos documentos oficiais</p></div>'
    +   (pode('escrever') ? '<button class="btn btn-primary" data-acao="importar">⬆ Importar lote</button>' : '')
    + '</div>'

    + '<div class="note info"><div class="note-title">✅ O que este app faz (e o que não faz)</div>'
    + '<b>Faz:</b> reconhece os documentos da Amil que você já baixou, extrai os campos sozinho, '
    + 'concilia com o que já existe (sem duplicar) e arquiva tudo cifrado. <b>Não faz:</b> login automático no '
    + 'Meu Amil — isso é barrado tecnicamente (CORS, sem servidor de sessão, verificação em duas etapas). '
    + 'Para automatizar o download de verdade, use o <b>coletor</b> no seu computador (aba Importar).</div>'

    + '<div class="pac-tabs">'
    +   [['acompanhar', '📊 Acompanhamento'], ['importar', '⬆️ Importar'],
         ['acesso', '🔑 Acesso e senha'], ['canais', '🔗 Canais oficiais']]
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
    const a = ac.dataset.acao;
    if (a === 'importar') abrirImportacao(host);
    else if (a === 'coletor') explicarColetor();
    else if (a === 'conferido') marcarConferido();
    else if (a === 'salvar-cred') formCredencial(ac.dataset.pac);
    else if (a === 'ver-cred') verCredencial(ac.dataset.pac);
    else if (a === 'apagar-cred') apagarCredencial(ac.dataset.pac, host);
    else if (a === 'ler-texto') lerDocumento(ac.dataset.id);
    else if (a === 'excluir-fatura') excluirFatura(ac.dataset.id, host);
    else if (a === 'excluir-guia') excluirGuia(ac.dataset.id, host);
  });
}

function pintar() {
  const box = $('#painel');
  if (!box) return;
  if (aba === 'acompanhar') box.innerHTML = cenaAcompanhar();
  else if (aba === 'importar') box.innerHTML = cenaImportar();
  else if (aba === 'acesso') box.innerHTML = cenaAcesso();
  else box.innerHTML = cenaCanais();
}

/* =========================================================================
 * ABA 1 — Acompanhamento (o painel que estava sempre desatualizado)
 * ======================================================================= */

function cenaAcompanhar() {
  const amil = estado.amil || {};
  const guias = amil.guias || [];
  const faturas = amil.faturas || [];
  const carterinhas = amil.carteirinhas || [];

  const abertas = guias.filter((g) => !g.validade || g.validade >= hojeIso());
  const vencidas = guias.filter((g) => g.validade && g.validade < hojeIso());
  const totalUtilizado = faturas.reduce((s, f) => s + (f.total || 0), 0);

  return '<div class="stack">'
    + '<div class="grid grid-3">'
    +   '<div class="kpi brand"><div class="kpi-n">' + guias.length + '</div><div class="kpi-l">Autorizações</div></div>'
    +   '<div class="kpi ' + (abertas.length ? 'warn' : 'ok') + '"><div class="kpi-n">' + abertas.length + '</div><div class="kpi-l">Senhas válidas</div></div>'
    +   '<div class="kpi"><div class="kpi-n">' + moeda(totalUtilizado) + '</div><div class="kpi-l">Utilizado (extratos)</div></div>'
    + '</div>'

    + (carterinhas.length
      ? '<div class="section-title">💳 Carteirinhas</div>'
        + '<div class="stack" style="gap:8px">' + carterinhas.map(cartaoCarteirinha).join('') + '</div>'
      : '')

    + '<div class="section-title">🔑 Autorizações em vigor</div>'
    + (abertas.length
      ? '<div class="stack" style="gap:8px">' + abertas.map(cartaoGuia).join('') + '</div>'
      : vazio('🔑', 'Nenhuma senha de autorização válida',
        'Traga as guias do Meu Amil (aba Importar). O app lê número, senha e validade sozinho — '
        + 'é isso que você mostra no laboratório e na consulta.'))

    + (vencidas.length
      ? '<div class="section-title">⌛ Vencidas (guarde para histórico)</div>'
        + '<div class="stack" style="gap:8px">' + vencidas.map(cartaoGuia).join('') + '</div>'
      : '')

    + '<div class="section-title">📊 Extrato de utilização</div>'
    + (faturas.length
      ? '<div class="stack" style="gap:8px">' + faturas.map(cartaoFatura).join('') + '</div>'
      : vazio('📊', 'Nenhum extrato importado',
        'Baixe o extrato de utilização no portal Meu Amil e importe aqui. O app lê cada procedimento '
        + 'e o valor sem você digitar.'))

    + '<div class="row-between card card-pad" style="align-items:center">'
    +   '<div class="small muted">Última conferência: <b>'
    +     (amil.ultimaConferencia ? esc(relativo(amil.ultimaConferencia)) : 'nunca') + '</b></div>'
    +   (pode('escrever') ? '<button class="btn btn-sm btn-soft" data-acao="conferido">✓ Marcar conferido hoje</button>' : '')
    + '</div>'

    + '<div class="note warn"><div class="note-title">🔄 Rotina que mantém isso vivo</div>'
    + 'Uma vez por semana (ou quando sair exame/autorização), importe o lote novo. Como a importação é em '
    + 'lote e conciliada, nada duplica e nada se perde — o painel para de envelhecer.</div>'
    + '</div>';
}

function cartaoGuia(g) {
  const p = pacientePorNome(g.beneficiario);
  const vencida = g.validade && g.validade < hojeIso();
  return '<div class="card">'
    + '<div class="card-head" style="background:var(--surface);align-items:flex-start">'
    +   '<div class="grow"><div class="item-title">🔑 ' + esc(g.procedimento || 'Autorização') + '</div>'
    +     '<div class="item-meta" style="margin-top:6px">'
    +       (p ? '<span class="pill" style="color:' + p.cor + ';border-color:' + p.cor + '">' + p.avatarEmoji + ' ' + esc(p.nome.split(' ')[0]) + '</span>' : (g.beneficiario ? '<span class="pill">' + esc(g.beneficiario) + '</span>' : ''))
    +       (g.numero ? '<span class="mono tiny">guia ' + esc(g.numero) + '</span>' : '')
    +     '</div></div>'
    +   '<span class="pill ' + (vencida ? 'warn' : 'ok') + '">' + (vencida ? 'vencida' : 'válida') + '</span>'
    + '</div>'
    + '<div class="card-body stack" style="gap:10px">'
    +   (g.senha ? '<div class="row-between" style="background:var(--surface-2);border-radius:var(--r-sm);padding:10px 12px">'
        + '<span class="small muted">Senha de autorização</span>'
        + '<span class="mono strong" style="font-size:1.15rem;letter-spacing:.08em">' + esc(g.senha) + '</span></div>' : '')
    +   '<div class="item-meta">'
    +     (g.validade ? '<span>📅 válida até ' + esc(fmtData(g.validade)) + '</span>' : '')
    +     (g.prestador ? '<span>🏥 ' + esc(g.prestador) + '</span>' : '')
    +     (g.solicitante ? '<span>👤 ' + esc(g.solicitante) + '</span>' : '')
    +   '</div>'
    +   (g.arquivoId ? '<div class="row-wrap"><button class="btn btn-sm btn-soft" data-acao="ler-texto" data-id="' + esc(g.arquivoId) + '">📄 Ver documento</button></div>' : '')
    + '</div></div>';
}

function cartaoFatura(f) {
  const p = pacientePorNome(f.beneficiario);
  return '<div class="card">'
    + '<div class="card-head" style="background:var(--surface);align-items:flex-start">'
    +   '<div class="grow"><div class="item-title">📊 ' + esc(f.referencia || 'Extrato de utilização') + '</div>'
    +     '<div class="item-meta" style="margin-top:6px">'
    +       (p ? '<span class="pill" style="color:' + p.cor + ';border-color:' + p.cor + '">' + p.avatarEmoji + ' ' + esc(p.nome.split(' ')[0]) + '</span>' : '')
    +       '<span>' + (f.itens || []).length + ' procedimento(s)</span>'
    +       (f.protocolo ? '<span class="mono tiny">prot ' + esc(f.protocolo) + '</span>' : '')
    +     '</div></div>'
    +   '<span class="pill brand">' + esc(moeda(f.total || 0)) + '</span>'
    + '</div>'
    + ((f.itens || []).length
      ? '<div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Procedimento</th><th>Valor</th></tr></thead><tbody>'
        + f.itens.slice(0, 12).map((it) => '<tr><td class="small muted">' + esc(fmtData(it.data)) + '</td>'
          + '<td>' + esc(it.procedimento || it.descricao || '—') + '</td>'
          + '<td class="mono">' + esc(moeda(it.valor != null ? it.valor : it.pago)) + '</td></tr>').join('')
        + '</tbody></table></div>' + ((f.itens || []).length > 12 ? '<div class="card-body tiny muted">+ ' + (f.itens.length - 12) + ' outros procedimentos</div>' : '')
      : '')
    + '<div class="card-foot row-wrap">'
    +   (f.arquivoId ? '<button class="btn btn-sm btn-soft" data-acao="ler-texto" data-id="' + esc(f.arquivoId) + '">📄 Ver documento</button>' : '')
    +   (pode('excluir') ? '<button class="btn btn-sm btn-danger-soft" data-acao="excluir-fatura" data-id="' + esc(f.id) + '">🗑 Excluir</button>' : '')
    +   '<span class="grow"></span><span class="tiny muted">importado ' + esc(relativo(f.criadoEm)) + '</span>'
    + '</div></div>';
}

function cartaoCarteirinha(c) {
  const p = pacientePorNome(c.beneficiario);
  return '<div class="card" style="border-left:5px solid ' + (p ? p.cor : 'var(--brand)') + '">'
    + '<div class="card-body stack" style="gap:8px">'
    +   '<div class="row" style="gap:10px"><div class="avatar" style="background:' + (p ? p.cor : 'var(--brand)') + '">'
    +     (p ? p.avatarEmoji : '💳') + '</div><div class="grow"><div class="strong">' + esc(c.beneficiario || 'Beneficiário') + '</div>'
    +     '<div class="tiny muted">' + esc(c.plano || 'Amil') + (c.acomodacao ? ' · ' + esc(c.acomodacao) : '') + '</div></div></div>'
    +   '<div class="item-meta">'
    +     (c.carteira ? '<span class="mono">carteirinha ' + esc(c.carteira) + '</span>' : '')
    +     (c.validade ? '<span>📅 ' + esc(fmtData(c.validade)) + '</span>' : '')
    +     (c.abrangencia ? '<span>' + esc(c.abrangencia) + '</span>' : '')
    +   '</div>'
    + '</div></div>';
}

/* =========================================================================
 * ABA 2 — Importar (lote + coletor)
 * ======================================================================= */

function cenaImportar() {
  return '<div class="stack">'
    + '<div class="card card-pad stack">'
    +   '<div class="strong">⬆ Importar vários arquivos de uma vez</div>'
    +   '<p class="small muted">Traga os <b>PDFs, CSVs e demonstrativos</b> baixados do Meu Amil (ou o '
    +     'arquivo <span class="mono">.teruellote</span> gerado pelo coletor). O app reconhece cada um, extrai '
    +     'número, senha, procedimentos e valores — sem digitar nada.</p>'
    +   (pode('escrever') ? '<button class="btn btn-primary btn-block" data-acao="importar">📂 Escolher arquivos</button>' : '')
    +   '<div class="tiny muted">Nada sai do aparelho. Os originais ficam arquivados e cifrados junto do documento correspondente.</div>'
    + '</div>'

    + '<div class="card card-pad stack">'
    +   '<div class="strong">🤖 Coletor assistido (para baixar sozinho, em lote)</div>'
    +   '<p class="small muted">Para não baixar arquivo por arquivo, rode o coletor no seu computador <b>uma vez</b>. '
    +     'Ele abre o Meu Amil, você faz o login (e a verificação) quando ele pedir, e ele baixa tudo do período e '
    +     'monta o lote. Nas próximas vezes, é só rodar de novo — a sessão fica salva no seu PC.</p>'
    +   '<div class="note"><div class="note-title">No computador, na pasta do projeto</div>'
    +     '<div class="mono small" style="line-height:1.7">'
    +     'npm install<br>npx playwright install chromium<br>'
    +     'npm run coletar -- --paciente maria --desde 2026-01-01 --saida lote-maria.teruellote</div></div>'
    +   '<div class="tiny muted">O coletor roda <b>no seu computador</b>, não em servidor nosso. A senha fica só na '
    +     'sessão local do navegador dele. Depois é só importar o <span class="mono">.teruellote</span> aqui.</div>'
    +   '<button class="btn btn-soft btn-block" data-acao="coletor">Como funciona o coletor</button>'
    + '</div>'

    + '<div class="note info"><div class="note-title">📅 Como conciliar sem duplicar</div>'
    + 'Pode importar o mesmo período quantas vezes quiser: o app compara procedimento, data e valor e só '
    + 'acrescenta o que é novo. Guias repetidas são atualizadas (não duplicadas).</div>'
    + '</div>';
}

async function abrirImportacao(host) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.pdf,.csv,.txt,.json,.teruellote,application/pdf,text/csv,application/json';
  input.addEventListener('change', async () => {
    const arquivos = [...(input.files || [])];
    if (!arquivos.length) return;
    await importarArquivos(arquivos, host);
  });
  input.click();
}

/**
 * Lê arquivos escolhidos, extrai, concilia e — só depois de mostrar o resumo —
 * grava. Um arquivo .teruellote é expandido nos itens que ele contém.
 */
async function importarArquivos(arquivos, host) {
  toast('Lendo ' + arquivos.length + ' arquivo(s)…', '', 2500);

  const itens = [];
  for (const arq of arquivos) {
    try {
      if (/\.teruellote$/i.test(arq.name) || (arq.type || '').includes('json')) {
        const obj = JSON.parse(await arq.text());
        if (obj && obj.tipo === 'teruel-lote') { validarLote(obj); itens.push(...obj.itens); continue; }
      }
      const u8 = new Uint8Array(await arq.arrayBuffer());
      itens.push({ nome: arq.name, mime: arq.type || '', base64: bytesParaB64(u8) });
    } catch (e) {
      toast('Não consegui ler "' + arq.name + '": ' + e.message, 'danger', 6000);
    }
  }
  if (!itens.length) return;

  const bruto = await classificarItens(itens);
  await confirmarImportacao(bruto, host);
}

/** Mostra o que foi reconhecido e pede confirmação antes de gravar. */
async function confirmarImportacao(bruto, host) {
  const novasGuias = bruto.guias.filter((g) => !jaExisteGuia(g));
  const con = conciliar(estado.amil.faturas, bruto.faturas);
  const novasCart = bruto.carteirinhas.filter((c) => !jaExisteCarteirinha(c));

  const r = await modal({
    titulo: 'Revisar importação',
    largura: '620px',
    corpo: '<div class="stack">'
      + '<div class="grid grid-3">'
      +   '<div class="kpi brand"><div class="kpi-n">' + bruto.guias.length + '</div><div class="kpi-l">Autorizações</div></div>'
      +   '<div class="kpi info"><div class="kpi-n">' + bruto.faturas.length + '</div><div class="kpi-l">Extratos</div></div>'
      +   '<div class="kpi ok"><div class="kpi-n">' + bruto.carteirinhas.length + '</div><div class="kpi-l">Carteirinhas</div></div>'
      + '</div>'
      + '<div class="note"><div class="note-title">O que vai ser gravado</div>'
      +   '<span class="small">Autorizações novas: <b>' + novasGuias.length + '</b> · ' +
          'Extratos novos: <b>' + con.novos.length + '</b> · atualizados: <b>' + con.atualizados.length + '</b> · ' +
          'já existiam: <b>' + con.iguais.length + '</b> · Carteirinhas novas: <b>' + novasCart.length + '</b></span></div>'
      + (bruto.desconhecidos.length
        ? '<div class="note warn"><div class="note-title">⚠️ ' + bruto.desconhecidos.length + ' arquivo(s) sem tipo reconhecido</div>'
          + 'Esses serão arquivados como documento (sem extracção automática): '
          + esc(bruto.desconhecidos.map((d) => d.nome).join(', ').slice(0, 220)) + '</div>'
        : '')
      + (bruto.guias.length && novasGuias.length
        ? '<div class="note info"><div class="note-title">Exemplo do que foi lido</div>'
          + esc(resumirGuia(novasGuias[0])) + '</div>' : '')
      + '<div class="tiny muted">Os arquivos originais ficam arquivados e cifrados no cofre (Documentos).</div>'
      + '</div>',
    acoes: [{ texto: 'Descartar', valor: null, tipo: 'ghost' }, { texto: 'Gravar no cofre', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r) return;

  // ---- gravação efetiva ----
  let arquivados = 0;
  for (const a of bruto.arquivos) {
    try {
      const r2 = await arquivarOriginal(a.item, a.dados);
      if (r2 && r2.arquivoId) {
        // liga o registro ao documento arquivado
        const alvo = [...novasGuias, ...con.novos, ...novasCart].find((x) => x.arquivoNome === a.item.nome);
        if (alvo) alvo.arquivoId = r2.arquivoId;
        arquivados++;
      }
    } catch (e) { toast('Falha ao arquivar "' + a.item.nome + '": ' + e.message, 'warn', 6000); }
  }

  for (const g of novasGuias) estado.amil.guias.push(g);
  for (const f of con.novos) estado.amil.faturas.unshift(f);
  for (const f of con.atualizados) {
    const i = estado.amil.faturas.findIndex((x) => x.id === f.id);
    if (i >= 0) estado.amil.faturas[i] = { ...estado.amil.faturas[i], ...f, atualizadoEm: Date.now() };
  }
  for (const c of novasCart) estado.amil.carteirinhas.push(c);

  // reconhece automaticamente a carteirinha do paciente (casando pelo nome)
  for (const c of novasCart) {
    const p = pacientePorNome(c.beneficiario);
    if (p && !p.carteirinha) { p.carteirinha = c.carteira || ''; p.convenio = p.convenio || 'Amil'; }
  }

  estado.amil.ultimaConferencia = Date.now();
  auditar('amil-importacao',
    `${novasGuias.length} autorização(ões), ${con.novos.length} extrato(s), ${novasCart.length} carteirinha(s), ${arquivados} arquivo(s)`);

  const { salvar } = await import('../store.js');
  await salvar(true);
  toast('Importado: ' + novasGuias.length + ' autorização(ões), ' + con.novos.length + ' extrato(s), ' + novasCart.length + ' carteirinha(s).', 'ok', 6000);
  render(host || document.getElementById('view'));
}

function resumirGuia(g) {
  return [ 'Procedimento: ' + (g.procedimento || '—'),
    'Beneficiário: ' + (g.beneficiario || '—'),
    'Guia: ' + (g.numero || '—'),
    'Senha: ' + (g.senha || '—'),
    'Validade: ' + (g.validade ? fmtData(g.validade) : '—') ].join('\n');
}

/** Arquiva o arquivo original cifrado e cria o documento correspondente. */
async function arquivarOriginal(item, dados) {
  const categoria = ({
    guia: 'Guia de autorização',
    extrato: 'Extrato de utilização',
    reembolso: 'Demonstrativo de reembolso',
    carteirinha: 'Carteirinha',
  }[dados.tipo]) || 'Documento do convênio';

  const arquivoId = novoId('arq');
  const u8 = b64ParaBytesSeguro(item.base64);
  await guardarArquivo(arquivoId, new Blob([u8], { type: item.mime || 'application/octet-stream' }));

  const p = pacientePorNome(dados.beneficiario);
  const docId = novoId('doc');
  inserir('documentos', {
    id: docId, pacienteId: p ? p.id : null,
    titulo: (dados.titulo || dados.procedimento || dados.referencia || categoria) + ' — ' + (item.nome || ''),
    categoria, data: dados.emissao || dados.data || new Date().toISOString().slice(0, 10),
    unidade: dados.prestador || '', origem: 'Amil',
    descricao: 'Importado automaticamente do documento ' + item.nome + '.',
    arquivoId, nomeArquivo: item.nome, mime: item.mime, tamanho: u8.length,
    criadoPorNome: sessao.membro ? sessao.membro.nome : '',
  });
  return { arquivoId, docId };
}

function b64ParaBytesSeguro(b64) {
  const limpo = String(b64 || '').replace(/^data:[^,]*,/, '');
  const bin = atob(limpo);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/* ---- dedupe por tipo de registro ---- */
function jaExisteGuia(g) {
  return (estado.amil.guias || []).some((x) =>
    (g.numero && x.numero === g.numero) || (g.senha && x.senha === g.senha));
}
function jaExisteCarteirinha(c) {
  return (estado.amil.carteirinhas || []).some((x) =>
    chaveNome(x.beneficiario) === chaveNome(c.beneficiario) && (x.carteira || '') === (c.carteira || ''));
}

function explicarColetor() {
  return modal({
    titulo: 'Coletor assistido — como funciona',
    largura: '660px',
    corpo: '<div class="stack">'
      + '<div class="note ok"><div class="note-title">A ideia</div>'
      + 'Um "robô" que dirige o navegador no <b>seu computador</b>. Você faz o login e a verificação quando ele '
      + 'pedir; a partir daí ele baixa tudo do período e monta um lote. Nas próximas vezes, só roda de novo.</div>'
      + '<div class="note"><div class="note-title">1 · Instalar (uma vez)</div>'
      + '<div class="mono small">npm install<br>npx playwright install chromium</div></div>'
      + '<div class="note"><div class="note-title">2 · Rodar</div>'
      + '<div class="mono small">npm run coletar -- --paciente maria --desde 2026-01-01 --saida lote-maria.teruellote</div>'
      + 'Na primeira vez ele abre uma janela do navegador: faça o login normalmente. A sessão fica salva numa '
      + 'pasta só sua, no PC (<span class="mono">.collector-profile</span>).</div>'
      + '<div class="note"><div class="note-title">3 · Importar</div>'
      + 'Volte aqui em <b>Amil → Importar</b> e traga o <span class="mono">.teruellote</span>. O app organiza tudo.</div>'
      + '<div class="note warn"><div class="note-title">Por que assim, e não dentro do app</div>'
      + 'Um site não consegue (e não deve) fazer login na sua conta: o navegador bloqueia por CORS, não há '
      + 'servidor aqui para manter sessão, e a verificação em duas etapas precisa de você. O coletor no seu PC '
      + 'resolve isso sem expor sua senha a ninguém.</div>'
      + '</div>',
    acoes: [{ texto: 'Entendi', valor: null, tipo: 'ghost' }],
  });
}

/* =========================================================================
 * ABA 3 — Acesso e senha (cifrado, igual ao padrão da Rede D'Or)
 * ======================================================================= */

function cenaAcesso() {
  return '<div class="stack">'
    + '<div class="note"><div class="note-title">🔐 Por que guardar a senha aqui é melhor</div>'
    + 'A senha do Meu Amil costuma acabar no bloco de notas ou num papel. Aqui ela é cifrada com a chave do '
    + 'cofre: <b>sem o PIN de um membro, é ilegível</b> — inclusive para quem copiar o arquivo do aparelho. '
    + 'Como seus pais não guardam de cabeça, este é o lugar certo para isso.</div>'

    + estado.pacientes.map((p) => {
      const c = (estado.amil.credenciais || {})[p.id];
      return '<div class="card" style="border-left:5px solid ' + p.cor + '">'
        + '<div class="card-body stack" style="gap:11px">'
        +   '<div class="row" style="gap:10px">'
        +     '<div class="avatar" style="background:' + p.cor + '">' + p.avatarEmoji + '</div>'
        +     '<div class="grow"><div class="strong">' + esc(p.nome) + '</div>'
        +       '<div class="tiny muted">' + (c ? 'credenciais guardadas · ' + esc(relativo(c.atualizadoEm))
              : (p.carteirinha ? 'carteirinha ' + esc(p.carteirinha) : 'sem credenciais guardadas')) + '</div></div>'
        +   '</div>'
        +   (c
            ? '<div class="item-meta"><span class="pill ok">usuário guardado</span>'
              + (c.temSenha ? '<span class="pill ok">senha guardada</span>' : '<span class="pill warn">sem senha</span>')
              + (c.carteirinha ? '<span class="mono tiny">carteirinha ' + esc(c.carteirinha) + '</span>' : '')
              + '</div>'
            : '<p class="small muted">Guarde aqui o CPF/login do Meu Amil e a senha — cifrados.</p>')
        +   '<div class="item-actions">'
        +     (pode('gerirCredenciais')
              ? '<button class="btn btn-sm btn-soft" data-acao="salvar-cred" data-pac="' + esc(p.id) + '">'
                + (c ? '✏️ Atualizar' : '＋ Guardar acesso') + '</button>' : '')
        +     (c && pode('ver') ? '<button class="btn btn-sm btn-ghost" data-acao="ver-cred" data-pac="' + esc(p.id) + '">👁 Ver</button>' : '')
        +     (c && pode('gerirCredenciais') ? '<button class="btn btn-sm btn-danger-soft" data-acao="apagar-cred" data-pac="' + esc(p.id) + '">Apagar</button>' : '')
        +   '</div>'
        + '</div></div>';
    }).join('')

    + '<div class="note danger"><div class="note-title">⚠️ Sobre senhas de terceiros</div>'
    + 'Quem responde legalmente pelo acesso é o responsável. No caso de Alzheimer, é comum que um filho ou '
    + 'cônjuge administre o portal — e o correto é que esse acesso seja do responsável, com ciência da família '
    + 'e registrado aqui. Guarde com consentimento.</div>'
    + '</div>';
}

async function formCredencial(pacId) {
  if (!pode('gerirCredenciais')) return toast('Seu perfil não altera credenciais.', 'warn');
  const p = paciente(pacId);
  const c = (estado.amil.credenciais || {})[pacId] || {};
  const r = await modal({
    titulo: 'Acesso ao Meu Amil — ' + p.nome,
    corpo: '<div class="stack">'
      + '<div class="note info"><div class="note-title">Onde encontrar</div>'
      + 'No Meu Amil, o login costuma ser o <b>CPF</b> ou o <b>número do beneficiário</b> (o da carteirinha). '
      + 'A senha é a que foi criada no primeiro acesso.</div>'
      + campoTexto({ id: 'f-cpf', label: 'CPF / login', valor: c.cpf || '', placeholder: '000.000.000-00' })
      + '<div class="grid grid-2" style="gap:12px">'
      + campoTexto({ id: 'f-carteirinha', label: 'Nº do beneficiário', valor: c.carteirinha || '' })
      + campoTexto({ id: 'f-plano', label: 'Plano', valor: c.plano || '', placeholder: 'Ex.: Amil One 400' })
      + '</div>'
      + campoTexto({ id: 'f-senha', label: 'Senha', valor: '', tipo: 'password',
          placeholder: c.temSenha ? '(guardada — deixe vazio para manter)' : 'Senha do Meu Amil',
          dica: 'Fica cifrada. Não é enviada para lugar nenhum.' })
      + campoTexto({ id: 'f-email', label: 'E-mail do cadastro', valor: c.email || '' })
      + campoTexto({ id: 'f-telefone', label: 'Telefone do cadastro', valor: c.telefone || '' })
      + campoArea({ id: 'f-obs', label: 'Observações', valor: c.observacao || '', linhas: 2,
          placeholder: 'Ex.: a verificação em duas etapas vai para o celular da Ana.' })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Guardar cifrado', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;

  const registro = {
    cpf: d.cpf, carteirinha: d.carteirinha, plano: d.plano, email: d.email, telefone: d.telefone,
    observacao: d.obs, atualizadoEm: Date.now(), temSenha: c.temSenha || !!d.senha,
  };
  if (d.senha) registro.senha = await selarSegredo(d.senha);
  else if (c.senha) registro.senha = c.senha;

  estado.amil.credenciais = estado.amil.credenciais || {};
  estado.amil.credenciais[pacId] = registro;
  auditar('amil-credencial-guardada', 'Acesso ao Meu Amil · ' + p.nome, pacId);
  const { salvar } = await import('../store.js');
  await salvar(true);
  toast('Acesso guardado cifrado.', 'ok');
  render(document.getElementById('view'));
}

async function verCredencial(pacId) {
  const c = (estado.amil.credenciais || {})[pacId];
  if (!c) return;
  const senha = await abrirSegredo(c.senha);
  await modal({
    titulo: 'Acesso ao Meu Amil',
    corpo: '<div class="stack">'
      + '<div class="note warn"><div class="note-title">Confira se ninguém está olhando</div>'
      + 'Esta tela mostra a senha guardada. Feche ao terminar.</div>'
      + linha('CPF / login', c.cpf || '—')
      + linha('Nº do beneficiário', c.carteirinha || '—')
      + linha('Plano', c.plano || '—')
      + linha('Senha', senha ? '<span class="mono strong" style="font-size:1.05rem">' + esc(senha) + '</span>' : 'não guardada')
      + linha('E-mail', c.email || '—')
      + linha('Telefone', c.telefone || '—')
      + (c.observacao ? linha('Observações', esc(c.observacao)) : '')
      + '<p class="tiny muted">Acessos a esta tela ficam registrados na Auditoria.</p>'
      + '</div>',
    acoes: [{ texto: 'Fechar', valor: null, tipo: 'ghost' }],
  });
  auditar('amil-credencial-visualizada', 'Acesso ao Meu Amil', pacId);
  const { salvar } = await import('../store.js');
  await salvar(true);
}

async function apagarCredencial(pacId, host) {
  if (!pode('gerirCredenciais')) return;
  if (!await confirmar('Apagar credenciais?', 'O acesso guardado do Meu Amil será removido deste aparelho.', 'Apagar')) return;
  delete estado.amil.credenciais[pacId];
  auditar('amil-credencial-apagada', 'Acesso ao Meu Amil removido', pacId);
  const { salvar } = await import('../store.js');
  await salvar(true);
  render(host || document.getElementById('view'));
}

/* =========================================================================
 * ABA 4 — Canais oficiais
 * ======================================================================= */

function cenaCanais() {
  return '<div class="stack">'
    + '<div class="note info"><div class="note-title">Por que sempre voltar à fonte oficial</div>'
    + 'Estes são os canais que valem como verdade. Quando o app tiver dúvida, é aqui que se confere.</div>'
    + CANAIS.map((c) => '<div class="card">'
      + '<div class="card-body stack" style="gap:8px">'
      +   '<div class="row" style="gap:10px"><div class="brand-mark" style="font-size:1.2rem">' + c.icone + '</div>'
      +     '<div class="grow"><div class="strong">' + esc(c.nome) + '</div><div class="tiny muted">' + esc(c.o_que) + '</div></div></div>'
      +   '<p class="small">' + esc(c.como) + '</p>'
      +   '<a class="btn btn-sm btn-soft" href="' + esc(c.url) + '" target="_blank" rel="noopener">Abrir canal oficial ↗</a>'
      + '</div></div>').join('')
    + '</div>';
}

/* =========================================================================
 * Helpers
 * ======================================================================= */

function hojeIso() { return new Date().toISOString().slice(0, 10); }

function moeda(n) {
  if (n == null || isNaN(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pacientePorNome(nome) {
  const k = chaveNome(nome);
  if (!k) return null;
  return (estado.pacientes || []).find((p) => {
    const kp = chaveNome(p.nome);
    const ka = chaveNome(p.apelido);
    return (kp && (kp === k || k.includes(kp) || kp.includes(k))) || (ka && k.includes(ka));
  }) || null;
}

function linha(rot, val) {
  return '<div class="row-between" style="padding:7px 0;border-bottom:1px solid var(--line)">'
    + '<span class="small muted">' + esc(rot) + '</span><span class="small">' + val + '</span></div>';
}

async function marcarConferido() {
  estado.amil.ultimaConferencia = Date.now();
  auditar('amil-conferido', 'Conferência marcada como feita.');
  const { salvar } = await import('../store.js');
  await salvar(true);
  toast('Conferência registrada.', 'ok');
  render(document.getElementById('view'));
}

async function lerDocumento(arquivoId) {
  try {
    const { abrirDocumento } = await import('../store.js');
    await abrirDocumento(arquivoId, 'application/pdf');
  } catch (e) { toast(e.message, 'danger'); }
}

async function excluirFatura(id, host) {
  if (!pode('excluir')) return;
  const f = (estado.amil.faturas || []).find((x) => x.id === id);
  if (!f) return;
  if (!await confirmar('Excluir extrato?', 'O extrato "' + (f.referencia || 'utilização') + '" sai do acompanhamento.', 'Excluir')) return;
  estado.amil.faturas = estado.amil.faturas.filter((x) => x.id !== id);
  auditar('amil-extrato-excluido', f.referencia || 'extrato');
  const { salvar } = await import('../store.js');
  await salvar(true);
  render(host || document.getElementById('view'));
}

async function excluirGuia(id, host) {
  if (!pode('excluir')) return;
  const g = (estado.amil.guias || []).find((x) => x.id === id);
  if (!g) return;
  if (!await confirmar('Excluir autorização?', '"' + (g.procedimento || 'autorização') + '" sai da lista.', 'Excluir')) return;
  estado.amil.guias = estado.amil.guias.filter((x) => x.id !== id);
  auditar('amil-guia-excluida', g.procedimento || 'autorização');
  const { salvar } = await import('../store.js');
  await salvar(true);
  render(host || document.getElementById('view'));
}
