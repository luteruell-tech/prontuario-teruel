/* ============================================================================
 * TERUEL · Autenticação, papéis e sessão  (assets/js/auth.js)
 * ----------------------------------------------------------------------------
 * Cada membro da família tem o SEU PIN. Todos abrem o MESMO cofre, porque o
 * PIN de cada um embrulha (wrap) a mesma chave-mestra da família.
 *
 * Consequências práticas:
 *   · ninguém precisa compartilhar senha;
 *   · tirar o acesso de alguém = apagar o embrulho daquele membro;
 *   · o PIN nunca é gravado — só o resultado do PBKDF2, e ainda cifrado.
 * ==========================================================================*/

'use strict';

import {
  KDF, randomBytes, toB64, fromB64, bytes,
  keyFromPin, newMasterKey, wrapMasterForMember, unwrapMasterForMember,
  keyFingerprint, sha256Hex, sealObject, openObject, aesAad, pinStrength,
} from './crypto.js';
import {
  lerCofre, gravarCofre, existeCofre, sessao, bloquear, carregarEstado,
  estadoInicial, setEstado, salvar, auditar, membrosPublicos, chaveDoCofre,
} from './store.js';

export const PAPEIS = {
  admin:   { nome: 'Gestor(a)',  desc: 'Acesso total: equipe, credenciais, auditoria, configurações e exclusões.',
             cor: '#1540C4' },
  editor:  { nome: 'Editor(a)',  desc: 'Registra e edita agenda, medicações, sinais, exames e documentos.',
             cor: '#0A7B6B' },
  cuidador:{ nome: 'Cuidador(a)',desc: 'Registra doses, sinais vitais, diário e recados no mural.',
             cor: '#9A6500' },
  leitor:  { nome: 'Observador(a)', desc: 'Somente leitura: acompanha tudo, sem alterar dados.',
             cor: '#6E7F96' },
};

/* Matriz de permissões — um único lugar para decidir quem pode o quê. */
const PERMISSOES = {
  admin:    ['ver', 'escrever', 'gerirEquipe', 'gerirCredenciais', 'gerirConfig', 'excluir', 'verAuditoria', 'sincronizar'],
  editor:   ['ver', 'escrever', 'verAuditoria', 'sincronizar'],
  cuidador: ['ver', 'escrever'],
  leitor:   ['ver'],
};

/** A pessoa conectada pode executar esta ação? */
export function pode(acao) {
  if (!sessao.membro) return false;
  const p = PERMISSOES[sessao.membro.papel] || [];
  return p.includes(acao);
}

/** Atalho para esconder/desabilitar botões na interface. */
export function exigir(acao) {
  if (!pode(acao)) throw new Error('Seu perfil (' + (PAPEIS[sessao.membro?.papel]?.nome || '?') + ') não tem permissão para isso.');
  return true;
}

/* =========================================================================
 * 1. Criação do cofre (primeira vez, no aparelho de quem organiza)
 * ======================================================================= */

/**
 * Cria o cofre da família.
 * @param {object} dados { nomeCanal, membro: { nome, papel, avatarEmoji, cor, pin } }
 * @returns {object} { chaveRecuperacao, fingerprint }
 */
export async function criarCofre({ nomeCanal = 'Canal Teruel', membro }) {
  const forca = pinStrength(membro.pin);
  if (!forca.ok) throw new Error('O PIN precisa ter ao menos 6 caracteres e não pode ser óbvio.');

  const master = newMasterKey();
  const fingerprint = await keyFingerprint(master);

  const saltMembro = randomBytes(KDF.SALT_BYTES);
  const { key: pinKey } = await keyFromPin(membro.pin, saltMembro);
  const membroId = 'mem-' + Date.now().toString(36);
  const blob = await wrapMasterForMember(master, pinKey, membroId);

  // Chave de recuperação: string longa, gerada aleatoriamente, que também
  // embrulha a chave-mestra. Deve ser impressa e guardada em local físico.
  const chaveRecuperacao = gerarChaveRecuperacao();
  const saltRec = randomBytes(KDF.SALT_BYTES);
  const { key: recKey } = await keyFromPin(chaveRecuperacao, saltRec);

  const cofre = {
    versao: 1,
    nome: nomeCanal,
    fingerprint,
    criadoEm: Date.now(),
    kdf: { iteracoes: KDF.ITERATIONS, hash: KDF.HASH },
    membros: [novaEntradaMembro({ ...membro, id: membroId }, saltMembro, blob)],
    recuperacao: {
      salt: toB64(saltRec),
      blob: await wrapMasterForMember(master, recKey, 'recuperacao'),
      criadoEm: Date.now(),
    },
  };

  gravarCofre(cofre);

  // Abre a sessão já com o cofre pronto.
  // A chave do cofre é derivada da CHAVE-MESTRA (não do PIN): é isto que faz
  // todos os membros — com PINs diferentes — lerem exatamente os mesmos dados.
  cofre.membros[0].ultimoAcesso = Date.now();
  gravarCofre(cofre);

  sessao.master = master;
  sessao.vaultKey = await chaveDoCofre(master);
  sessao.fingerprint = fingerprint;
  sessao.membro = membroPublico(cofre.membros[0]);
  sessao.pronto = true;

  setEstado(estadoInicial());
  auditar('cofre-criado', 'Cofre da família criado neste aparelho.');
  await salvar(true);

  return { chaveRecuperacao, fingerprint };
}

function gerarChaveRecuperacao() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem caracteres ambíguos
  const b = randomBytes(24);
  let s = '';
  for (let i = 0; i < 24; i++) s += alfabeto[b[i] % alfabeto.length];
  return (s.match(/.{1,4}/g) || []).join('-');
}

function novaEntradaMembro(m, salt, blob) {
  return {
    id: m.id,
    nome: m.nome,
    papel: m.papel || 'editor',
    avatarEmoji: m.avatarEmoji || '🙂',
    cor: m.cor || '#1540C4',
    ativo: true,
    salt: toB64(salt),
    blob,
    criadoEm: Date.now(),
    ultimoAcesso: 0,
    precisaTrocarPin: !!m.precisaTrocarPin,
    observacao: m.observacao || '',
  };
}

function membroPublico(m) {
  return { id: m.id, nome: m.nome, papel: m.papel, avatarEmoji: m.avatarEmoji, cor: m.cor };
}

/* =========================================================================
 * 2. Entrar no cofre
 * ======================================================================= */

/**
 * Abre o cofre com o PIN de um membro.
 * Lança erro com mensagem clara se o PIN estiver errado.
 */
export async function entrar(membroId, pin) {
  const cofre = lerCofre();
  if (!cofre) throw new Error('Nenhum cofre neste aparelho. Crie um ou importe o convite da família.');

  const m = (cofre.membros || []).find((x) => x.id === membroId);
  if (!m) throw new Error('Membro não encontrado.');
  if (m.ativo === false) throw new Error('Este acesso foi desativado pelo gestor do canal.');
  if (!pin) throw new Error('Informe o PIN.');

  const { key: pinKey } = await keyFromPin(pin, fromB64(m.salt), cofre.kdf?.iteracoes || KDF.ITERATIONS);

  let master;
  try {
    master = await unwrapMasterForMember(pinKey, m.blob, m.id);
  } catch {
    throw new Error('PIN incorreto. Se esqueceu, use a chave de recuperação.');
  }

  sessao.master = master;
  sessao.vaultKey = await chaveDoCofre(master);
  sessao.fingerprint = cofre.fingerprint || await keyFingerprint(master);
  sessao.membro = membroPublico(m);
  sessao.pronto = true;

  m.ultimoAcesso = Date.now();
  gravarCofre(cofre);

  try {
    await carregarEstado();
  } catch (e) {
    // PIN correto mas dados ilegíveis: não deixa a sessão pela metade
    bloquear();
    throw new Error('A chave abriu, mas os dados não puderam ser lidos. O cofre pode estar corrompido.');
  }

  auditar('entrou', 'Acesso ao canal liberado.');
  await salvar(true);
  return sessao.membro;
}

/** Abre o cofre com a chave de recuperação (gestor que perdeu o PIN). */
export async function entrarComRecuperacao(chave) {
  const cofre = lerCofre();
  if (!cofre || !cofre.recuperacao) throw new Error('Este cofre não tem chave de recuperação.');
  const { key: recKey } = await keyFromPin(chave.trim().toUpperCase(), fromB64(cofre.recuperacao.salt),
    cofre.kdf?.iteracoes || KDF.ITERATIONS);
  try {
    await unwrapMasterForMember(recKey, cofre.recuperacao.blob, 'recuperacao');
  } catch {
    throw new Error('Chave de recuperação inválida.');
  }
  return true; // apenas valida; o gestor então redefine o próprio PIN
}

/* =========================================================================
 * 3. Equipe (gestão de membros)
 * ======================================================================= */

/** Adiciona um membro com PIN próprio, embrulhando a chave-mestra para ele. */
export async function adicionarMembro({ nome, papel, avatarEmoji, cor, pin, observacao }) {
  exigir('gerirEquipe');
  const forca = pinStrength(pin);
  if (!forca.ok) throw new Error('PIN fraco (' + forca.label + '). Use ao menos 6 caracteres.');

  const cofre = lerCofre();
  const id = 'mem-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const salt = randomBytes(KDF.SALT_BYTES);
  const { key: pinKey } = await keyFromPin(pin, salt);
  const blob = await wrapMasterForMember(sessao.master, pinKey, id);

  cofre.membros.push(novaEntradaMembro({ id, nome, papel, avatarEmoji, cor, observacao }, salt, blob));
  gravarCofre(cofre);
  auditar('membro-adicionado', `${nome} · ${PAPEIS[papel]?.nome || papel}`);
  return id;
}

/** Troca o papel de um membro (ex.: cuidador → editor). */
export function alterarPapel(membroId, papel) {
  exigir('gerirEquipe');
  const cofre = lerCofre();
  const m = cofre.membros.find((x) => x.id === membroId);
  if (!m) throw new Error('Membro não encontrado.');
  const antigo = m.papel;
  m.papel = papel;
  gravarCofre(cofre);
  auditar('papel-alterado', `${m.nome}: ${PAPEIS[antigo]?.nome || antigo} → ${PAPEIS[papel]?.nome || papel}`);
}

/** Ativa/desativa acesso sem apagar histórico (mantém a cadeira na equipe). */
export function ativarMembro(membroId, ativo) {
  exigir('gerirEquipe');
  const cofre = lerCofre();
  const m = cofre.membros.find((x) => x.id === membroId);
  if (!m) throw new Error('Membro não encontrado.');
  if (m.id === sessao.membro.id && !ativo) throw new Error('Você não pode desativar o seu próprio acesso.');
  m.ativo = !!ativo;
  gravarCofre(cofre);
  auditar('membro-' + (ativo ? 'reativado' : 'desativado'), m.nome);
}

/** Remove definitivamente o acesso (o nome nos registros antigos é preservado). */
export function removerMembro(membroId) {
  exigir('gerirEquipe');
  const cofre = lerCofre();
  const m = cofre.membros.find((x) => x.id === membroId);
  if (!m) throw new Error('Membro não encontrado.');
  if (m.id === sessao.membro.id) throw new Error('Você não pode remover o seu próprio acesso.');
  if (cofre.membros.filter((x) => x.papel === 'admin' && x.ativo !== false).length <= 1 && m.papel === 'admin') {
    throw new Error('É preciso manter ao menos um gestor ativo no canal.');
  }
  cofre.membros = cofre.membros.filter((x) => x.id !== membroId);
  gravarCofre(cofre);
  auditar('membro-removido', m.nome);
}

/** Detalhes completos da equipe (para a tela Equipe). */
export function equipe() {
  const cofre = lerCofre() || { membros: [] };
  return cofre.membros.map((m) => ({ ...m, blob: undefined, salt: undefined }));
}

/* =========================================================================
 * 4. Troca de PIN
 * ======================================================================= */

/** Troca o PIN do próprio membro (exige o PIN atual quando não é o gestor). */
export async function trocarMeuPin(pinAtual, pinNovo) {
  const cofre = lerCofre();
  const m = cofre.membros.find((x) => x.id === sessao.membro.id);
  if (!m) throw new Error('Membro não encontrado.');

  const { key: atualKey } = await keyFromPin(pinAtual, fromB64(m.salt), cofre.kdf?.iteracoes || KDF.ITERATIONS);
  try {
    await unwrapMasterForMember(atualKey, m.blob, m.id);
  } catch {
    throw new Error('PIN atual incorreto.');
  }

  const forca = pinStrength(pinNovo);
  if (!forca.ok) throw new Error('PIN novo fraco (' + forca.label + ').');

  const salt = randomBytes(KDF.SALT_BYTES);
  const { key: novaKey } = await keyFromPin(pinNovo, salt);
  m.salt = toB64(salt);
  m.blob = await wrapMasterForMember(sessao.master, novaKey, m.id);
  m.precisaTrocarPin = false;
  gravarCofre(cofre);

  // a chave do cofre não muda ao trocar o PIN: ela deriva da chave-mestra.
  // (manter a sessão viva é só uma questão de não apagar nada aqui)
  auditar('pin-trocado', 'PIN pessoal atualizado.');
  await salvar(true);
}

/** Gestor redefine o PIN de outro membro (o dono deve trocar depois). */
export async function redefinirPinDe(membroId, pinNovo) {
  exigir('gerirEquipe');
  const forca = pinStrength(pinNovo);
  if (!forca.ok) throw new Error('PIN novo fraco (' + forca.label + ').');
  const cofre = lerCofre();
  const m = cofre.membros.find((x) => x.id === membroId);
  if (!m) throw new Error('Membro não encontrado.');
  const salt = randomBytes(KDF.SALT_BYTES);
  const { key } = await keyFromPin(pinNovo, salt);
  m.salt = toB64(salt);
  m.blob = await wrapMasterForMember(sessao.master, key, m.id);
  m.precisaTrocarPin = true;
  gravarCofre(cofre);
  auditar('pin-redefinido', m.nome);
}

/* =========================================================================
 * 5. Sair e bloqueio automático
 * ======================================================================= */
export function sair() {
  if (sessao.membro) auditar('saiu', 'Sessão encerrada.');
  bloquear();
}

let timerInatividade = null;
const MS_INATIVIDADE = 15 * 60 * 1000; // 15 minutos

/** Liga o bloqueio automático por inatividade. */
export function ligarBloqueioAutomatico(aoBloquear) {
  const reiniciar = () => {
    if (timerInatividade) clearTimeout(timerInatividade);
    if (!sessao.pronto) return;
    timerInatividade = setTimeout(() => { sair(); aoBloquear && aoBloquear(); }, MS_INATIVIDADE);
  };
  ['pointerdown', 'keydown', 'visibilitychange'].forEach((ev) =>
    document.addEventListener(ev, reiniciar, { passive: true }));
  reiniciar();
}

/* =========================================================================
 * 6. Convite para outro aparelho
 * ======================================================================= */

/**
 * Gera o "convite" — leva o cofre (metadados + dados cifrados) para outro
 * aparelho. Quem importar entra com o PIN que já tem. Nada em texto claro.
 */
export async function exportarConvite() {
  exigir('gerirEquipe');
  const cofre = lerCofre();
  const dados = localStorage.getItem('teruel.dados');
  const convite = {
    tipo: 'teruel-convite',
    versao: 1,
    fingerprint: cofre.fingerprint,
    membros: cofre.membros.map((m) => ({ id: m.id, nome: m.nome, papel: m.papel })),
    cofre,
    dados: dados ? JSON.parse(dados) : null,
  };
  auditar('convite-gerado', 'Convite para novo aparelho.');
  return {
    json: JSON.stringify(convite),
    nomeArquivo: 'convite-teruel-' + new Date().toISOString().slice(0, 10) + '.json',
  };
}

/** Importa um convite: cria o cofre local e deixa a pessoa entrar com o PIN. */
export function importarConvite(jsonTexto) {
  const c = JSON.parse(jsonTexto);
  if (!c || c.tipo !== 'teruel-convite' || !c.cofre) {
    throw new Error('Arquivo inválido: não é um convite do Canal Teruel.');
  }
  if (existeCofre()) {
    const atual = lerCofre();
    if (atual.fingerprint && c.fingerprint && atual.fingerprint !== c.fingerprint) {
      throw new Error('Este aparelho já está num canal diferente (' + atual.fingerprint + '). Saia/apague antes de importar.');
    }
  }
  gravarCofre(c.cofre);
  if (c.dados) localStorage.setItem('teruel.dados', JSON.stringify(c.dados));
  return true;
}

/** Apaga tudo deste aparelho (o cofre continua existindo nos outros). */
export function apagarDesteAparelho() {
  localStorage.removeItem('teruel.dados');
  localStorage.removeItem('teruel.cofre');
  sessionStorage.clear();
  bloquear();
}
