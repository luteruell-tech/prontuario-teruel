/* ============================================================================
 * TERUEL · Modelo de dados, persistência e sincronização  (assets/js/store.js)
 * ----------------------------------------------------------------------------
 * O que fica onde:
 *
 *   localStorage['teruel.cofre']   → metadados do cofre + PIN embrulhado de cada
 *                                    membro (SEM dados de saúde)
 *   localStorage['teruel.dados']   → TODO o prontuário, cifrado (AES-GCM)
 *   IndexedDB  'teruel'/'docs'     → PDFs/imagens dos laudos, cada um cifrado
 *                                    com chave própria derivada da chave-mestra
 *
 * Sincronização entre os 6 aparelhos (pacote .teruel):
 *   O app exporta um arquivo único, cifrado, que pode viajar por WhatsApp,
 *   e-mail, Drive ou pelo canal do Worker. Importar em outro aparelho faz
 *   MERGE campo a campo (o mais recente vence) — ninguém perde anotação.
 * ==========================================================================*/

'use strict';

import {
  bytes, text, sealObject, openObject, documentKey, aesAad,
  encryptBytes, decryptBytes, deriveSubkey, importAesKey,
} from './crypto.js';

export const VERSAO_DADOS = 1;
const LS_COFRE = 'teruel.cofre';
const LS_DADOS = 'teruel.dados';
const IDB_NAME = 'teruel';
const IDB_STORE = 'docs';

/* =========================================================================
 * 0. Pequeno wrapper de IndexedDB (promessas)
 * ======================================================================= */
function idbAbrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(op, key, value) {
  const db = await idbAbrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, value === undefined && op === 'get' ? 'readonly' : 'readwrite');
    const st = tx.objectStore(IDB_STORE);
    let r;
    if (op === 'get') r = st.get(key);
    else if (op === 'put') r = st.put(value, key);
    else if (op === 'del') r = st.delete(key);
    else if (op === 'keys') r = st.getAllKeys();
    else if (op === 'all') r = st.getAll();
    else if (op === 'clear') r = st.clear();
    tx.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/* =========================================================================
 * 1. Estado inicial — cadastro dos dois idosos e da equipe da família
 * ======================================================================= */

/** Os dois pacientes-base do acompanhamento. Editáveis depois, sem perder id. */
export function pacientesBase() {
  return [
    {
      id: 'pac-maria',
      nome: 'Maria Izaulina',
      apelido: 'Dona Maria',
      nascimento: '',
      tipoSanguineo: '',
      convenio: '',
      unidade: '',
      condicoes: ['Diabetes', 'Hipertensão', 'Stent carótida', 'Osteoporose',
        'Fibromialgia', 'Hérnia cervical/lombar', 'Memória em piora'],
      alergias: [],
      contatos: [],
      observacoes: 'Histórico vascular/metabólico com múltiplas comorbidades crônicas. '
        + 'Relato familiar de piora progressiva de memória recente — investigação diferencial em andamento.',
      avatarEmoji: '👩',
      cor: '#B4634F',
      criadoEm: 0, atualizadoEm: 0,
    },
    {
      id: 'pac-joao',
      nome: 'João Teruel',
      apelido: 'Seu João',
      nascimento: '',
      tipoSanguineo: '',
      convenio: '',
      unidade: '',
      condicoes: ['4 AVCs', 'Sequela motora à esquerda', 'Cadeirante', 'Stent carótida', 'Neoplasia de bexiga'],
      alergias: [],
      contatos: [],
      observacoes: 'Eventos cerebrovasculares recorrentes com sequela motora importante. '
        + 'Neoplasia de bexiga em acompanhamento. Creatinina elevada (1,9 mg/dL em 03/03/2026) — monitorar função renal.',
      avatarEmoji: '👨',
      cor: '#4F6FA8',
      criadoEm: 0, atualizadoEm: 0,
    },
  ];
}

/** Estrutura vazia completa. Toda coleção é uma lista (merge trivial por id). */
export function estadoInicial() {
  return {
    versao: VERSAO_DADOS,
    pacientes: pacientesBase(),
    eventos: [],        // consultas, exames agendados, internações, terapias
    medicamentos: [],   // prescrições ativas e suspensas
    doses: [],          // registro de cada dose dada (o que a família mais precisa)
    sinais: [],         // PA, glicemia, peso, temperatura, saturação, dor
    exames: [],         // resultados e laudos estruturados
    documentos: [],     // metadados de arquivos (o arquivo em si fica no IDB)
    mural: [],          // canal seguro da família (avisos, combinados, escalas)
    diario: [],         // evolução clínica relatada (o "como ela está hoje")
    auditoria: [],      // quem fez o quê e quando (LGPD: rastreabilidade)
    dor: { credenciais: {}, monitorias: [], ultimaSincronizacao: 0 },
    // Amil: extrato de utilização (faturas/reembolsos), carteirinhas e as
    // credenciais cifradas do portal. Nada aqui é preenchido por login
    // automático — tudo vem de arquivo que a própria família importa.
    amil: { credenciais: {}, carteirinhas: [], faturas: [], guias: [], ultimaConferencia: 0 },
    config: { unidades: [], sincronizacaoUrl: '', nomeCanal: 'Canal Teruel' },
    lixeira: {},        // { colecao: { id: timestamp } } — respeita exclusões no merge
  };
}

/* =========================================================================
 * 2. Sessão do cofre em memória
 * ======================================================================= */
export const sessao = {
  master: null,        // Uint8Array da chave-mestra (só em memória, nunca gravado)
  vaultKey: null,      // CryptoKey derivada para cifrar o cofre inteiro
  fingerprint: '',     // identificador legível do cofre
  membro: null,        // { id, nome, papel, ... } do usuário conectado
  pronto: false,
};

/** Bloqueia: apaga chaves da memória. Chamado ao sair, na inatividade e ao fechar. */
export function bloquear() {
  if (sessao.master) sessao.master.fill(0);
  sessao.master = null;
  sessao.vaultKey = null;
  sessao.membro = null;
  sessao.pronto = false;
}

export function estaDesbloqueado() { return !!sessao.vaultKey; }

/* =========================================================================
 * 3. Metadados do cofre (o que existe antes do login)
 * ======================================================================= */

export function lerCofre() {
  const raw = localStorage.getItem(LS_COFRE);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function gravarCofre(c) { localStorage.setItem(LS_COFRE, JSON.stringify(c)); }

export function existeCofre() { return !!lerCofre(); }

/** Lista pública dos membros (apenas nome/papel — nada de saúde). Para a tela de entrada. */
export function membrosPublicos() {
  const c = lerCofre();
  if (!c) return [];
  return (c.membros || []).map((m) => ({
    id: m.id, nome: m.nome, papel: m.papel, avatarEmoji: m.avatarEmoji, cor: m.cor, ativo: m.ativo !== false,
  }));
}

/* =========================================================================
 * 4. Estado em memória + persistência
 * ======================================================================= */
export let estado = estadoInicial();
let salvarTimer = null;

/** Substitui o estado inteiro (usado ao criar/importar um cofre novo). */
export function setEstado(novo) { estado = normalizar(novo || estadoInicial()); return estado; }

/**
 * Chave que cifra o COFRE INTEIRO — derivada da chave-mestra, NÃO do PIN.
 *
 * Isto é essencial: cada membro tem um PIN diferente, então usar a chave do PIN
 * faria com que só quem criou o cofre conseguisse ler os dados. Derivando da
 * chave-mestra, todos os membros (que desembrulham a MESMA chave-mestra)
 * chegam exatamente à mesma chave de cofre e leem o mesmo conteúdo.
 */
export async function chaveDoCofre(masterU8) {
  return importAesKey(await deriveSubkey(masterU8, 'vault'));
}


/** Carrega e decifra o cofre. Lança se não houver cofre. */
export async function carregarEstado() {
  const raw = localStorage.getItem(LS_DADOS);
  if (!raw) { estado = estadoInicial(); return estado; }
  const payload = JSON.parse(raw);
  const obj = await openObject(sessao.vaultKey, payload, aesAad('estado'));
  estado = normalizar(obj || estadoInicial());
  return estado;
}

/** Garante que todas as coleções existem (compatibilidade entre versões). */
function normalizar(e) {
  const base = estadoInicial();
  const out = { ...base, ...e };
  for (const k of ['pacientes', 'eventos', 'medicamentos', 'doses', 'sinais', 'exames',
    'documentos', 'mural', 'diario', 'auditoria']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  out.lixeira = out.lixeira || {};
  out.dor = { ...base.dor, ...(out.dor || {}) };
  out.config = { ...base.config, ...(out.config || {}) };
  out.amil = { ...base.amil, ...(out.amil || {}) };
  out.amil.credenciais = out.amil.credenciais || {};
  for (const col of ['faturas', 'carteirinhas', 'guias']) {
    if (!Array.isArray(out.amil[col])) out.amil[col] = [];
  }
  return out;
}

/** Grava o cofre cifrado (com debounce — evita escrever a cada tecla). */
export function salvar(forcar = false) {
  if (!sessao.vaultKey) return Promise.resolve();
  if (salvarTimer) clearTimeout(salvarTimer);
  const fazer = async () => {
    salvarTimer = null;
    estado.atualizadoEm = Date.now();
    const payload = await sealObject(sessao.vaultKey, estado, aesAad('estado'));
    localStorage.setItem(LS_DADOS, JSON.stringify(payload));
  };
  if (forcar) return fazer();
  return new Promise((res) => { salvarTimer = setTimeout(() => fazer().then(res), 250); });
}

/* =========================================================================
 * 5. Auditoria — toda ação relevante é registrada
 * ======================================================================= */
export function auditar(acao, detalhe = '', pacienteId = null) {
  estado.auditoria.unshift({
    id: 'aud-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    em: Date.now(),
    membroId: sessao.membro ? sessao.membro.id : null,
    membroNome: sessao.membro ? sessao.membro.nome : 'Sistema',
    acao, detalhe, pacienteId,
  });
  if (estado.auditoria.length > 1500) estado.auditoria.length = 1500;
}

/* =========================================================================
 * 6. Helpers de coleção (CRUD simples e seguro)
 * ======================================================================= */
export function novoId(prefixo) {
  return prefixo + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function inserir(colecao, item) {
  item.criadoEm = item.criadoEm || Date.now();
  item.atualizadoEm = Date.now();
  item.criadoPor = sessao.membro ? sessao.membro.id : null;
  estado[colecao].unshift(item);
  delete (estado.lixeira[colecao] || {})[item.id];
  salvar();
  return item;
}

export function atualizar(colecao, id, mudancas) {
  const it = estado[colecao].find((x) => x.id === id);
  if (!it) return null;
  Object.assign(it, mudancas, { atualizadoEm: Date.now() });
  salvar();
  return it;
}

export function remover(colecao, id) {
  estado[colecao] = estado[colecao].filter((x) => x.id !== id);
  estado.lixeira[colecao] = estado.lixeira[colecao] || {};
  estado.lixeira[colecao][id] = Date.now();
  salvar();
  return true;
}

export function porId(colecao, id) { return estado[colecao].find((x) => x.id === id) || null; }

/* =========================================================================
 * 7. Documentos cifrados (laudos, receitas, fotos) no IndexedDB
 * ======================================================================= */

/** Guarda um arquivo (File/Blob) cifrado com chave própria do documento. */
export async function guardarArquivo(docId, blob) {
  const key = await documentKey(sessao.master, docId);
  const buf = new Uint8Array(await blob.arrayBuffer());
  const payload = await encryptBytes(key, buf, 'doc:' + docId);
  await idb('put', docId, payload);
  return payload;
}

/** Recupera o arquivo decifrado como Blob, pronto para abrir/baixar. */
export async function lerArquivo(docId) {
  const payload = await idb('get', docId);
  if (!payload) return null;
  const key = await documentKey(sessao.master, docId);
  const u8 = await decryptBytes(key, payload, 'doc:' + docId);
  return u8;
}

export async function apagarArquivo(docId) { return idb('del', docId); }

export async function listarArquivos() { return idb('keys'); }

/** Abre um documento numa nova aba (PDF/imagem) usando Blob URL. */
export async function abrirDocumento(docId, mime) {
  const u8 = await lerArquivo(docId);
  if (!u8) throw new Error('Documento não encontrado neste aparelho.');
  const blob = new Blob([u8], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

/** Força o download de um documento. */
export async function baixarDocumento(docId, nome, mime) {
  const u8 = await lerArquivo(docId);
  if (!u8) throw new Error('Documento não encontrado neste aparelho.');
  const blob = new Blob([u8], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome || docId;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* =========================================================================
 * 7b. Segredos avulsos (ex.: credenciais do portal do convênio)
 * ======================================================================= */

/** Chave dedicada para segredos avulsos — separada da chave do cofre. */
async function chaveSegredos() {
  return importAesKey(await deriveSubkey(sessao.master, 'segredos'));
}

/** Cifra uma string curta (usuário/senha de portal) com chave própria. */
export async function selarSegredo(texto) {
  if (!texto) return null;
  return sealObject(await chaveSegredos(), { v: texto }, aesAad('segredo'));
}

/** Devolve o texto original; null se não der para abrir. */
export async function abrirSegredo(payload) {
  if (!payload) return null;
  try {
    const o = await openObject(await chaveSegredos(), payload, aesAad('segredo'));
    return o ? o.v : null;
  } catch { return null; }
}

/* =========================================================================
 * 8. Merge — o coração da sincronização entre os 6 aparelhos
 * ======================================================================= *
 * Regra: por item, vence quem tem `atualizadoEm` mais recente.
 * Exclusão é respeitada via lixeira (tombstone com data), para que um aparelho
 * que ainda não sabia da exclusão não "ressuscite" o registro.
 * ======================================================================= */
const COLECOES = ['pacientes', 'eventos', 'medicamentos', 'doses', 'sinais',
  'exames', 'documentos', 'mural', 'diario'];

function carimbo(item) {
  return item.atualizadoEm || item.criadoEm || item.em || 0;
}

export function mesclar(outro) {
  const resultado = { pacientes: 0, eventos: 0, medicamentos: 0, doses: 0, sinais: 0, exames: 0, documentos: 0, mural: 0, diario: 0, exclusoes: 0, conflitos: 0 };

  for (const col of COLECOES) {
    const mapaLocal = new Map((estado[col] || []).map((x) => [x.id, x]));
    const lixeiraLocal = estado.lixeira[col] || {};
    const lixeiraOutra = (outro.lixeira || {})[col] || {};

    // aplica exclusões vindas do outro aparelho
    for (const [id, quando] of Object.entries(lixeiraOutra)) {
      const local = mapaLocal.get(id);
      if (local && carimbo(local) < quando) {
        estado[col] = estado[col].filter((x) => x.id !== id);
        mapaLocal.delete(id);
        lixeiraLocal[id] = quando;
        resultado.exclusoes++;
      }
    }

    // insere/atualiza itens
    for (const remoto of (outro[col] || [])) {
      if (lixeiraLocal[remoto.id] && carimbo(remoto) <= lixeiraLocal[remoto.id]) continue;
      const local = mapaLocal.get(remoto.id);
      if (!local) {
        estado[col].push(remoto);
        mapaLocal.set(remoto.id, remoto);
        resultado[col] = (resultado[col] || 0) + 1;
      } else if (carimbo(remoto) > carimbo(local)) {
        Object.assign(local, remoto);
        resultado[col] = (resultado[col] || 0) + 1;
      } else if (carimbo(remoto) === carimbo(local) && carimbo(remoto) > 0) {
        resultado.conflitos++;
      }
    }
    estado.lixeira[col] = lixeiraLocal;
  }

  // coleções "singleton"
  if (outro.config && (outro.config.atualizadoEm || 0) > (estado.config.atualizadoEm || 0)) {
    estado.config = { ...estado.config, ...outro.config };
  }
  if (outro.dor) {
    estado.dor.monitorias = mesclarLista(estado.dor.monitorias, outro.dor.monitorias, 'id');
    estado.dor.credenciais = { ...estado.dor.credenciais, ...(outro.dor.credenciais || {}) };
    estado.dor.ultimaSincronizacao = Math.max(estado.dor.ultimaSincronizacao || 0, outro.dor.ultimaSincronizacao || 0);
  }
  if (outro.amil) {
    estado.amil.faturas = mesclarLista(estado.amil.faturas, outro.amil.faturas, 'id');
    estado.amil.carteirinhas = mesclarLista(estado.amil.carteirinhas, outro.amil.carteirinhas, 'id');
    estado.amil.guias = mesclarLista(estado.amil.guias, outro.amil.guias, 'id');
    estado.amil.credenciais = { ...estado.amil.credenciais, ...(outro.amil.credenciais || {}) };
    estado.amil.ultimaConferencia = Math.max(estado.amil.ultimaConferencia || 0, outro.amil.ultimaConferencia || 0);
  }
  estado.auditoria = mesclarLista(estado.auditoria, outro.auditoria || [], 'id').slice(0, 1500);

  estado.atualizadoEm = Date.now();
  return resultado;
}

function mesclarLista(a, b, chave) {
  const mapa = new Map((a || []).map((x) => [x[chave], x]));
  for (const item of (b || [])) {
    const cur = mapa.get(item[chave]);
    if (!cur) mapa.set(item[chave], item);
    else if (carimbo(item) > carimbo(cur)) Object.assign(cur, item);
  }
  return [...mapa.values()].sort((x, y) => carimbo(y) - carimbo(x));
}

/* =========================================================================
 * 9. Pacote de sincronização (.teruel)
 * ======================================================================= */

/**
 * Exporta TUDO (prontuário + arquivos) num único objeto cifrado.
 * O arquivo resultante só abre com a chave-mestra do cofre — pode circular
 * por WhatsApp/e-mail sem virar dado de saúde exposto.
 */
export async function exportarPacote(incluirArquivos = true) {
  const pacote = {
    tipo: 'teruel-pacote',
    versao: VERSAO_DADOS,
    fingerprint: sessao.fingerprint,
    geradoEm: Date.now(),
    geradoPor: sessao.membro ? sessao.membro.nome : '',
    dados: estado,
    arquivos: {},
  };

  if (incluirArquivos) {
    for (const doc of estado.documentos) {
      if (!doc.arquivoId) continue;
      const payload = await idb('get', doc.arquivoId);
      if (payload) pacote.arquivos[doc.arquivoId] = payload;
    }
  }

  const selado = await sealObject(sessao.vaultKey, pacote, aesAad('pacote'));
  return {
    json: JSON.stringify({
      tipo: 'teruel',
      versao: VERSAO_DADOS,
      fingerprint: sessao.fingerprint,
      geradoEm: pacote.geradoEm,
      selado,
    }, null, 0),
    nomeArquivo: 'canal-teruel-' + new Date().toISOString().slice(0, 10) + '.teruel',
  };
}

/** Lê um pacote recebido de outro aparelho e devolve o conteúdo em claro. */
export async function lerPacote(jsonTexto) {
  const env = JSON.parse(jsonTexto);
  if (!env || env.tipo !== 'teruel' || !env.selado) {
    throw new Error('Arquivo inválido: não é um pacote do Canal Teruel.');
  }
  const pacote = await openObject(sessao.vaultKey, env.selado, aesAad('pacote'));
  if (!pacote) throw new Error('Não foi possível abrir o pacote (chave diferente?).');
  return { env, pacote };
}

/** Importa pacote: mescla dados e grava os arquivos que ainda não existem aqui. */
export async function importarPacote(jsonTexto) {
  const { env, pacote } = await lerPacote(jsonTexto);
  const resumo = mesclar(pacote.dados);

  let arquivosGravados = 0;
  const existentes = new Set(estado.documentos.map((d) => d.arquivoId).filter(Boolean));
  for (const [arquivoId, payload] of Object.entries(pacote.arquivos || {})) {
    const jaTem = await idb('get', arquivoId);
    if (!jaTem) { await idb('put', arquivoId, payload); arquivosGravados++; }
  }
  if (existentes.size === 0 && arquivosGravados === 0) { /* nada a fazer */ }

  auditar('importacao', `Pacote de ${env.geradoEm ? new Date(env.geradoEm).toLocaleString('pt-BR') : '?'} · `
    + `${arquivosGravados} arquivo(s) novo(s)`);
  await salvar(true);
  return { resumo, arquivosGravados };
}

/* =========================================================================
 * 10. Sincronização por servidor (opcional, quando houver deploy)
 * ======================================================================= */

/** Baixa o último estado do canal e mescla. Retorna null se o canal estiver vazio. */
export async function puxarDoSincronizador() {
  const url = estado.config.sincronizacaoUrl;
  if (!url) throw new Error('Nenhum canal de sincronização configurado.');
  const r = await fetch(url.replace(/\/$/, '') + '/estado', { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Canal indisponível (' + r.status + ').');
  const env = await r.json();
  if (!env || !env.selado) return null;
  const pacote = await openObject(sessao.vaultKey, env.selado, aesAad('pacote'));
  const resumo = mesclar(pacote.dados);
  estado.dor.ultimaSincronizacao = Date.now();
  await salvar(true);
  return resumo;
}

/** Envia o estado atual para o canal (já cifrado — o servidor não lê nada). */
export async function enviarParaSincronizador() {
  const url = estado.config.sincronizacaoUrl;
  if (!url) throw new Error('Nenhum canal de sincronização configurado.');
  const { json } = await exportarPacote(false);
  const env = JSON.parse(json);
  const r = await fetch(url.replace(/\/$/, '') + '/estado', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fingerprint: sessao.fingerprint, selado: env.selado, geradoEm: env.geradoEm }),
  });
  if (!r.ok) throw new Error('Falha ao publicar (' + r.status + ').');
  estado.dor.ultimaSincronizacao = Date.now();
  await salvar(true);
  return true;
}

/* =========================================================================
 * 11. Estatísticas para o painel
 * ======================================================================= */
export function agoraProximo() {
  const t = Date.now();
  const futuros = estado.eventos
    .filter((e) => e.inicio && new Date(e.inicio).getTime() >= t && e.status !== 'cancelado')
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  return futuros[0] || null;
}

export function eventosDoDia(data = new Date()) {
  const ini = new Date(data); ini.setHours(0, 0, 0, 0);
  const fim = new Date(ini.getTime() + 86400000);
  return estado.eventos
    .filter((e) => { const d = new Date(e.inicio); return d >= ini && d < fim && e.status !== 'cancelado'; })
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
}

export function dosesPendentesHoje() {
  const ini = new Date(); ini.setHours(0, 0, 0, 0);
  const registro = new Set(estado.doses.filter((d) => d.horario >= ini.getTime()).map((d) => d.medicamentoId + '|' + d.janela));
  const pend = [];
  for (const m of estado.medicamentos.filter((m) => m.ativo !== false)) {
    const hoje = new Date().getDay();
    if (m.diasSemana && m.diasSemana.length && !m.diasSemana.includes(hoje)) continue;
    for (const h of (m.horarios || [])) {
      const [hh, mm] = String(h).split(':').map(Number);
      const quando = new Date(); quando.setHours(hh || 0, mm || 0, 0, 0);
      if (quando < new Date(ini.getTime() - 3600000)) continue; // janela já passada
      if (!registro.has(m.id + '|' + h)) pend.push({ medicamento: m, horario: h, quando });
    }
  }
  return pend.sort((a, b) => a.quando - b.quando);
}

export function ultimosSinais(pacienteId, tipo, limite = 12) {
  return estado.sinais
    .filter((s) => s.pacienteId === pacienteId && (!tipo || s.tipo === tipo))
    .sort((a, b) => b.medidoEm - a.medidoEm)
    .slice(0, limite);
}

export function resumoDocumentos() {
  const total = estado.documentos.length;
  const porPaciente = {};
  for (const d of estado.documentos) porPaciente[d.pacienteId] = (porPaciente[d.pacienteId] || 0) + 1;
  return { total, porPaciente };
}
