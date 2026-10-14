/* ============================================================================
 * Verificador de integridade do código  (tools/verificar.mjs)
 * ----------------------------------------------------------------------------
 * Roda no Node, sem dependências. Pega os erros que quebram o app silenciosamente
 * no navegador — principalmente imports nomeados que não existem no módulo de
 * origem (ESM lança erro e a tela fica em branco).
 *
 *   node tools/verificar.mjs
 * ==========================================================================*/

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const RAIZ = resolve(process.argv[2] || '.');
const problemas = [];
const avisos = [];

/** Junta todos os .js sob um diretório. */
const IGNORAR = new Set(['node_modules', '.git', '.wrangler', 'dist', 'build', 'coverage']);

function varrer(dir, saida = []) {
  for (const nome of readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) varrer(p, saida);
    else if (nome.endsWith('.js') || nome.endsWith('.mjs')) saida.push(p);
  }
  return saida;
}

/** Extrai exportações nomeadas + default de um módulo. */
function exportacoes(codigo) {
  const nomes = new Set();
  let temDefault = false;

  // export function/class/const/let/var nome
  for (const m of codigo.matchAll(/^\s*export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    nomes.add(m[1]);
  }
  // export { a, b as c }
  for (const m of codigo.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (const parte of m[1].split(',')) {
      const t = parte.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      nomes.add((as[1] || as[0]).trim());
    }
  }
  if (/^\s*export\s+default\b/m.test(codigo)) temDefault = true;
  return { nomes, temDefault };
}

/** Extrai cláusulas de import de um módulo. */
function importacoes(codigo, arquivo) {
  const lista = [];
  const re = /^\s*import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm;
  for (const m of codigo.matchAll(re)) {
    const clausula = m[1].trim();
    const fonte = m[2];
    if (!fonte.startsWith('.')) continue;              // pacote externo
    const nomes = [];
    let temDefault = false;
    let namespace = false;

    const chaves = clausula.match(/\{([^}]*)\}/);
    if (chaves) {
      for (const parte of chaves[1].split(',')) {
        const t = parte.trim();
        if (!t) continue;
        nomes.push(t.split(/\s+as\s+/)[0].trim());
      }
    }
    const antes = clausula.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    if (antes) {
      if (antes.startsWith('*')) namespace = true;
      else temDefault = true;
    }
    lista.push({ fonte, nomes, temDefault, namespace, linha: codigo.slice(0, m.index).split('\n').length });
  }
  return lista;
}

/** Remove strings e comentários — evita falsos positivos em checagens textuais. */
function semStrings(codigo) {
  let out = '';
  let i = 0;
  const n = codigo.length;
  while (i < n) {
    const c = codigo[i];
    const p = codigo[i + 1];
    if (c === '/' && p === '/') { while (i < n && codigo[i] !== '\n') i++; continue; }
    if (c === '/' && p === '*') { i += 2; while (i < n && !(codigo[i] === '*' && codigo[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const aspas = c; i++;
      while (i < n && codigo[i] !== aspas) { if (codigo[i] === '\\') i++; i++; }
      i++; out += '""'; continue;
    }
    out += c; i++;
  }
  return out;
}

const arquivos = varrer(RAIZ);
const cache = new Map();

function carregarExportacoes(caminho) {
  if (!cache.has(caminho)) cache.set(caminho, exportacoes(readFileSync(caminho, 'utf8')));
  return cache.get(caminho);
}

for (const arquivo of arquivos) {
  const codigo = readFileSync(arquivo, 'utf8');
  const rel = relative(RAIZ, arquivo);

  for (const imp of importacoes(codigo, arquivo)) {
    const alvo = resolve(dirname(arquivo), imp.fonte);
    if (!existsSync(alvo)) {
      problemas.push(`${rel}:${imp.linha} módulo não encontrado: ${imp.fonte}`);
      continue;
    }
    const exp = carregarExportacoes(alvo);
    for (const nome of imp.nomes) {
      if (!exp.nomes.has(nome)) {
        problemas.push(`${rel}:${imp.linha} importa "${nome}" que não é exportado por ${imp.fonte}`);
      }
    }
    if (imp.temDefault && !exp.temDefault) {
      problemas.push(`${rel}:${imp.linha} importa default inexistente de ${imp.fonte}`);
    }
  }

  // atribuição a binding importado — erro fatal em ESM
  const importados = new Set();
  for (const imp of importacoes(codigo, arquivo)) imp.nomes.forEach((n) => importados.add(n));
  const limpo = semStrings(codigo);
  for (const nome of importados) {
    const re = new RegExp('(^|[^.\\w$])' + nome.replace(/\$/g, '\\$') + '\\s*=(?!=)', 'gm');
    if (re.test(limpo)) {
      problemas.push(`${rel} atribui valor ao import "${nome}" — ilegal em ESM (use um setter do módulo)`);
    }
  }

  // concatenação acidental com mais unário: "..." + + '</select>'
  // — o segundo '+' aplica unary plus na string, produzindo NaN e engolindo
  //   o HTML seguinte (o parser absorve as tags como filhos do elemento aberto).
  const linhas = codigo.split('\n');
  linhas.forEach((linha, i) => {
    if (/^\s*\+\s*\+\s*['"`]/.test(linha)) {
      problemas.push(`${rel}:${i + 1} mau uso de "+ +" (mais unário acidental em concatenação de string)`);
    }
  });

  // checagens leves de HTML/JS desbalanceado
  const abre = (codigo.match(/<div\b/g) || []).length;
  const fecha = (codigo.match(/<\/div>/g) || []).length;
  if (rel.includes('views') && abre !== fecha) {
    avisos.push(`${rel} tags <div> desbalanceadas: ${abre} abre / ${fecha} fecha (pode ser string condicional)`);
  }
}

/* ---- index.html: todo script/stylesheet referenciado existe? ---- */
const html = existsSync(join(RAIZ, 'index.html')) ? readFileSync(join(RAIZ, 'index.html'), 'utf8') : null;
if (html) {
  for (const m of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) {
    const alvo = m[1];
    if (/^(https?:|data:|mailto:)/.test(alvo)) continue;
    if (!existsSync(join(RAIZ, alvo.replace(/^\//, '')))) {
      problemas.push(`index.html referencia arquivo inexistente: ${alvo}`);
    }
  }
} else {
  avisos.push('index.html não encontrado na raiz.');
}

/* ---- relatório ---- */
console.log('Arquivos analisados: ' + arquivos.length);
if (problemas.length) {
  console.log('\nPROBLEMAS (' + problemas.length + '):');
  for (const p of problemas) console.log('  ✗ ' + p);
} else {
  console.log('Nenhum problema de import/export encontrado.');
}
if (avisos.length) {
  console.log('\nAVISOS (' + avisos.length + '):');
  for (const a of avisos) console.log('  ! ' + a);
}
process.exit(problemas.length ? 1 : 0);
