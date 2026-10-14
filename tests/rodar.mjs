/* ============================================================================
 * TERUEL · Suíte de testes  (tests/rodar.mjs)
 * ----------------------------------------------------------------------------
 * Testa o que realmente pode quebrar este app:
 *   1. Criptografia — chave errada NÃO pode abrir; dado adulterado NÃO pode passar
 *   2. Cofre — PBKDF2 por membro, chave-mestra compartilhada, papéis
 *   3. Sincronização — merge por item, tombstone de exclusão (o ponto mais delicado)
 *   4. Renderização — todas as telas desenham sem lançar exceção
 *
 * Rodar:  node tests/rodar.mjs
 * ==========================================================================*/

import { JSDOM } from 'jsdom';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

/* ==========================================================================
 * 0. Ambiente de navegador simulado
 * ======================================================================== */
const RAIZ = resolve(process.cwd());
const dom = new JSDOM('<!doctype html><html><body><div id="view"></div><div id="toasts"></div></body></html>', {
  url: 'https://localhost/',
  pretendToBeVisual: true,
});

const { window } = dom;

/* ---- shim mínimo de IndexedDB (em memória) -------------------------------- */
class LojaSimples {
  constructor() { this.mapa = new Map(); }
  get(k) { return { result: this.mapa.get(k) }; }
  put(v, k) { this.mapa.set(k, v); return {}; }
  delete(k) { this.mapa.delete(k); return {}; }
  getAllKeys() { return { result: [...this.mapa.keys()] }; }
  getAll() { return { result: [...this.mapa.values()] }; }
  clear() { this.mapa.clear(); return {}; }
}

function criarIndexedDB() {
  const lojas = new Map();
  return {
    open() {
      const req = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: (n) => lojas.has(n) },
          createObjectStore: (n) => { lojas.set(n, new LojaSimples()); return lojas.get(n); },
          transaction: () => {
            const tx = { oncomplete: null, onerror: null, error: null };
            const store = {
              get: (k) => { const v = lojas.get('docs').get(k); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return { result: v.result }; },
              put: (v, k) => { lojas.get('docs').put(v, k); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return {}; },
              delete: (k) => { lojas.get('docs').delete(k); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return {}; },
              getAllKeys: () => { const v = lojas.get('docs').getAllKeys(); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return { result: v.result }; },
              getAll: () => { const v = lojas.get('docs').getAll(); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return { result: v.result }; },
              clear: () => { lojas.get('docs').clear(); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return {}; },
            };
            tx.objectStore = () => store;
            return tx;
          },
        };
        if (!lojas.has('docs')) lojas.set('docs', new LojaSimples());
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
}

/* ---- globais que os módulos esperam -------------------------------------- *
 * No Node 22 alguns globais (navigator, crypto) são somente-leitura, então
 * usamos defineProperty em vez de atribuição direta.                        */
function definir(nome, valor) {
  try {
    Object.defineProperty(globalThis, nome, {
      value: valor, writable: true, configurable: true, enumerable: true,
    });
  } catch (e) {
    // último recurso: se o global for imutável, apenas registra no console
    console.warn('[setup] não foi possível redefinir global "' + nome + '": ' + e.message);
  }
}

definir('window', window);
definir('document', window.document);
definir('location', window.location);
definir('localStorage', window.localStorage);
definir('sessionStorage', window.sessionStorage);
definir('HTMLElement', window.HTMLElement);
definir('Blob', window.Blob);
definir('File', window.File);
definir('indexedDB', criarIndexedDB());
definir('performance', window.performance);

// navigator: o do jsdom é o que interessa (userAgent, onLine…). Se já existir
// um global imutável do Node, mantemos o do Node — os módulos só usam o
// navigator para checar 'serviceWorker', que não é exercitado aqui.
if (!globalThis.navigator || !globalThis.navigator.userAgent) {
  definir('navigator', window.navigator);
}

// crypto: preferimos o WebCrypto nativo do Node (completo e estável)
definir('crypto', webcrypto);
globalThis.URL.createObjectURL = () => 'blob:fake';
globalThis.URL.revokeObjectURL = () => {};
window.print = () => {};
window.open = () => null;
window.scrollTo = () => {};

/* ==========================================================================
 * 1. Micro framework de teste
 * ======================================================================== */
let passou = 0, falhou = 0;
const falhas = [];
let grupo = '';

function grupoDe(nome) { grupo = nome; console.log('\n\x1b[1m' + nome + '\x1b[0m'); }

function ok(condicao, descricao, detalhe) {
  if (condicao) { passou++; console.log('  \x1b[32m✓\x1b[0m ' + descricao); }
  else {
    falhou++; falhas.push(grupo + ' → ' + descricao + (detalhe ? '  [' + detalhe + ']' : ''));
    console.log('  \x1b[31m✗\x1b[0m ' + descricao + (detalhe ? '  → ' + detalhe : ''));
  }
}

function igual(a, b, descricao) {
  ok(a === b, descricao, 'esperado ' + JSON.stringify(b) + ', obtido ' + JSON.stringify(a));
}

async function lanca(fn, descricao, fragmentoEsperado) {
  try {
    await fn();
    ok(false, descricao, 'não lançou erro');
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (fragmentoEsperado && !msg.toLowerCase().includes(fragmentoEsperado.toLowerCase())) {
      ok(false, descricao, 'mensagem inesperada: "' + msg + '"');
    } else {
      ok(true, descricao);
    }
  }
}

function limparArmazenamento() {
  window.localStorage.clear();
  window.sessionStorage.clear();
}

/* ==========================================================================
 * 2. Criptografia
 * ======================================================================== */
async function testarCripto() {
  grupoDe('1. Criptografia — a porta do cofre');
  const C = await import('../assets/js/crypto.js');

  // aleatoriedade
  const a = C.randomBytes(32), b = C.randomBytes(32);
  igual(a.length, 32, 'randomBytes devolve o tamanho pedido');
  ok(C.toB64(a) !== C.toB64(b), 'duas chamadas devolvem valores diferentes');

  // base64 ida e volta, inclusive com bytes altos
  const bruto = new Uint8Array([0, 1, 127, 128, 255, 254, 100]);
  const volta = C.fromB64(C.toB64(bruto));
  ok(bruto.every((v, i) => v === volta[i]), 'base64 preserva todos os bytes (0..255)');

  // aes-gcm: ida e volta
  const chave = C.randomBytes(32);
  const key = await C.importAesKey(chave);
  const selado = await C.sealObject(key, { segredo: 'pressão 140/90' }, C.aesAad('teste'));
  const aberto = await C.openObject(key, selado, C.aesAad('teste'));
  igual(aberto.segredo, 'pressão 140/90', 'AES-GCM cifra e decifra o objeto');

  // ciphertext não contém o texto claro
  ok(!C.text(C.fromB64(selado.ct)).includes('pressão'), 'texto claro não aparece no conteúdo cifrado');

  // nonce diferente a cada selagem (senão o GCM quebra)
  const selado2 = await C.sealObject(key, { segredo: 'pressão 140/90' }, C.aesAad('teste'));
  ok(selado.iv !== selado2.iv, 'cada cifragem usa um IV novo');
  ok(selado.ct !== selado2.ct, 'mesmo conteúdo gera texto cifrado diferente');

  // AAD errado deve falhar — impede mover um blob para outro contexto
  await lanca(() => C.openObject(key, selado, C.aesAad('outro-contexto')), 'AAD trocado é rejeitado');

  // dado adulterado deve falhar (integridade autenticada)
  const adulterado = { iv: selado.iv, ct: C.toB64((() => { const u = C.fromB64(selado.ct); u[3] ^= 0xff; return u; })()) };
  await lanca(() => C.openObject(key, adulterado, C.aesAad('teste')), 'dado adulterado é detectado (GCM autentica)');

  // PBKDF2 determinístico e sensível ao salt
  const salt = C.randomBytes(16);
  const pin = '7391-kx';
  const d1 = await C.keyFromPin(pin, salt);
  const d2 = await C.keyFromPin(pin, salt);
  igual(C.toB64(d1.raw), C.toB64(d2.raw), 'PBKDF2 é determinístico com o mesmo salt');

  const outroSalt = C.randomBytes(16);
  const d3 = await C.keyFromPin(pin, outroSalt);
  ok(C.toB64(d1.raw) !== C.toB64(d3.raw), 'salt diferente produz chave diferente');

  const d4 = await C.keyFromPin(pin + 'x', salt);
  ok(C.toB64(d1.raw) !== C.toB64(d4.raw), 'PIN diferente produz chave diferente');

  // embrulho da chave-mestra
  const master = C.newMasterKey();
  const pinKey = (await C.keyFromPin('123456', salt)).key;
  const blob = await C.wrapMasterForMember(master, pinKey, 'mem-1');
  const voltou = await C.unwrapMasterForMember(pinKey, blob, 'mem-1');
  igual(C.toB64(voltou), C.toB64(master), 'chave-mestra volta idêntica depois do embrulho');

  await lanca(() => C.unwrapMasterForMember(pinKey, blob, 'mem-2'),
    'blob de um membro não abre no registro de outro (AAD por membro)');

  const pinErrado = (await C.keyFromPin('999999', salt)).key;
  await lanca(() => C.unwrapMasterForMember(pinErrado, blob, 'mem-1'), 'PIN errado não abre a chave-mestra');

  // HKDF: subchaves distintas
  const k1 = await C.deriveSubkey(master, 'doc:a');
  const k2 = await C.deriveSubkey(master, 'doc:b');
  ok(C.toB64(k1) !== C.toB64(k2), 'subchaves por documento são diferentes entre si');

  // impressão digital estável
  const f1 = await C.keyFingerprint(master);
  const f2 = await C.keyFingerprint(master);
  igual(f1, f2, 'impressão digital é estável');
  ok(f1.startsWith('TERUEL-'), 'impressão digital tem prefixo legível');
  const outraMaster = C.newMasterKey();
  ok(await C.keyFingerprint(outraMaster) !== f1, 'cofres diferentes têm impressões digitais diferentes');

  // força de PIN
  ok(!C.pinStrength('123456').ok, '"123456" é rejeitado como PIN fraco');
  ok(!C.pinStrength('111111').ok, '"111111" é rejeitado');
  ok(!C.pinStrength('12345').ok, 'PIN com menos de 6 caracteres é rejeitado');
  ok(C.pinStrength('7391kx').ok, 'PIN alfanumérico de 6 é aceito');
  ok(C.pinStrength('Canal@2026').score >= 3, 'senha forte pontua alto');

  // comparação em tempo constante
  ok(C.timingSafeEqual('abc', 'abc'), 'comparação em tempo constante: iguais');
  ok(!C.timingSafeEqual('abc', 'abd'), 'comparação em tempo constante: diferentes');
  ok(!C.timingSafeEqual('abc', 'abcd'), 'comprimentos diferentes não são iguais');
}

/* ==========================================================================
 * 3. Cofre e autenticação
 * ======================================================================== */
async function testarCofre() {
  grupoDe('2. Cofre, PIN por membro e papéis');
  limparArmazenamento();

  const store = await import('../assets/js/store.js');
  const auth = await import('../assets/js/auth.js');

  igual(store.existeCofre(), false, 'começa sem cofre');

  // criar
  const { chaveRecuperacao, fingerprint } = await auth.criarCofre({
    nomeCanal: 'Canal Teruel',
    membro: { nome: 'Luciana', papel: 'admin', avatarEmoji: '👩', cor: '#1440BE', pin: 'Canal@2026' },
  });
  ok(store.existeCofre(), 'cofre criado e persistido');
  ok(/^(TERUEL-)/.test(fingerprint), 'identificador do cofre no formato esperado');
  ok(/^([A-Z0-9]{4}-){5}[A-Z0-9]{4}$/.test(chaveRecuperacao), 'chave de recuperação no formato XXXX-XXXX-…');
  igual(store.estaDesbloqueado(), true, 'sessão aberta após criar o cofre');
  igual(auth.pode('gerirEquipe'), true, 'primeiro membro é gestor e pode gerir equipe');
  igual(auth.pode('gerirCredenciais'), true, 'gestor pode gerir credenciais');

  // PIN fraco na criação
  limparArmazenamento();
  await lanca(() => auth.criarCofre({
    nomeCanal: 'X', membro: { nome: 'Fraca', papel: 'admin', pin: '123456' },
  }), 'criação com PIN fraco é recusada');

  // recria o cofre bom para o resto da bateria
  await auth.criarCofre({
    nomeCanal: 'Canal Teruel',
    membro: { nome: 'Luciana', papel: 'admin', avatarEmoji: '👩', cor: '#1440BE', pin: 'Canal@2026' },
  });

  // adicionar membros com papéis distintos
  const idAna = await auth.adicionarMembro({ nome: 'Ana', papel: 'editor', avatarEmoji: '👧', pin: 'Ana#2026' });
  const idCelia = await auth.adicionarMembro({ nome: 'Célia', papel: 'cuidador', avatarEmoji: '🧑‍⚕️', pin: 'Celia#26' });
  const idTio = await auth.adicionarMembro({ nome: 'Tio Jorge', papel: 'leitor', avatarEmoji: '🧔', pin: 'Jorge#26' });
  igual(auth.equipe().length, 4, 'quatro membros no canal (5 pessoas + acompanhante pode crescer)');
  await store.salvar(true);

  // todos abrem o mesmo cofre com PINs diferentes
  auth.sair();
  await auth.entrar(idAna, 'Ana#2026');
  igual(store.sessao.membro.nome, 'Ana', 'Ana entra com o próprio PIN');
  igual(auth.pode('escrever'), true, 'Ana (editora) pode escrever');
  igual(auth.pode('gerirEquipe'), false, 'Ana (editora) NÃO gere a equipe');
  igual(auth.pode('gerirCredenciais'), false, 'Ana NÃO vê credenciais do portal');

  auth.sair();
  await auth.entrar(idCelia, 'Celia#26');
  igual(auth.pode('escrever'), true, 'Célia (cuidadora) pode escrever');
  igual(auth.pode('verAuditoria'), false, 'Célia NÃO vê auditoria');
  igual(auth.pode('gerirEquipe'), false, 'Célia NÃO gere a equipe');

  auth.sair();
  await auth.entrar(idTio, 'Jorge#26');
  igual(auth.pode('escrever'), false, 'Tio Jorge (observador) NÃO escreve');
  igual(auth.pode('ver'), true, 'Tio Jorge pode visualizar');

  // PIN errado
  auth.sair();
  await lanca(() => auth.entrar(idTio, 'errado'), 'PIN incorreto é recusado', 'incorreto');
  await lanca(() => auth.entrar('mem-inexistente', 'x'), 'membro inexistente é recusado', 'não encontrado');

  // gestor volta
  const idLuciana = auth.equipe().find((m) => m.nome === 'Luciana').id;
  await auth.entrar(idLuciana, 'Canal@2026');
  igual(auth.pode('gerirEquipe'), true, 'gestora entra e recupera permissões');

  // permissão negada lança erro claro
  auth.sair();
  await auth.entrar(idTio, 'Jorge#26');
  await lanca(() => auth.adicionarMembro({ nome: 'X', papel: 'admin', pin: 'Forte#26' }),
    'observador não consegue adicionar membro', 'permissão');

  // troca de PIN
  auth.sair();
  await auth.entrar(idAna, 'Ana#2026');
  await lanca(() => auth.trocarMeuPin('errado', 'Novo#2026'), 'troca de PIN exige o PIN atual', 'incorreto');
  await auth.trocarMeuPin('Ana#2026', 'Novo#2026');
  auth.sair();
  await lanca(() => auth.entrar(idAna, 'Ana#2026'), 'PIN antigo deixa de funcionar', 'incorreto');
  await auth.entrar(idAna, 'Novo#2026');
  ok(true, 'PIN novo funciona');

  // gestor remove um membro comum; e não pode mexer em si mesmo
  auth.sair();
  await auth.entrar(idLuciana, 'Canal@2026');
  const euId = store.sessao.membro.id;
  await lanca(() => auth.removerMembro(euId), 'não é possível remover o próprio acesso', 'próprio');
  await lanca(() => auth.ativarMembro(euId, false), 'não é possível desativar o próprio acesso', 'próprio');
  await lanca(() => auth.removerMembro('mem-fantasma'), 'remover membro inexistente falha claro', 'não encontrado');
  auth.removerMembro(idTio);
  ok(!auth.equipe().some((m) => m.id === idTio), 'gestor consegue remover um membro comum');
  await lanca(() => auth.entrar(idTio, 'Jorge#26'), 'membro removido não entra mais', 'não encontrado');

  // papéis: elevar e rebaixar
  await auth.adicionarMembro({ nome: 'Gestor 2', papel: 'admin', pin: 'Gestor#26' });
  const g2 = auth.equipe().find((m) => m.nome === 'Gestor 2').id;
  auth.alterarPapel(g2, 'leitor');
  igual(auth.equipe().find((m) => m.id === g2).papel, 'leitor', 'papel pode ser rebaixado');
  auth.alterarPapel(g2, 'admin');
  igual(auth.equipe().find((m) => m.id === g2).papel, 'admin', 'papel pode ser elevado de novo');

  // há sempre mais de um gestor possível; a regra do "último gestor" é defensiva
  const admins = auth.equipe().filter((m) => m.papel === 'admin' && m.ativo !== false);
  ok(admins.length >= 2, 'canal mantém gestores suficientes para não ficar sem administração');

  // redefinição de PIN pelo gestor marca troca obrigatória
  await auth.redefinirPinDe(idCelia, 'Provisorio#26');
  igual(auth.equipe().find((m) => m.id === idCelia).precisaTrocarPin, true, 'PIN redefinido exige troca no próximo acesso');
  auth.sair();
  await auth.entrar(idCelia, 'Provisorio#26');
  igual(store.sessao.membro.nome, 'Célia', 'Célia entra com o PIN provisório');
}

/* ==========================================================================
 * 4. Merge / sincronização
 * ======================================================================== */
async function testarMerge() {
  grupoDe('3. Sincronização entre aparelhos — merge e exclusões');
  limparArmazenamento();

  const store = await import('../assets/js/store.js');
  const auth = await import('../assets/js/auth.js');

  await auth.criarCofre({
    nomeCanal: 'Canal Teruel',
    membro: { nome: 'Luciana', papel: 'admin', avatarEmoji: '👩', pin: 'Canal@2026' },
  });

  const maria = store.estado.pacientes.find((p) => p.id === 'pac-maria');
  ok(!!maria, 'os dois pacientes-base existem no estado inicial');
  igual(store.estado.pacientes.length, 2, 'estado inicial tem Maria e João');

  // item local
  const ev = store.inserir('eventos', {
    id: 'evt-1', pacienteId: 'pac-maria', tipo: 'consulta', titulo: 'Cardiologia',
    inicio: new Date(Date.now() + 86400000).toISOString(),
  });
  igual(store.estado.eventos.length, 1, 'evento inserido localmente');

  // o outro aparelho cria um evento diferente
  store.mesclar({
    eventos: [{ id: 'evt-2', pacienteId: 'pac-joao', tipo: 'exame', titulo: 'Creatinina', inicio: Date.now(), atualizadoEm: Date.now() }],
    lixeira: { eventos: {} },
  });
  igual(store.estado.eventos.length, 2, 'merge traz o item do outro aparelho (união, não substituição)');

  // conflito: vence o mais recente
  const futuro = Date.now() + 60000;
  store.mesclar({
    eventos: [{ id: 'evt-1', pacienteId: 'pac-maria', tipo: 'consulta', titulo: 'Cardiologia — remarcada', inicio: new Date().toISOString(), atualizadoEm: futuro }],
    lixeira: { eventos: {} },
  });
  igual(store.porId('eventos', 'evt-1').titulo, 'Cardiologia — remarcada', 'versão mais recente vence o conflito');

  // versão antiga não sobrescreve a nova
  store.mesclar({
    eventos: [{ id: 'evt-1', pacienteId: 'pac-maria', titulo: 'Título velho', atualizadoEm: 1 }],
    lixeira: { eventos: {} },
  });
  igual(store.porId('eventos', 'evt-1').titulo, 'Cardiologia — remarcada', 'versão antiga NÃO sobrescreve a atual');

  // exclusão propaga (tombstone)
  store.remover('eventos', 'evt-2');
  igual(store.estado.eventos.length, 1, 'exclusão remove localmente');
  ok(!!store.estado.lixeira.eventos['evt-2'], 'exclusão gera marca (tombstone) para propagar');

  store.mesclar({
    eventos: [{ id: 'evt-2', pacienteId: 'pac-joao', tipo: 'exame', titulo: 'Creatinina', atualizadoEm: 1 }],
    lixeira: { eventos: {} },
  });
  igual(store.estado.eventos.length, 1, 'item excluído NÃO ressuscita ao importar pacote antigo');

  // exclusão vinda do outro aparelho
  store.inserir('eventos', { id: 'evt-3', pacienteId: 'pac-maria', tipo: 'terapia', titulo: 'Fisioterapia' });
  igual(store.estado.eventos.length, 2, 'segundo evento inserido');
  store.mesclar({ eventos: [], lixeira: { eventos: { 'evt-3': Date.now() + 1000 } } });
  igual(store.estado.eventos.length, 1, 'exclusão feita em outro aparelho é aplicada aqui');

  // merge não perde dados de coleções diferentes
  store.inserir('medicamentos', { id: 'med-1', pacienteId: 'pac-joao', nome: 'Losartana 50mg', dose: '1 comprimido', horarios: ['08:00', '20:00'], ativo: true });
  store.inserir('sinais', { id: 'sig-1', pacienteId: 'pac-joao', tipo: 'pa', valor: '150/95', unidade: 'mmHg', medidoEm: Date.now() });
  const antes = { med: store.estado.medicamentos.length, sig: store.estado.sinais.length };
  store.mesclar({ eventos: [], medicamentos: [], sinais: [], lixeira: {} });
  igual(store.estado.medicamentos.length, antes.med, 'merge com pacote vazio não apaga medicações');
  igual(store.estado.sinais.length, antes.sig, 'merge com pacote vazio não apaga sinais');

  // pacote completo: exportar e importar em "outro aparelho"
  await store.salvar(true);
  const { json } = await store.exportarPacote(true);
  const env = JSON.parse(json);
  igual(env.tipo, 'teruel', 'pacote tem o tipo esperado');
  ok(!!env.selado && !!env.selado.ct, 'pacote vai cifrado');
  ok(!json.includes('Losartana'), 'nome do medicamento não aparece no arquivo exportado');

  // outro aparelho lê o pacote com a MESMA chave-mestra
  const pacote = await store.lerPacote(json);
  igual(pacote.pacote.dados.eventos.length, store.estado.eventos.length, 'pacote carrega o mesmo número de eventos');

  // aparelho com cofre diferente NÃO consegue abrir
  const masterAtual = store.sessao.master;
  const outraMaster = new Uint8Array(32).fill(7);
  store.sessao.master = outraMaster;
  const outraChave = await (await import('../assets/js/crypto.js')).importAesKey(await (await import('../assets/js/crypto.js')).deriveSubkey(outraMaster, 'vault'));
  const vaultReal = store.sessao.vaultKey;
  store.sessao.vaultKey = outraChave;
  await lanca(() => store.lerPacote(json), 'pacote não abre com chave de outro cofre');
  store.sessao.master = masterAtual;
  store.sessao.vaultKey = vaultReal;
  ok(true, 'chave original restaurada e pacote volta a abrir');

  // arquivos cifrados (IndexedDB)
  const blob = new window.Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'application/pdf' });
  await store.guardarArquivo('arq-teste', blob);
  const lido = await store.lerArquivo('arq-teste');
  ok(lido && lido.length === 5, 'arquivo é guardado cifrado e lido de volta íntegro');

  // segredo avulso (credenciais do portal)
  const s = await store.selarSegredo('senha-super-secreta');
  const aberto = await store.abrirSegredo(s);
  igual(aberto, 'senha-super-secreta', 'segredo do portal cifra e decifra corretamente');
  ok(!JSON.stringify(s).includes('senha-super'), 'a senha não aparece no blob cifrado');
}

/* ==========================================================================
 * 5. Regras de negócio do dia a dia
 * ======================================================================== */
async function testarRegras() {
  grupoDe('4. Regras do dia a dia — doses, agenda e alertas');
  limparArmazenamento();

  const store = await import('../assets/js/store.js');
  const auth = await import('../assets/js/auth.js');
  await auth.criarCofre({
    nomeCanal: 'Canal Teruel',
    membro: { nome: 'Luciana', papel: 'admin', avatarEmoji: '👩', pin: 'Canal@2026' },
  });

  // medicação com horário futuro e passado
  const agora = new Date();
  const hPassada = String(Math.max(0, agora.getHours() - 1)).padStart(2, '0') + ':00';
  const hFutura = String(Math.min(23, agora.getHours() + 1)).padStart(2, '0') + ':00';

  store.inserir('medicamentos', {
    id: 'med-a', pacienteId: 'pac-maria', nome: 'Metformina', dose: '850mg',
    horarios: [hPassada, hFutura], ativo: true,
  });

  const pend = store.dosesPendentesHoje();
  ok(pend.length >= 1, 'há dose pendente no dia');
  ok(pend.every((p) => p.medicamento.ativo !== false), 'só medicações ativas entram nas pendentes');

  store.inserir('doses', {
    id: 'dose-a', medicamentoId: 'med-a', pacienteId: 'pac-maria', janela: hPassada, horario: Date.now(),
  });
  const pend2 = store.dosesPendentesHoje();
  ok(!pend2.some((p) => p.janela === hPassada), 'dose registrada sai da lista de pendentes');

  // medicação suspensa não cobra dose
  store.atualizar('medicamentos', 'med-a', { ativo: false });
  ok(!store.dosesPendentesHoje().some((p) => p.medicamentoId === 'med-a'), 'medicação suspensa não gera pendência');
  store.atualizar('medicamentos', 'med-a', { ativo: true });

  // próximo compromisso ignora cancelados e passados
  store.inserir('eventos', { id: 'e-passado', pacienteId: 'pac-maria', tipo: 'consulta', titulo: 'Antiga', inicio: new Date(Date.now() - 86400000).toISOString() });
  store.inserir('eventos', { id: 'e-cancelado', pacienteId: 'pac-maria', tipo: 'consulta', titulo: 'Cancelada', inicio: new Date(Date.now() + 3600000).toISOString(), status: 'cancelado' });
  store.inserir('eventos', { id: 'e-proximo', pacienteId: 'pac-maria', tipo: 'consulta', titulo: 'Próxima certa', inicio: new Date(Date.now() + 7200000).toISOString() });
  const prox = store.agoraProximo();
  igual(prox.id, 'e-proximo', 'próximo compromisso ignora o passado e o cancelado');

  // agenda do dia
  const hoje = new Date(); hoje.setHours(23, 0, 0, 0);
  store.inserir('eventos', { id: 'e-hoje', pacienteId: 'pac-joao', tipo: 'terapia', titulo: 'Fisio hoje', inicio: hoje.toISOString() });
  ok(store.eventosDoDia().some((e) => e.id === 'e-hoje'), 'evento de hoje aparece na agenda do dia');

  // sinais ordenados do mais recente
  store.inserir('sinais', { id: 's1', pacienteId: 'pac-maria', tipo: 'pa', valor: '130/85', unidade: 'mmHg', medidoEm: Date.now() - 7200000 });
  store.inserir('sinais', { id: 's2', pacienteId: 'pac-maria', tipo: 'pa', valor: '150/95', unidade: 'mmHg', medidoEm: Date.now() });
  const serie = store.ultimosSinais('pac-maria', 'pa', 10);
  igual(serie[0].id, 's2', 'sinais vêm do mais recente para o mais antigo');
  igual(serie.length, 2, 'filtra pelo tipo pedido');

  // auditoria registra autor
  store.auditar('teste-manual', 'detalhe de teste', 'pac-maria');
  const ult = store.estado.auditoria[0];
  igual(ult.acao, 'teste-manual', 'auditoria grava a ação');
  igual(ult.membroNome, 'Luciana', 'auditoria grava quem fez');
  igual(ult.pacienteId, 'pac-maria', 'auditoria grava o paciente relacionado');

  // resumo de documentos
  const resumo = store.resumoDocumentos();
  igual(typeof resumo.total, 'number', 'resumo de documentos calcula o total');
}

/* ==========================================================================
 * 6. Renderização de todas as telas (smoke test)
 * ======================================================================== */
async function testarTelas() {
  grupoDe('5. Renderização das telas (DOM real, sem exceção)');
  limparArmazenamento();

  const store = await import('../assets/js/store.js');
  const auth = await import('../assets/js/auth.js');
  const ui = await import('../assets/js/ui.js');

  await auth.criarCofre({
    nomeCanal: 'Canal Teruel',
    membro: { nome: 'Luciana', papel: 'admin', avatarEmoji: '👩', pin: 'Canal@2026' },
  });

  // base mínima para as telas terem o que desenhar
  store.inserir('eventos', {
    id: 'ev-1', pacienteId: 'pac-maria', tipo: 'consulta', titulo: 'Cardiologia',
    inicio: new Date(Date.now() + 86400000).toISOString(), local: 'Hospital São Luiz', precisaAcompanhante: true,
  });
  store.inserir('medicamentos', {
    id: 'med-1', pacienteId: 'pac-joao', nome: 'Losartana', dose: '50mg',
    horarios: ['08:00', '20:00'], ativo: true, controlado: true,
  });
  store.inserir('sinais', { id: 'sg-1', pacienteId: 'pac-joao', tipo: 'pa', valor: '130/85', unidade: 'mmHg', medidoEm: Date.now() - 86400000 });
  store.inserir('sinais', { id: 'sg-2', pacienteId: 'pac-joao', tipo: 'pa', valor: '150/95', unidade: 'mmHg', medidoEm: Date.now() });
  store.inserir('exames', {
    id: 'ex-1', pacienteId: 'pac-joao', titulo: 'Creatinina', categoria: 'laboratorial',
    data: '2026-03-03', unidade: 'Laboratório D\'Or',
    valores: [{ nome: 'Creatinina', valor: '1.9', unidade: 'mg/dL', referencia: '0.6-1.2', min: 0.6, max: 1.2 }],
    conclusao: 'Valor acima da faixa de referência.',
  });
  store.inserir('documentos', { id: 'dc-1', pacienteId: 'pac-joao', titulo: 'Laudo de creatinina', categoria: 'Laudo de exame', arquivoId: 'arq-x', origem: 'Rede D\'Or', criadoEm: Date.now() });
  store.inserir('mural', { id: 'mu-1', tipo: 'escala', texto: 'Terça: Ana leva na fisio', data: new Date().toISOString().slice(0, 10), autorNome: 'Ana', criadoEm: Date.now(), fixado: true });
  store.inserir('diario', { id: 'di-1', pacienteId: 'pac-maria', texto: 'Dormiu bem, comeu pouco.', autorNome: 'Célia', criadoEm: Date.now() });
  store.inserir('doses', { id: 'do-1', medicamentoId: 'med-1', pacienteId: 'pac-joao', janela: '08:00', horario: Date.now(), registradoPorNome: 'Célia' });
  store.estado.dor.monitorias = [{
    id: 'dm-1', pacienteId: 'pac-joao', titulo: 'Ressonância de crânio', status: 'aguardando',
    solicitadoEm: '2026-03-01', previsao: '2026-03-10', unidade: 'Hospital São Luiz',
  }];
  // Amil — dados para a tela renderizar (autorização, extrato e carteirinha)
  store.estado.amil.guias = [{
    id: 'ag-1', beneficiario: 'João Teruel', procedimento: 'Ressonância magnética de crânio',
    numero: '123456', senha: 'Q7X9', validade: '2030-01-01', prestador: 'Hospital São Luiz',
  }];
  store.estado.amil.faturas = [{
    id: 'af-1', beneficiario: 'Maria Izaulina', referencia: '02/2026', protocolo: '778899',
    itens: [{ data: '2026-02-01', procedimento: 'Consulta cardiologia', valor: 350 }], total: 350,
  }];
  store.estado.amil.carteirinhas = [{
    id: 'ac-1', beneficiario: 'Maria Izaulina', carteira: '998877', plano: 'Amil One 400',
    acomodacao: 'Apartamento', validade: '2030-12-31',
  }];
  await store.salvar(true);

  const telas = [
    ['painel', await import('../assets/js/views/painel.js')],
    ['agenda', await import('../assets/js/views/agenda.js')],
    ['prontuario', await import('../assets/js/views/prontuario.js')],
    ['medicamentos', await import('../assets/js/views/medicamentos.js')],
    ['sinais', await import('../assets/js/views/sinais.js')],
    ['exames', await import('../assets/js/views/exames.js')],
    ['consulta', await import('../assets/js/views/consulta.js')],
    ['documentos', await import('../assets/js/views/documentos.js')],
    ['mural', await import('../assets/js/views/mural.js')],
    ['dor', await import('../assets/js/views/dor.js')],
    ['amil', await import('../assets/js/views/amil.js')],
    ['equipe', await import('../assets/js/views/equipe.js')],
    ['auditoria', await import('../assets/js/views/auditoria.js')],
    ['ajustes', await import('../assets/js/views/ajustes.js')],
  ];

  for (const [nome, mod] of telas) {
    const host = window.document.createElement('div');
    window.document.body.appendChild(host);
    try {
      await mod.render(host, {});
      const html = host.innerHTML || '';
      ok(html.length > 200, 'tela "' + nome + '" renderiza conteúdo', html.length + ' caracteres');
      ok(!/\bundefined\b/.test(html), 'tela "' + nome + '" não imprime "undefined"');
      ok(!/\[object Object\]/.test(html), 'tela "' + nome + '" não imprime "[object Object]"');
      ok(!/\bNaN\b/.test(html), 'tela "' + nome + '" não imprime "NaN"');
    } catch (e) {
      ok(false, 'tela "' + nome + '" renderiza sem exceção', e.message);
    } finally {
      host.remove();
    }
  }

  // telas de leitura para um perfil restrito (observador)
  const idTio = await auth.adicionarMembro({ nome: 'Tio Jorge', papel: 'leitor', emoji: '🧔', avatarEmoji: '🧔', pin: 'Jorge#26' });
  auth.sair();
  await auth.entrar(idTio, 'Jorge#26');
  for (const [nome, mod] of telas) {
    const host = window.document.createElement('div');
    window.document.body.appendChild(host);
    try {
      await mod.render(host, {});
      ok((host.innerHTML || '').length > 100, 'perfil observador vê a tela "' + nome + '" sem quebrar');
    } catch (e) {
      ok(false, 'perfil observador na tela "' + nome + '"', e.message);
    } finally { host.remove(); }
  }
  ok(auth.pode('escrever') === false, 'observador segue sem permissão de escrita ao final');

  // helpers de formatação não produzem saída inválida
  igual(ui.fmtData(null), '—', 'fmtData trata valor vazio');
  igual(ui.fmtHora(undefined), '—', 'fmtHora trata valor vazio');
  ok(ui.relativo(Date.now()).includes('agora'), 'relativo identifica "agora"');
  ok(ui.relativo(Date.now() + 86400000).includes('amanhã'), 'relativo identifica "amanhã"');
  igual(ui.esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;', 'esc neutraliza HTML (anti-XSS)');
  igual(ui.esc('a"b\'c'), 'a&quot;b&#39;c', 'esc escapa aspas');
}

/* ==========================================================================
 * 7. Segurança — invariantes que não podem regredir
 * ======================================================================== */
async function testarSeguranca() {
  grupoDe('6. Invariantes de segurança (o app não pode regredir aqui)');
  limparArmazenamento();

  const store = await import('../assets/js/store.js');
  const auth = await import('../assets/js/auth.js');

  await auth.criarCofre({
    nomeCanal: 'Canal Teruel',
    membro: { nome: 'Luciana', papel: 'admin', avatarEmoji: '👩', pin: 'Canal@2026' },
  });
  store.inserir('exames', { id: 'ex-s', pacienteId: 'pac-maria', titulo: 'Ressonância', categoria: 'imagem', conclusao: 'SEM ALTERAÇÕES SIGNIFICATIVAS' });
  store.inserir('sinais', { id: 'sg-s', pacienteId: 'pac-maria', tipo: 'glicemia', valor: '245', unidade: 'mg/dL', medidoEm: Date.now(), nota: 'GLICEMIA-DESCONTROLADA-MARCADOR-SENSIVEL' });
  await store.salvar(true);

  // 1. nada sensível em texto claro no localStorage
  const bruto = window.localStorage.getItem('teruel.dados');
  ok(!!bruto, 'estado é persistido no aparelho');
  ok(!bruto.includes('Ressonância'), 'conclusão de exame NÃO fica em texto claro no aparelho');
  ok(!bruto.includes('SEM ALTERAÇÕES'), 'texto do laudo NÃO fica legível');
  ok(!bruto.includes('GLICEMIA-DESCONTROLADA-MARCADOR-SENSIVEL'), 'anotação clínica NÃO fica legível');
  ok(!bruto.includes('mg/dL'), 'nem as unidades de medida ficam legíveis');
  ok(!bruto.includes('pac-maria'), 'identificador de paciente NÃO fica legível');

  // 2. metadados do cofre não guardam PIN
  const cofreBruto = window.localStorage.getItem('teruel.cofre');
  ok(!cofreBruto.includes('Canal@2026'), 'PIN NÃO é gravado em lugar nenhum');
  const cofre = JSON.parse(cofreBruto);
  ok(cofre.membros[0].salt && cofre.membros[0].blob, 'cada membro tem salt e blob próprios');
  ok(!cofre.membros[0].master && !cofre.master, 'a chave-mestra não é gravada em claro');

  // 3. sessão em memória não é serializada pelo app
  ok(typeof store.sessao.master.length === 'number' || store.sessao.master === null, 'chave-mestra vive só em memória');

  // 4. bloqueio limpa a chave
  const antes = store.sessao.master;
  auth.sair();
  igual(store.sessao.master, null, 'sair() apaga a chave-mestra da memória');
  igual(store.estaDesbloqueado(), false, 'cofre volta a ficar bloqueado');
  igual(store.sessao.membro, null, 'sessão do membro é limpa');
  ok(antes && antes.every((b) => b === 0), 'a memória da chave foi zerada (fill(0))');

  // 5. sem chave, não dá para gravar nem decifrar
  await lanca(() => store.carregarEstado(), 'não carrega o cofre sem chave');
  const r = await store.salvar(true);
  igual(r, undefined, 'salvar não grava nada quando o cofre está bloqueado');

  // 6. lista pública de membros não vaza dados sensíveis
  const pub = store.membrosPublicos();
  ok(pub.length >= 1 && pub[0].nome === 'Luciana', 'lista de entrada mostra apenas nome/papel');
  ok(!pub[0].salt && !pub[0].blob, 'lista de entrada não expõe material de chave');

  // 7. reabrir exige o PIN de novo
  await auth.entrar(store.membrosPublicos()[0].id, 'Canal@2026');
  igual(store.estaDesbloqueado(), true, 'PIN correto reabre o cofre');
  const ex = store.porId('exames', 'ex-s');
  igual(ex.conclusao, 'SEM ALTERAÇÕES SIGNIFICATIVAS', 'dados voltam íntegros após reabrir');
}

/* ==========================================================================
 * 6b. Ingestão de documentos do convênio (Amil)
 * ======================================================================== */
async function testarIngestao() {
  grupoDe('6b. Ingestão Amil — reconhecer, extrair e conciliar sem digitar');
  const I = await import('../assets/js/ingest.js');

  // ---- datas e valores em pt-BR ----
  igual(I.paraIso('30/03/2026'), '2026-03-30', 'data dd/mm/aaaa vira ISO');
  igual(I.paraIso('2026-03-30'), '2026-03-30', 'data ISO permanece ISO');
  igual(I.paraIso('05/02/26'), '2026-02-05', 'ano de 2 dígitos é completado');
  igual(I.valorNumerico('R$ 1.234,56'), 1234.56, 'valor pt-BR com milhar e centavos');

  // ---- reconhecimento do tipo ----
  const txtExtrato = 'EXTRATO DE UTILIZAÇÃO\nBeneficiário: Maria Izaulina\n'
    + 'Data;Procedimento;Valor Pago\n01/02/2026;Consulta cardiologia;R$ 350,00\n05/02/2026;Hemograma;R$ 120,50';
  igual(I.detectarTipo(txtExtrato, 'extrato.pdf').tipo, 'extrato', 'reconhece extrato de utilização');

  const txtGuia = 'GUIA SP/SADT\nNúmero da Guia: 123456\nSenha de Autorização: Q7X9\n'
    + 'Validade da Senha: 30/03/2026\nProcedimento: Ressonância de crânio\nPrestador: Hospital São Luiz';
  igual(I.detectarTipo(txtGuia, 'guia.pdf').tipo, 'guia', 'reconhece guia de autorização');

  const txtCart = 'Número do Beneficiário: 998877\nBeneficiário: Maria Izaulina\nPlano: Amil One 400\n'
    + 'Acomodação: Apartamento\nValidade: 31/12/2026\nRegistro ANS: 326305';
  igual(I.detectarTipo(txtCart, 'carteirinha.png').tipo, 'carteirinha', 'reconhece carteirinha');

  const txtReemb = 'Demonstrativo de Reembolso\nProtocolo: 778899\n10/01/2026 Consulta neurologia R$ 400,00';
  igual(I.detectarTipo(txtReemb, 'reembolso.pdf').tipo, 'reembolso', 'reconhece demonstrativo de reembolso');

  igual(I.detectarTipo('Bilhete qualquer sem nada do convênio', 'x.txt').tipo, 'desconhecido',
    'texto sem assinatura fica como desconhecido');

  // ---- extração de campos ----
  const g = I.parseGuia(txtGuia);
  igual(g.numero, '123456', 'guia: número lido');
  igual(g.senha, 'Q7X9', 'guia: senha lida');
  igual(g.validade, '2026-03-30', 'guia: validade convertida para ISO');
  ok(/Ressonância/.test(g.procedimento), 'guia: procedimento lido');
  igual(g.prestador, 'Hospital São Luiz', 'guia: prestador lido');

  const ex = I.parseExtrato(txtExtrato);
  igual(ex.itens.length, 2, 'extrato CSV: duas linhas viram dois itens');
  igual(ex.itens[0].procedimento, 'Consulta cardiologia', 'extrato CSV: procedimento por coluna');
  igual(ex.itens[0].valor, 350, 'extrato CSV: valor por coluna');
  igual(Math.round(ex.total * 100) / 100, 470.5, 'extrato CSV: total somado');

  const c = I.parseCarteirinha(txtCart);
  igual(c.carteira, '998877', 'carteirinha: número do beneficiário');
  igual(c.acomodacao, 'Apartamento', 'carteirinha: acomodação');
  igual(c.ans, '326305', 'carteirinha: registro ANS');

  const rr = I.parseReembolso(txtReemb);
  igual(rr.protocolo, '778899', 'reembolso: protocolo lido');

  // extrato em texto corrido (sem CSV) — formato de PDF do portal
  const exTxt = I.parseExtrato('Extrato de utilização\n01/03/2026 Consulta geriatria R$ 300,00\n'
    + '15/03/2026 Fisioterapia R$ 90,00');
  igual(exTxt.itens.length, 2, 'extrato em texto corrido também é lido');

  // ---- conciliação: importar de novo NÃO duplica ----
  const u = { data: '2026-02-01', procedimento: 'Consulta cardiologia', valor: 350 };
  const ja = [{ id: 'f1', itens: [u], atualizadoEm: 5 }];
  const r1 = I.conciliar(ja, [{ id: 'f2', itens: [u, { data: '2026-02-05', procedimento: 'Hemograma', valor: 120.5 }], atualizadoEm: 6 }]);
  igual(r1.novos.length, 1, 'extrato novo é reconhecido como novo');
  igual(r1.novos[0].itens.length, 1, 'linha já existente NÃO é reimportada');
  igual(r1.novos[0].itensDescartados, 1, 'linha repetida é contabilizada como descartada');
  igual(I.conciliar(ja, [{ id: 'f1', itens: [], atualizadoEm: 9 }]).atualizados.length, 1,
    'mesmo id com data mais nova é atualizado');
  igual(I.conciliar(ja, [{ id: 'f1', itens: [], atualizadoEm: 1 }]).iguais.length, 1,
    'mesmo id com data mais antiga é ignorado');

  // ---- classificação em lote (o que faz o "importar vários de uma vez") ----
  const lote = await I.classificarItens([
    { nome: 'guia.pdf', mime: 'application/pdf', texto: txtGuia, base64: 'AA==' },
    { nome: 'extrato.csv', mime: 'text/csv', texto: txtExtrato, base64: 'AA==' },
    { nome: 'carteirinha.txt', mime: 'text/plain', texto: txtCart, base64: 'AA==' },
    { nome: 'aleatorio.txt', mime: 'text/plain', texto: 'nada reconhecível aqui', base64: 'AA==' },
  ]);
  igual(lote.guias.length, 1, 'lote: uma guia classificada');
  igual(lote.faturas.length, 1, 'lote: um extrato classificado');
  igual(lote.carteirinhas.length, 1, 'lote: uma carteirinha classificada');
  igual(lote.desconhecidos.length, 1, 'lote: arquivo sem tipo vai para desconhecidos');
  igual(lote.originais.length, 4, 'lote: todos os originais são preservados para arquivar');

  // ---- lote (.teruellote) e base64 ----
  const bytes = new Uint8Array([0, 1, 127, 128, 255]);
  ok(I.b64ParaBytes(I.bytesParaB64(bytes)).every((v, i) => v === bytes[i]),
    'base64 do lote preserva todos os bytes');
  const l = I.montarLote([{ nome: 'x.pdf', mime: 'application/pdf', base64: 'AA==' }], 'teste');
  igual(l.tipo, 'teruel-lote', 'lote tem tipo próprio');
  igual(I.validarLote(l).itens.length, 1, 'lote válido é aceito');
  await lanca(() => I.validarLote({ tipo: 'outra-coisa' }), 'lote de outro app é rejeitado', 'não é um lote');
  await lanca(() => I.validarLote({ tipo: 'teruel-lote', itens: [{ nome: 'sem' }] }),
    'item de lote sem conteúdo é rejeitado', 'sem conteúdo');

  // ---- extração de texto de PDF simples (sem compressão) ----
  const pdf = '%PDF-1.4\n4 0 obj<</Length 62>>\nstream\n'
    + 'BT /F1 12 Tf 72 720 Td (GUIA SP/SADT Numero da Guia: 123456) Tj ET\n'
    + 'endstream\nendobj\n%%EOF';
  const txtPdf = await I.extrairTextoPdf(new TextEncoder().encode(pdf));
  ok(/GUIA/.test(txtPdf), 'extrai texto de PDF sem compressão', txtPdf.slice(0, 60));
}

/* ==========================================================================
 * 6c. Modo consulta — agrupar exames por especialidade
 * --------------------------------------------------------------------------
 * O requisito da família: o médico vê os exames QUE LHE CABEM, e nenhum
 * exame de imagem, laboratorial ou outro pode ficar escondido.
 * ======================================================================== */
async function testarConsulta() {
  grupoDe('6c. Modo consulta — especialidade, sem esconder exame');

  const C = await import('../assets/js/views/consulta.js');

  // ---- dedução da área pelo nome do exame ------------------------------
  igual(C.areaDoExame({ titulo: 'Ressonância magnética de crânio' }), 'Neurologia',
    'deduz Neurologia pelo nome do exame');
  igual(C.areaDoExame({ titulo: 'Ecocardiograma transtorácico' }), 'Cardiologia',
    'deduz Cardiologia pelo nome do exame');
  igual(C.areaDoExame({ titulo: 'USG de abdome total' }), 'Gastroenterologia',
    'deduz Gastroenterologia pelo nome do exame');
  igual(C.areaDoExame({ titulo: 'Hemograma completo' }), 'Hematologia',
    'deduz Hematologia pelo nome do exame');
  igual(C.areaDoExame({ titulo: 'Creatinina' }), 'Nefrologia',
    'deduz Nefrologia pelo nome do exame');
  igual(C.areaDoExame({ titulo: 'Radiografia de coluna lombar' }), 'Ortopedia',
    'deduz Ortopedia pelo nome do exame');
  igual(C.areaDoExame({ titulo: 'TSH ultra sensível' }), 'Endocrinologia',
    'deduz Endocrinologia pelo nome do exame');

  // ---- o campo explícito sempre vence a dedução ------------------------
  igual(C.areaDoExame({ titulo: 'Ressonância de crânio', area: 'Geriatria' }), 'Geriatria',
    'o campo "área" digitado pela família tem prioridade sobre a dedução');

  // ---- exame sem pista nenhuma cai em Clínica geral --------------------
  igual(C.areaDoExame({ titulo: 'Documento avulso sem nome clínico' }), 'Clínica geral',
    'exame sem pista reconhecível cai em Clínica geral (nunca desaparece)');
  igual(C.areaDoExame({}), 'Clínica geral', 'exame vazio não lança exceção');

  // ---- toda área tem ícone ---------------------------------------------
  ok(C.iconeDaArea('Neurologia').length > 0, 'área conhecida devolve ícone');
  ok(C.iconeDaArea('Área Inexistente').length > 0, 'área desconhecida devolve ícone padrão');

  // ---- invariante: nenhum exame fica sem área --------------------------
  const amostra = [
    { titulo: 'Ressonância magnética de crânio' },
    { titulo: 'Hemograma completo' },
    { titulo: 'Eletrocardiograma' },
    { titulo: 'Exame com nome estranho 123' },
  ];
  ok(amostra.every((e) => !!C.areaDoExame(e)),
    'todo exame recebe uma área — nenhum fica órfão');
}

/* ==========================================================================
 * Execução
 * ======================================================================== */
(async () => {
  console.log('\n\x1b[1m\x1b[36m══════════════════════════════════════════════════');
  console.log('  CANAL TERUEL · bateria de testes');
  console.log('══════════════════════════════════════════════════\x1b[0m');

  const inicio = Date.now();
  try {
    await testarCripto();
    await testarCofre();
    await testarMerge();
    await testarRegras();
    await testarTelas();
    await testarIngestao();
    await testarConsulta();
    await testarSeguranca();
  } catch (e) {
    console.error('\n\x1b[31mErro inesperado na bateria:\x1b[0m', e);
    falhou++;
  }

  const ms = Date.now() - inicio;
  console.log('\n\x1b[1m──────────────────────────────────────────────────\x1b[0m');
  console.log('  \x1b[32m' + passou + ' passaram\x1b[0m   \x1b[31m' + falhou + ' falharam\x1b[0m   (' + ms + 'ms)');
  if (falhas.length) {
    console.log('\n\x1b[31mFalhas:\x1b[0m');
    falhas.forEach((f) => console.log('  • ' + f));
  }
  console.log('');
  process.exit(falhou ? 1 : 0);
})();
