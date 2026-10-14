#!/usr/bin/env node
/* ============================================================================
 * Canal Teruel · Coletor assistido do Meu Amil   (tools/coletor.mjs)
 * ----------------------------------------------------------------------------
 * PARA QUE SERVE
 *   Um site (o Canal Teruel) não consegue fazer login na conta da Amil: o
 *   navegador bloqueia por CORS, não há servidor para manter a sessão e a
 *   Amil pede verificação em duas etapas — que é uma pessoa confirmando.
 *
 *   Este coletor roda NO COMPUTADOR DA FAMÍLIA. Ele abre o navegador, você faz
 *   o login UMA vez (a sessão fica salva numa pasta local sua), e a partir daí
 *   ele junta os arquivos (PDFs/CSVs) numa pasta e monta um LOTE único
 *   (.teruellote). Depois é só importar esse lote no app.
 *
 * O QUE ELE *NÃO* FAZ
 *   · Não guarda senha em lugar nenhum (só o cookie de sessão do navegador).
 *   · Não envia nada para servidor nosso — não existe servidor nosso.
 *   · Não furta proteção: se a Amil pedir código por SMS/e-mail, VOCÊ digita.
 *
 * USO
 *   npm install                       # instala o Playwright (uma vez)
 *   npx playwright install chromium   # baixa o navegador (uma vez)
 *   npm run coletar -- --paciente maria --desde 2026-01-01
 *
 *   Opções:
 *     --paciente <nome>     rótulo do lote (ex.: maria)
 *     --desde <aaaa-mm-dd>  data inicial (só para montar a busca; opcional)
 *     --saida <arquivo>     nome do lote gerado
 *     --pasta <dir>         pasta de downloads (padrão: downloads-amil/)
 *     --perfil <dir>        pasta da sessão logada (padrão: .collector-profile/)
 *     --incluir-existentes  também inclui o que já estava na pasta
 * ==========================================================================*/

import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import { createInterface } from 'node:readline';

const URL_AMIL = 'https://www.amil.com.br/beneficiario/';

/* --------------------------------------------------------------- argumentos */
const argv = process.argv.slice(2);
const pega = (nome, padrao) => {
  const i = argv.indexOf('--' + nome);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : padrao;
};
const temFlag = (nome) => argv.includes('--' + nome);

const paciente = pega('paciente', 'beneficiario');
const desde = pega('desde', '');
const pasta = resolve(pega('pasta', 'downloads-amil'));
const perfil = resolve(pega('perfil', '.collector-profile'));
const hoje = new Date().toISOString().slice(0, 10);
const saida = resolve(pega('saida', `lote-${paciente}-${hoje}.teruellote`));

/* ------------------------------------------------------------------- ajuda  */
const linha = () => console.log('─'.repeat(62));

function banner() {
  linha();
  console.log('  CANAL TERUEL · coletor assistido do Meu Amil');
  linha();
  console.log('  Paciente ......... ' + paciente);
  console.log('  Desde ............ ' + (desde || '(tudo o que você baixar)'));
  console.log('  Pasta de arquivos  ' + pasta);
  console.log('  Sessão salva em .. ' + perfil);
  console.log('  Lote de saída .... ' + saida);
  linha();
}

/* ------------------------------------------------------- leitura de arquivo */
function ehTexto(nome) {
  return /\.(csv|txt|html?|json)$/i.test(nome);
}

/** Lê um arquivo e devolve o item de lote (base64 + texto, se for texto). */
function itemDoArquivo(caminho) {
  const bruto = readFileSync(caminho);
  const nome = basename(caminho);
  const ext = extname(nome).toLowerCase();
  const MIME = {
    '.pdf': 'application/pdf', '.csv': 'text/csv', '.txt': 'text/plain',
    '.html': 'text/html', '.htm': 'text/html', '.json': 'application/json',
  };
  const item = { nome, mime: MIME[ext] || 'application/octet-stream', base64: bruto.toString('base64') };
  if (ehTexto(nome)) { try { item.texto = bruto.toString('utf8'); } catch { /* binário disfarçado */ } }
  return item;
}

/** Lista os arquivos relevantes de uma pasta (ordenados por data). */
function listar(pasta, desdeMs) {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta)
    .filter((n) => !n.startsWith('.') && /\.(pdf|csv|txt|html?|json)$/i.test(n))
    .map((n) => join(pasta, n))
    .filter((p) => {
      const s = statSync(p);
      return s.isFile() && (!desdeMs || s.mtimeMs >= desdeMs);
    })
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

/* ------------------------------------------------------------- interação CLI */
function perguntar(txt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(txt, (r) => { rl.close(); res(r.trim()); }));
}

/* ----------------------------------------------------------------- programa */
async function main() {
  banner();

  // 1. Playwright é opcional: sem ele, o script explica como instalar.
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.log('\n⚠️  Playwright não está instalado neste computador.\n');
    console.log('   Instale uma vez (na pasta do projeto):');
    console.log('     npm install');
    console.log('     npx playwright install chromium\n');
    console.log('   Depois rode de novo:');
    console.log('     npm run coletar -- --paciente ' + paciente + (desde ? ' --desde ' + desde : '') + '\n');
    process.exitCode = 1;
    return;
  }

  mkdirSync(pasta, { recursive: true });
  mkdirSync(perfil, { recursive: true });

  const desdeMs = desde ? new Date(desde + 'T00:00:00').getTime() : 0;
  const jaTinha = new Set(listar(pasta, 0));
  const novos = new Set();

  console.log('\nAbrindo o navegador… (a janela vai aparecer)');
  const ctx = await chromium.launchPersistentContext(perfil, {
    headless: false,
    acceptDownloads: true,
    downloadsPath: pasta,
    locale: 'pt-BR',
    viewport: { width: 1280, height: 900 },
  });

  // captura cada download que o site disparar
  const capturar = (dl) => {
    const nome = dl.suggestedFilename() || ('arquivo-' + Date.now());
    const destino = join(pasta, nome);
    dl.saveAs(destino).then(() => {
      novos.add(destino);
      console.log('   ⬇  baixado: ' + nome);
    }).catch(() => { /* cancelado pelo usuário */ });
  };
  ctx.on('page', (pg) => pg.on('download', capturar));
  for (const pg of ctx.pages()) pg.on('download', capturar);

  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('download', capturar);

  console.log('Abrindo o Meu Amil…');
  try {
    await page.goto(URL_AMIL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch {
    console.log('   (não consegui abrir sozinho — navegue manualmente na janela)');
  }

  console.log('\n' + '='.repeat(62));
  console.log('  O QUE FAZER AGORA, na janela do navegador:');
  console.log('='.repeat(62));
  console.log('  1. Faça o LOGIN do beneficiário (CPF + senha).');
  console.log('     Se a Amil pedir código por SMS/e-mail, digite você mesmo.');
  console.log('  2. Vá em EXTRATO / AUTORIZAÇÕES / REEMBOLSOS' + (desde ? ' (período desde ' + desde + ')' : ''));
  console.log('     e clique em BAIXAR (PDF ou CSV). Pode baixar vários.');
  console.log('  3. Se o site abrir o PDF no visualizador, use o botão de');
  console.log('     download dele — ou salve o arquivo dentro de:');
  console.log('       ' + pasta);
  console.log('');
  console.log('  → Tudo o que você baixar entra no lote automaticamente.');
  console.log('  → A sessão fica salva: nas próximas vezes talvez você já');
  console.log('    esteja logado e baste baixar.');
  console.log('');

  await perguntar('  Pressione ENTER quando tiver terminado os downloads… ');

  // 4. Tenta também puxar links diretos da página atual (PDF/CSV).
  const tentar = await perguntar('  Tentar baixar automaticamente os links PDF/CSV abertos na página? (s/N) ');
  if (/^s/i.test(tentar)) {
    try {
      const urls = await page.evaluate(() => {
        const alvos = [...document.querySelectorAll('a[href]')];
        return alvos.map((a) => a.href)
          .filter((h) => /\.(pdf|csv)(\?|$)/i.test(h))
          .filter((h, i, arr) => arr.indexOf(h) === i)
          .slice(0, 50);
      });
      console.log('   Encontrei ' + urls.length + ' link(s). Abrindo cada um…');
      for (const u of urls) {
        try {
          const resp = await ctx.request.get(u);
          if (!resp.ok()) continue;
          const buf = Buffer.from(await resp.body());
          const nome = decodeURIComponent((u.split('/').pop() || 'arquivo').split('?')[0]);
          const destino = join(pasta, nome.endsWith('.pdf') || nome.endsWith('.csv') ? nome : nome + '.pdf');
          writeFileSync(destino, buf);
          novos.add(destino);
          console.log('   ⬇  ' + basename(destino));
        } catch { /* link protegido — segue o jogo */ }
      }
    } catch { console.log('   (não consegui varrer os links — sem problema)'); }
  }

  await ctx.close();

  // 5. Junta tudo num lote.
  const incluirTodos = temFlag('incluir-existentes');
  const arquivos = listar(pasta, desdeMs).filter((p) => incluirTodos || novos.has(p) || !jaTinha.has(p));
  const lista = (arquivos.length ? arquivos : listar(pasta, 0));

  if (!lista.length) {
    console.log('\n⚠️  Nenhum arquivo encontrado em ' + pasta + '.');
    console.log('    Nada foi gerado. Baixe pelo menos um PDF/CSV e rode de novo.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\nMontando o lote com ' + lista.length + ' arquivo(s)…');
  const itens = lista.map((p) => itemDoArquivo(p));
  const lote = {
    tipo: 'teruel-lote',
    versao: 1,
    geradoEm: Date.now(),
    origem: 'coletor-cli',
    paciente,
    desde: desde || null,
    itens,
  };
  writeFileSync(saida, JSON.stringify(lote));

  const kb = (statSync(saida).size / 1024).toFixed(0);
  linha();
  console.log('  ✅ LOTE GERADO');
  console.log('  ' + saida + '  (' + kb + ' KB, ' + itens.length + ' arquivo(s))');
  linha();
  console.log('  Próximo passo:');
  console.log('   · Abra o Canal Teruel → Amil → Importar');
  console.log('   · Escolha este arquivo .teruellote');
  console.log('   · O app reconhece, extrai e arquiva sozinho.');
  console.log('');
}

main().catch((e) => {
  console.error('\n✗ Falha no coletor: ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
});
