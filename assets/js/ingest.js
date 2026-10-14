/* ============================================================================
 * TERUEL · Ingestão de documentos do convênio  (assets/js/ingest.js)
 * ----------------------------------------------------------------------------
 * O que este módulo resolve:
 *
 *   Antes, cada laudo/guia era digitado à mão — um por um — e o painel
 *   envelhecia no dia seguinte. Aqui a família joga VÁRIOS arquivos de uma vez
 *   (ou um lote exportado pelo coletor) e o app:
 *
 *     1. reconhece o tipo do documento (guia, extrato, reembolso, carteirinha),
 *     2. extrai os campos por heurística de texto (sem digitar nada),
 *     3. concilia com o que já existe (não duplica, atualiza o mais recente),
 *     4. liga cada item ao acervo certo (autorização, exame, utilização).
 *
 * IMPORTANTE — este módulo NÃO faz login em portal nenhum. Ele só organiza
 * arquivos que a PRÓPRIA família já tem em mãos (baixados do Meu Amil, do app,
 * ou de um lote gerado no computador por tools/coletor). Nada sai do aparelho.
 * ==========================================================================*/

'use strict';

import { bytes, text } from './crypto.js';

export const VERSAO_LOTE = 1;

/* =========================================================================
 * 0. Utilidades de texto
 * ======================================================================= */

/** Normaliza: unifica quebras, remove espaços duplicados, preserva linhas. */
export function normalizar(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function linhas(s) { return normalizar(s).split('\n'); }

/** Data em dd/mm/aaaa, aaaa-mm-dd ou dd-mm-aa → ISO 'aaaa-mm-dd'. */
export function paraIso(t) {
  if (!t) return '';
  const s = String(t).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let ano = m[3];
    if (ano.length === 2) ano = '20' + ano;
    return ano + '-' + pad(m[2]) + '-' + pad(m[1]);
  }
  return '';
}

function pad(v) { return String(v).padStart(2, '0'); }

/** Valor monetário em pt-BR → número. 'R$ 1.234,56' → 1234.56 */
export function valorNumerico(t) {
  if (t == null) return null;
  const s = String(t).replace(/[^\d,.-]/g, '');
  if (!s) return null;
  let limpo = s.replace(/\./g, '');
  if (limpo.includes(',')) limpo = limpo.replace(',', '.');
  const n = parseFloat(limpo);
  return isNaN(n) ? null : n;
}

/** Primeira ocorrência de um campo "Rótulo: valor", tolerante a acento/caixa. */
export function campo(txt, rotulos) {
  const lista = Array.isArray(rotulos) ? rotulos : [rotulos];
  for (const rot of lista) {
    const re = new RegExp(rot + '\\s*[:\\-]?\\s*([^\\n]+)', 'i');
    const m = String(txt).match(re);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

/** Normaliza nome para comparação (sem acento, minúsculo) — ajuda no casamento. */
export function chaveNome(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* =========================================================================
 * 1. Extração de texto de PDF — sem biblioteca externa
 * ======================================================================= */

/**
 * Tenta tirar texto de um PDF usando só o que o navegador oferece.
 * Estratégia: inflar os streams FlateDecode (DecompressionStream) e ler os
 * operadores de texto (Tj / TJ / ' / "). Funciona muito bem para extratos,
 * guias e demonstrativos gerados por sistema — que é o caso do Meu Amil.
 *
 * Se nada disso funcionar, devolve a varredura crua (serve para PDFs simples
 * sem compressão). Nunca lança: em pior caso devolve ''.
 *
 * @param {Uint8Array} u8  bytes do PDF
 * @returns {Promise<string>}
 */
export async function extrairTextoPdf(u8) {
  const cru = latin1(u8);
  const pedacos = [];

  // PDFs costumam ter o texto em streams comprimidos com zlib/deflate.
  if (typeof DecompressionStream === 'function') {
    for (const bloco of streamsFlate(u8)) {
      try {
        const ds = new DecompressionStream('deflate');
        const stream = new Blob([bloco]).stream().pipeThrough(ds);
        const buf = new Uint8Array(await new Response(stream).arrayBuffer());
        pedacos.push(textoDeConteudo(latin1(buf)));
      } catch {
        // alguns PDFs usam zlib com cabeçalho; tenta 'deflate-raw' depois
        try {
          const ds = new DecompressionStream('deflate-raw');
          const stream = new Blob([bloco]).stream().pipeThrough(ds);
          const buf = new Uint8Array(await new Response(stream).arrayBuffer());
          pedacos.push(textoDeConteudo(latin1(buf)));
        } catch { /* stream ilegível — ignora */ }
      }
    }
  }

  let saida = pedacos.filter(Boolean).join('\n');
  if (!saida.trim()) saida = textoDeConteudo(cru);   // fallback: PDF sem compressão
  return normalizar(saida);
}

/** Converte bytes em string latin1 (1 byte = 1 char) sem depender de Buffer. */
function latin1(u8) {
  let out = '';
  const passo = 8192;
  for (let i = 0; i < u8.length; i += passo) {
    out += String.fromCharCode.apply(null, u8.subarray(i, i + passo));
  }
  return out;
}

/** Localiza os trechos entre "stream" e "endstream". */
function streamsFlate(u8) {
  const txt = latin1(u8);
  const blocos = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const ini = m.index + m[0].length;
    const fim = txt.indexOf('endstream', ini);
    if (fim < 0) break;
    // remove o EOL final do stream
    let bytesTexto = txt.slice(ini, fim);
    bytesTexto = bytesTexto.replace(/\r?\n$/, '');
    const arr = new Uint8Array(bytesTexto.length);
    for (let i = 0; i < bytesTexto.length; i++) arr[i] = bytesTexto.charCodeAt(i) & 0xff;
    if (arr.length > 0) blocos.push(arr);
  }
  return blocos;
}

/** Extrai o texto legível de um stream de conteúdo PDF (operadores Tj/TJ/'"'). */
function textoDeConteudo(conteudo) {
  const fora = [];
  // TJ arrays e strings literais
  const re = /\((?:\\.|[^\\()])*\)/g;
  const bruto = conteudo.match(/BT[\s\S]*?ET/g);
  const alvo = bruto && bruto.length ? bruto.join('\n') : conteudo;

  for (const bloco of alvo.split(/\n/)) {
    if (!/(Tj|TJ|'|")\s*$/.test(bloco) && !/Tj|TJ/.test(bloco)) continue;
    const str = bloco.match(re);
    if (!str) continue;
    fora.push(str.map(desescaparPdf).join(''));
  }
  return fora.join('\n');
}

function desescaparPdf(s) {
  return s.slice(1, -1)
    .replace(/\\([nrtbf()\\])/g, (_, c) => (
      { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] || c))
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

/* =========================================================================
 * 2. Reconhecimento do tipo de documento
 * ======================================================================= */

const ASSINATURAS = [
  { tipo: 'guia',       fortes: [/n[uú]mero\s+da\s+guia/i, /senha\s+de\s+autoriza/i, /guia\s+(de\s+)?(sp\/?sadt|interna)/i],
                        fracas: [/autoriza/i, /tuss/i, /carteirinha/i] },
  { tipo: 'reembolso',  fortes: [/demonstrativo\s+de\s+reembolso/i, /recibo\s+de\s+reembolso/i],
                        fracas: [/reembols/i, /glosa/i, /pago/i] },
  { tipo: 'extrato',    fortes: [/extrato\s+de\s+utiliza/i, /utiliza[cç][aã]o\s+do\s+plano/i, /fatura\s+mensal/i,
                                 /(^|\n)[^\n]*\bdata\b[^\n]*\b(valor|pago|custo)\b/i],
                        fracas: [/extrato/i, /procedimento\s+realizado/i, /presta/i, /valor\s+pago/i] },
  { tipo: 'carteirinha', fortes: [/n[uú]mero\s+do\s+benefici[aá]rio/i, /carteirinha\s+(virtual|digital)/i],
                        fracas: [/acomoda[cç][aã]o/i, /validade/i, /plano\s+de\s+sa[uú]de/i] },
];

/**
 * Descobre o tipo de um documento. Devolve { tipo, confianca, motivo }.
 * 'desconhecido' quando nada casa — e aí o app trata como documento comum.
 */
export function detectarTipo(txt, nomeArquivo = '') {
  const corpo = normalizar(txt) + '\n' + String(nomeArquivo);
  let melhor = { tipo: 'desconhecido', confianca: 0, motivo: '' };

  for (const a of ASSINATURAS) {
    let p = 0, achou = [];
    for (const r of a.fortes) if (r.test(corpo)) { p += 3; achou.push(r.source); }
    for (const r of a.fracas) if (r.test(corpo)) { p += 1; achou.push(r.source); }
    if (p > melhor.confianca) melhor = { tipo: a.tipo, confianca: p, motivo: achou.join(', ') };
  }
  if (melhor.confianca < 1) return { tipo: 'desconhecido', confianca: 0, motivo: 'sem assinatura reconhecida' };
  return melhor;
}

/* =========================================================================
 * 3. Parsers por tipo
 * ======================================================================= */

/** Campos comuns a qualquer documento do convênio. */
function identificacao(txt) {
  return {
    beneficiario: campo(txt, ['benefici[aá]rio', 'nome do benefici[aá]rio', 'paciente']),
    carteira: campo(txt, ['n[uú]mero do benefici[aá]rio', 'carteira', 'carteirinha', 'matr[ií]cula']),
    plano: campo(txt, ['plano', 'produto', 'contrato']),
    operadora: /amil/i.test(txt) ? 'Amil' : '',
  };
}

/**
 * GUIA DE AUTORIZAÇÃO (SP/SADT, internação, exames).
 * Extrai número, senha, validade, procedimento e prestador — exatamente o que
 * a família precisa ter à mão na hora da consulta.
 */
export function parseGuia(txt) {
  const t = normalizar(txt);
  const senha = campo(t, ['senha de autoriza[cç][aã]o', 'senha']);
  const validade = campo(t, ['validade da senha', 'validade da autoriza[cç][aã]o', 'v[aá]lida at[eé]']);
  const numero = campo(t, ['n[uú]mero da guia', 'guia n[ºo°]', 'n[ºo°] da guia', 'protocolo']);
  const emissao = campo(t, ['data da autoriza[cç][aã]o', 'data de emiss[aã]o', 'data da solicita[cç][aã]o']);
  const procedimento = campo(t, ['procedimento solicitado', 'procedimento', 'descri[cç][aã]o do procedimento']);

  return {
    tipo: 'guia',
    ...identificacao(t),
    numero,
    senha,
    validade: paraIso(validade),
    emissao: paraIso(emissao),
    procedimento: procedimento.replace(/\s{2,}/g, ' ').slice(0, 160),
    prestador: campo(t, ['prestador', 'executante', 'estabelecimento', 'hospital']),
    solicitante: campo(t, ['solicitante', 'profissional solicitante', 'm[eé]dico solicitante']),
  };
}

/**
 * EXTRATO DE UTILIZAÇÃO / FATURA.
 * Cada linha vira um item de utilização (data, procedimento, valor).
 * Aceita tanto CSV (exportação do portal) quanto texto corrido de PDF.
 */
export function parseExtrato(txt) {
  const t = normalizar(txt);
  const id = identificacao(t);
  const itens = [];

  // 1) CSV — cabeçalho com vírgula ou ponto-e-vírgula
  const cabecalho = detectarCabecalhoCsv(t);
  if (cabecalho) {
    itens.push(...itensDeCsv(t, cabecalho));
  } else {
    // 2) texto de PDF — linhas com data + descrição + valor
    for (const linha of linhas(t)) {
      const m = linha.match(/^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+(.{3,}?)\s+(?:R\$\s*)?([\d.]+,\d{2})\s*$/);
      if (!m) continue;
      itens.push({
        data: paraIso(m[1]),
        procedimento: m[2].replace(/\s{2,}/g, ' ').trim(),
        valor: valorNumerico(m[3]),
      });
    }
  }

  return {
    tipo: 'extrato',
    ...id,
    referencia: campo(t, ['per[ií]odo', 'compet[eê]ncia', 'm[eê]s de refer[eê]ncia', 'refer[eê]ncia']),
    itens,
    total: itens.reduce((s, i) => s + (i.valor || 0), 0),
  };
}

/** DEMONSTRATIVO DE REEMBOLSO — protocolo, valor solicitado, valor pago. */
export function parseReembolso(txt) {
  const t = normalizar(txt);
  const itens = [];
  for (const linha of linhas(t)) {
    const m = linha.match(/^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+(.{3,}?)\s+(?:R\$\s*)?([\d.]+,\d{2})(?:\s+(?:R\$\s*)?([\d.]+,\d{2}))?/);
    if (!m) continue;
    itens.push({
      data: paraIso(m[1]),
      descricao: m[2].replace(/\s{2,}/g, ' ').trim(),
      solicitado: valorNumerico(m[3]),
      pago: m[4] != null ? valorNumerico(m[4]) : null,
    });
  }
  return {
    tipo: 'reembolso',
    ...identificacao(t),
    protocolo: campo(t, ['protocolo', 'n[uú]mero do protocolo', 'n[uú]mero do pedido']),
    itens,
    total: itens.reduce((s, i) => s + (i.pago || 0), 0),
  };
}

/** CARTEIRINHA — dados que o app guarda uma vez e nunca mais precisa digitar. */
export function parseCarteirinha(txt) {
  const t = normalizar(txt);
  return {
    tipo: 'carteirinha',
    ...identificacao(t),
    validade: paraIso(campo(t, ['validade', 'v[aá]lido at[eé]', 'data de validade'])),
    acomodacao: campo(t, ['acomoda[cç][aã]o', 'tipo de acomoda[cç][aã]o']),
    abrangencia: campo(t, ['abrang[eê]ncia', 'cobertura', 'segmenta[cç][aã]o']),
    ans: campo(t, ['registro ans', 'ans']),
    nascimento: paraIso(campo(t, ['data de nascimento', 'nascimento'])),
  };
}

/** Dispatcher: escolhe o parser pelo tipo detectado. */
export function parseDocumento(txt, nomeArquivo = '') {
  const det = detectarTipo(txt, nomeArquivo);
  let dados;
  if (det.tipo === 'guia') dados = parseGuia(txt);
  else if (det.tipo === 'reembolso') dados = parseReembolso(txt);
  else if (det.tipo === 'extrato') dados = parseExtrato(txt);
  else if (det.tipo === 'carteirinha') dados = parseCarteirinha(txt);
  else dados = { tipo: 'desconhecido', ...identificacao(txt) };
  return { deteccao: det, dados };
}

/**
 * Classifica um punhado de itens crus (arquivos) em registros por tipo.
 * É pura: NÃO cria id nem data — quem grava carimba. Assim dá para testar a
 * leitura sem tocar no cofre.
 */
export async function classificarItens(itens) {
  const out = { guias: [], faturas: [], carteirinhas: [], desconhecidos: [], originais: [] };
  for (const item of itens) {
    let txt = '';
    try { txt = await textoDoItem(item); } catch { /* sem texto extraível */ }
    const { deteccao, dados } = parseDocumento(txt, item.nome);
    out.originais.push({ item, dados, deteccao });
    const meta = { arquivoNome: item.nome, mime: item.mime };
    if (deteccao.tipo === 'guia') out.guias.push({ ...dados, ...meta });
    else if (deteccao.tipo === 'extrato' || deteccao.tipo === 'reembolso') out.faturas.push({ ...dados, ...meta });
    else if (deteccao.tipo === 'carteirinha') out.carteirinhas.push({ ...dados, ...meta });
    else out.desconhecidos.push({ nome: item.nome, amostra: txt.slice(0, 280) });
  }
  return out;
}

/* ---- CSV helpers -------------------------------------------------------- */

function detectarCabecalhoCsv(t) {
  for (const linha of linhas(t)) {
    const sep = (linha.match(/;/g) || []).length >= (linha.match(/,/g) || []).length ? ';' : ',';
    const cels = linha.split(sep).map((c) => chaveNome(c));
    const temData = cels.some((c) => /data/.test(c));
    const temProc = cels.some((c) => /proced|descri|servi/.test(c));
    const temValor = cels.some((c) => /valor|pago|custo/.test(c));
    if (temData && temProc && temValor) return { sep, cels };
  }
  return null;
}

function itensDeCsv(t, cab) {
  const linhasArr = linhas(t);
  const idx = linhasArr.findIndex((l) => l.split(cab.sep).map((c) => chaveNome(c))
    .join('|') === cab.cels.join('|'));
  const out = [];
  for (let i = idx + 1; i < linhasArr.length; i++) {
    const l = linhasArr[i];
    if (!l.trim()) continue;
    const c = l.split(cab.sep).map((x) => x.replace(/^"|"$/g, '').trim());
    const pega = (re) => {
      const j = cab.cels.findIndex((h) => re.test(h));
      return j >= 0 ? (c[j] || '') : '';
    };
    const data = paraIso(pega(/data/));
    const proc = pega(/proced|descri|servi/);
    if (!proc && !data) continue;
    out.push({
      data,
      procedimento: proc.slice(0, 160),
      valor: valorNumerico(pega(/valor|pago|custo/)),
      prestador: pega(/presta|executante|hospital/),
    });
  }
  return out;
}

/* =========================================================================
 * 4. Conciliação — o coração da importação em lote
 * ======================================================================= */

/** Chave estável de uma linha de utilização, para não duplicar. */
export function chaveUtilizacao(u) {
  return [u.data || '', chaveNome(u.procedimento || u.descricao || ''), u.valor == null ? '' : u.valor].join('|');
}

/**
 * Compara o que chegou com o que já existe e decide o que fazer.
 * Regra igual à do merge do app: identifica por chave e atualiza o mais novo.
 * Devolve { novos, atualizados, iguais }.
 */
export function conciliar(faturasExistentes, faturasNovas) {
  const mapa = new Map((faturasExistentes || []).map((f) => [f.id, f]));
  const porUtilizacao = new Set();
  for (const f of mapa.values()) for (const u of (f.itens || [])) porUtilizacao.add(chaveUtilizacao(u));

  const novos = [], atualizados = [], iguais = [];

  for (const nova of faturasNovas) {
    const existente = nova.id ? mapa.get(nova.id) : null;
    if (!existente) {
      // documento novo: filtra as linhas que já existem em outro importado
      const itensFiltrados = (nova.itens || []).filter((u) => !porUtilizacao.has(chaveUtilizacao(u)));
      novos.push({ ...nova, itens: itensFiltrados, itensDescartados: (nova.itens || []).length - itensFiltrados.length });
      for (const u of itensFiltrados) porUtilizacao.add(chaveUtilizacao(u));
    } else if ((nova.atualizadoEm || 0) > (existente.atualizadoEm || 0)) {
      atualizados.push(nova);
    } else {
      iguais.push(nova.id);
    }
  }
  return { novos, atualizados, iguais };
}

/* =========================================================================
 * 5. Lote (.teruellote) — vários arquivos num só, para importar de uma vez
 * ======================================================================= */

/**
 * Monta um lote a partir de uma lista de arquivos já lidos.
 * entrada: [{ nome, mime, base64, texto?, meta? }]
 */
export function montarLote(entradas, origem = 'manual') {
  return {
    tipo: 'teruel-lote',
    versao: VERSAO_LOTE,
    geradoEm: Date.now(),
    origem,
    itens: entradas,
  };
}

/** Valida um lote antes de consumir. Lança com mensagem clara se inválido. */
export function validarLote(obj) {
  if (!obj || obj.tipo !== 'teruel-lote') throw new Error('Arquivo não é um lote do Canal Teruel.');
  if (!Array.isArray(obj.itens)) throw new Error('Lote sem itens.');
  for (const it of obj.itens) {
    if (!it || !it.base64) throw new Error('Item de lote sem conteúdo.');
  }
  return obj;
}

/** base64 → Uint8Array (sem depender de Buffer, funciona no navegador). */
export function b64ParaBytes(b64) {
  const limpo = String(b64 || '').replace(/^data:[^,]*,/, '');
  const bin = atob(limpo);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** Uint8Array → base64. */
export function bytesParaB64(u8) {
  let bin = '';
  const passo = 8192;
  for (let i = 0; i < u8.length; i += passo) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + passo));
  }
  return btoa(bin);
}

/** Texto legível de um item de lote (usa o texto enviado ou extrai do PDF). */
export async function textoDoItem(item) {
  if (item.texto) return normalizar(item.texto);
  if (item.mime === 'application/pdf' || /\.pdf$/i.test(item.nome || '')) {
    try { return await extrairTextoPdf(b64ParaBytes(item.base64)); } catch { return ''; }
  }
  if (/^text\/|csv|html/.test(item.mime || '') || /\.(txt|csv|html?)$/i.test(item.nome || '')) {
    return normalizar(text(b64ParaBytes(item.base64)));
  }
  return '';
}
