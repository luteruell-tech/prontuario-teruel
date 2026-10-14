#!/usr/bin/env node
/* ============================================================================
 * Canal Teruel · Capturas de interface   (tools/capturas.mjs)
 * ----------------------------------------------------------------------------
 * Sobe o app num navegador de verdade, cria o cofre, semeia dados realistas
 * (exames de imagem, laboratoriais e outros) e salva as telas em .capturas/.
 *
 * Uso:
 *   npm run servir            # em outro terminal (porta 8080)
 *   node tools/capturas.mjs
 * ==========================================================================*/

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = resolve(process.env.OUT || '.capturas');
const PIN = 'Canal@2026';

mkdirSync(OUT, { recursive: true });

/* =========================================================================
 * DADOS — dois pacientes, com exames de imagem, laboratoriais e outros
 * ======================================================================= */
const DADOS = {
  medicamentos: [
    { id: 'med-1', pacienteId: 'pac-maria', nome: 'Donepezila', dose: '10 mg', horarios: ['20:00'], ativo: true, via: 'oral', indicacao: 'Alzheimer — memória', prescricaoPor: 'Dr. Almeida (Neurologia)', inicio: '2025-08-01' },
    { id: 'med-2', pacienteId: 'pac-maria', nome: 'Memantina', dose: '10 mg', horarios: ['08:00', '20:00'], ativo: true, via: 'oral', indicacao: 'Alzheimer — função cognitiva', prescricaoPor: 'Dr. Almeida (Neurologia)' },
    { id: 'med-3', pacienteId: 'pac-maria', nome: 'Losartana', dose: '50 mg', horarios: ['08:00', '20:00'], ativo: true, indicacao: 'Pressão alta' },
    { id: 'med-4', pacienteId: 'pac-maria', nome: 'Metformina', dose: '850 mg', horarios: ['08:00', '12:00', '20:00'], ativo: true, indicacao: 'Diabetes' },
    { id: 'med-5', pacienteId: 'pac-maria', nome: 'Carbonato de cálcio + Vitamina D', dose: '1 cp', horarios: ['08:00'], ativo: true, indicacao: 'Osteoporose' },
    { id: 'med-6', pacienteId: 'pac-joao', nome: 'AAS', dose: '100 mg', horarios: ['08:00'], ativo: true, indicacao: 'Anticoagulação (AVC)' },
    { id: 'med-7', pacienteId: 'pac-joao', nome: 'Atorvastatina', dose: '40 mg', horarios: ['20:00'], ativo: true, indicacao: 'Colesterol / proteção vascular' },
    { id: 'med-8', pacienteId: 'pac-joao', nome: 'Losartana', dose: '50 mg', horarios: ['12:00'], ativo: true, indicacao: 'Pressão alta' },
    { id: 'med-9', pacienteId: 'pac-joao', nome: 'Omeprazol', dose: '20 mg', horarios: ['07:00'], ativo: true, indicacao: 'Proteção gástrica' },
  ],

  sinais: [
    ...[['2026-03-01', '142/88'], ['2026-03-03', '150/92'], ['2026-03-05', '138/84'], ['2026-03-08', '146/90'], ['2026-03-10', '134/82']]
      .map(([d, v], i) => ({ id: 'sg-pa-' + i, pacienteId: 'pac-maria', tipo: 'pa', valor: v, unidade: 'mmHg', medidoEm: new Date(d + 'T09:00:00').getTime(), registradoPorNome: 'Célia' })),
    ...[['2026-03-02', '162'], ['2026-03-06', '148'], ['2026-03-09', '171']]
      .map(([d, v], i) => ({ id: 'sg-gl-' + i, pacienteId: 'pac-maria', tipo: 'glicemia', valor: v, unidade: 'mg/dL', medidoEm: new Date(d + 'T07:30:00').getTime(), registradoPorNome: 'Ana' })),
    ...[['2026-03-01', '118/76'], ['2026-03-05', '126/80'], ['2026-03-09', '122/78']]
      .map(([d, v], i) => ({ id: 'sg-jp-' + i, pacienteId: 'pac-joao', tipo: 'pa', valor: v, unidade: 'mmHg', medidoEm: new Date(d + 'T10:00:00').getTime(), registradoPorNome: 'Célia' })),
  ],

  exames: [
    /* ---------- IMAGEM ---------- */
    { id: 'ex-img-1', pacienteId: 'pac-maria', titulo: 'Ressonância magnética de crânio', categoria: 'imagem', area: 'Neurologia', data: '2026-03-05', unidade: 'Hospital São Luiz Morumbi', especialidade: 'Dr. Almeida', origem: 'Rede D\'Or', valores: [], conclusao: 'Leucoaraiose difusa de grau moderado. Redução volumétrica do hipocampo bilateral, compatível com quadro neurodegenerativo. Sem lesão aguda, sem sangramento.' },
    { id: 'ex-img-2', pacienteId: 'pac-joao', titulo: 'Ressonância magnética de crânio', categoria: 'imagem', area: 'Neurologia', data: '2026-02-18', unidade: 'Hospital São Luiz Morumbi', especialidade: 'Dr. Almeida', origem: 'Rede D\'Or', valores: [], conclusao: 'Encefalomalácia residual frontoparietal à direita (sequela dos eventos prévios). Leucoaraiose difusa. Sem nova lesão isquêmica aguda.' },
    { id: 'ex-img-3', pacienteId: 'pac-joao', titulo: 'USG Doppler de carótidas e vertebrais', categoria: 'imagem', area: 'Neurologia', data: '2026-01-15', unidade: 'Hospital São Luiz Morumbi', especialidade: 'Dr. Almeida', origem: 'Rede D\'Or', valores: [{ nome: 'Estenose carótida direita', valor: '50-69', unidade: '%', referencia: '0-49', min: 0, max: 49 }], conclusao: 'Placa aterosclerótica em carótida interna direita com estenose moderada (50–69%). Carótida esquerda com estenose leve. Fluxo vertebral preservado.' },
    { id: 'ex-img-4', pacienteId: 'pac-maria', titulo: 'Ecocardiograma transtorácico', categoria: 'imagem', area: 'Cardiologia', data: '2026-02-20', unidade: 'Hospital São Luiz Morumbi', especialidade: 'Dra. Regina', origem: 'Rede D\'Or', valores: [{ nome: 'Fração de ejeção', valor: '62', unidade: '%', referencia: '>= 55', min: 55, max: null }], conclusao: 'Função sistólica preservada (FE 62%). Hipertrofia leve do ventrículo esquerdo. Discreta esclerose valvar mitral e aórtica, sem repercussão.' },
    { id: 'ex-img-5', pacienteId: 'pac-joao', titulo: 'Tomografia computadorizada de tórax', categoria: 'imagem', area: 'Pneumologia', data: '2026-01-28', unidade: 'Hospital São Luiz Morumbi', especialidade: 'Dr. Nogueira', origem: 'Rede D\'Or', valores: [], conclusao: 'Enfisema centrolobular leve. Sem nódulos pulmonares significativos. Sem derrame pleural.' },
    { id: 'ex-img-6', pacienteId: 'pac-maria', titulo: 'USG de abdome total', categoria: 'imagem', area: 'Gastroenterologia', data: '2026-02-05', unidade: 'Clínica D\'Or', especialidade: 'Dra. Simone', origem: 'Rede D\'Or', valores: [], conclusao: 'Esteatose hepática leve. Vesícula com cálculo único de 1,2 cm, sem sinais de colecistite. Rins sem alterações.' },
    { id: 'ex-img-7', pacienteId: 'pac-maria', titulo: 'Radiografia de coluna lombar', categoria: 'imagem', area: 'Ortopedia', data: '2026-01-30', unidade: 'Hospital São Luiz Morumbi', especialidade: 'Dr. Tanaka', origem: 'Rede D\'Or', valores: [], conclusao: 'Retificação da lordose lombar. Osteopenia. Alterações degenerativas discais L4-L5 e L5-S1.' },

    /* ---------- LABORATORIAL ---------- */
    { id: 'ex-lab-1', pacienteId: 'pac-maria', titulo: 'Hemograma completo', categoria: 'laboratorial', area: 'Clínica geral', data: '2026-03-02', unidade: 'Laboratório D\'Or', especialidade: 'Dra. Regina', origem: 'Rede D\'Or', valores: [
      { nome: 'Hemoglobina', valor: '11.2', unidade: 'g/dL', referencia: '12-16', min: 12, max: 16 },
      { nome: 'Hematócrito', valor: '34', unidade: '%', referencia: '36-46', min: 36, max: 46 },
      { nome: 'Leucócitos', valor: '6.800', unidade: '/mm³', referencia: '4.000-11.000', min: 4000, max: 11000 },
      { nome: 'Plaquetas', valor: '210.000', unidade: '/mm³', referencia: '150.000-450.000', min: 150000, max: 450000 },
    ], conclusao: 'Anemia leve normocrômica. Série branca e plaquetas sem alterações.' },
    { id: 'ex-lab-2', pacienteId: 'pac-joao', titulo: 'Creatinina sérica', categoria: 'laboratorial', area: 'Nefrologia', data: '2026-03-03', unidade: 'Laboratório D\'Or', especialidade: 'Dra. Regina', origem: 'Rede D\'Or', valores: [
      { nome: 'Creatinina', valor: '1.9', unidade: 'mg/dL', referencia: '0.6-1.2', min: 0.6, max: 1.2 },
      { nome: 'Taxa de filtração estimada', valor: '38', unidade: 'mL/min', referencia: '>= 60', min: 60, max: null },
    ], conclusao: 'Função renal reduzida. Monitorar hidratação e evitar contraste nefrotóxico.' },
    { id: 'ex-lab-3', pacienteId: 'pac-maria', titulo: 'Glicemia de jejum', categoria: 'laboratorial', area: 'Endocrinologia', data: '2026-03-02', unidade: 'Laboratório D\'Or', especialidade: 'Dra. Regina', origem: 'Rede D\'Or', valores: [
      { nome: 'Glicose', valor: '158', unidade: 'mg/dL', referencia: '70-99', min: 70, max: 99 },
    ], conclusao: 'Controle glicêmico inadequado.' },
    { id: 'ex-lab-4', pacienteId: 'pac-maria', titulo: 'Hemoglobina glicada (HbA1c)', categoria: 'laboratorial', area: 'Endocrinologia', data: '2026-02-10', unidade: 'Laboratório D\'Or', especialidade: 'Dra. Regina', origem: 'Rede D\'Or', valores: [
      { nome: 'HbA1c', valor: '8.1', unidade: '%', referencia: '4.0-5.6', min: 4, max: 5.6 },
    ], conclusao: 'Média glicêmica elevada nos últimos 3 meses.' },
    { id: 'ex-lab-5', pacienteId: 'pac-maria', titulo: 'Vitamina B12 e ácido fólico', categoria: 'laboratorial', area: 'Neurologia', data: '2026-02-10', unidade: 'Laboratório D\'Or', especialidade: 'Dr. Almeida', origem: 'Rede D\'Or', valores: [
      { nome: 'Vitamina B12', valor: '210', unidade: 'pg/mL', referencia: '200-900', min: 300, max: 900 },
      { nome: 'Ácido fólico', valor: '8.4', unidade: 'ng/mL', referencia: '3.0-17.0', min: 3, max: 17 },
    ], conclusao: 'B12 no limite inferior — investigar causa de déficit cognitivo reversível.' },
    { id: 'ex-lab-6', pacienteId: 'pac-maria', titulo: 'TSH e T4 livre', categoria: 'laboratorial', area: 'Endocrinologia', data: '2026-02-10', unidade: 'Laboratório D\'Or', especialidade: 'Dr. Almeida', origem: 'Rede D\'Or', valores: [
      { nome: 'TSH', valor: '3.2', unidade: 'µUI/mL', referencia: '0.4-4.5', min: 0.4, max: 4.5 },
    ], conclusao: 'Função tireoidiana normal.' },
    { id: 'ex-lab-7', pacienteId: 'pac-joao', titulo: 'Perfil lipídico', categoria: 'laboratorial', area: 'Cardiologia', data: '2026-03-03', unidade: 'Laboratório D\'Or', especialidade: 'Dra. Regina', origem: 'Rede D\'Or', valores: [
      { nome: 'LDL colesterol', valor: '130', unidade: 'mg/dL', referencia: '< 100', min: 0, max: 100 },
      { nome: 'HDL colesterol', valor: '42', unidade: 'mg/dL', referencia: '> 40', min: 40, max: null },
      { nome: 'Triglicerídeos', valor: '168', unidade: 'mg/dL', referencia: '< 150', min: 0, max: 150 },
    ], conclusao: 'LDL acima da meta para paciente de alto risco vascular.' },
    { id: 'ex-lab-8', pacienteId: 'pac-joao', titulo: 'Ureia e eletrólitos', categoria: 'laboratorial', area: 'Nefrologia', data: '2026-03-03', unidade: 'Laboratório D\'Or', especialidade: 'Dra. Regina', origem: 'Rede D\'Or', valores: [
      { nome: 'Ureia', valor: '62', unidade: 'mg/dL', referencia: '15-45', min: 15, max: 45 },
      { nome: 'Potássio', valor: '4.8', unidade: 'mEq/L', referencia: '3.5-5.1', min: 3.5, max: 5.1 },
      { nome: 'Sódio', valor: '138', unidade: 'mEq/L', referencia: '135-145', min: 135, max: 145 },
    ], conclusao: 'Ureia elevada, compatível com função renal reduzida. Eletrólitos estáveis.' },

    /* ---------- OUTROS ---------- */
    { id: 'ex-out-1', pacienteId: 'pac-maria', titulo: 'Avaliação neuropsicológica (MEEM)', categoria: 'outro', area: 'Neurologia', data: '2026-02-25', unidade: 'Instituto de Neurologia', especialidade: 'Dra. Helena (Neuropsicologia)', origem: 'Particular', valores: [
      { nome: 'MEEM', valor: '20', unidade: '/30', referencia: '>= 24', min: 24, max: null },
      { nome: 'Fluência verbal (animais)', valor: '9', unidade: '/min', referencia: '>= 13', min: 13, max: null },
    ], conclusao: 'Declínio cognitivo moderado, com prejuízo de memória recente e funções executivas. Compatível com doença de Alzheimer em fase moderada.' },
    { id: 'ex-out-2', pacienteId: 'pac-joao', titulo: 'Eletrocardiograma de repouso', categoria: 'outro', area: 'Cardiologia', data: '2026-01-20', unidade: 'Hospital São Luiz Morumbi', especialidade: 'Dra. Regina', origem: 'Rede D\'Or', valores: [], conclusao: 'Ritmo sinusal, 72 bpm. Sobrecarga atrial esquerda. Alterações inespecíficas de repolarização.' },
    { id: 'ex-out-3', pacienteId: 'pac-joao', titulo: 'Endoscopia digestiva alta', categoria: 'outro', area: 'Gastroenterologia', data: '2026-02-12', unidade: 'Hospital São Luiz Morumbi', especialidade: 'Dr. Prado', origem: 'Rede D\'Or', valores: [], conclusao: 'Gastrite enantematosa leve em antro. Sem úlcera. Biópsias sem malignidade.' },
  ],

  documentos: [
    { id: 'doc-1', pacienteId: 'pac-maria', titulo: 'Laudo — RM de crânio (05/03/2026)', categoria: 'Imagem / radiologia', data: '2026-03-05', unidade: 'Hospital São Luiz Morumbi', origem: 'Rede D\'Or', descricao: 'Laudo completo com imagens; mostra leucoaraiose e redução do hipocampo.', arquivoId: 'arq-fake-1', nomeArquivo: 'rm-cranio-maria-2026-03-05.pdf', mime: 'application/pdf', tamanho: 482100 },
    { id: 'doc-2', pacienteId: 'pac-joao', titulo: 'Laudo — RM de crânio (18/02/2026)', categoria: 'Imagem / radiologia', data: '2026-02-18', unidade: 'Hospital São Luiz Morumbi', origem: 'Rede D\'Or', descricao: 'Encefalomalácia residual à direita.', arquivoId: 'arq-fake-2', nomeArquivo: 'rm-cranio-joao-2026-02-18.pdf', mime: 'application/pdf', tamanho: 512000 },
    { id: 'doc-3', pacienteId: 'pac-joao', titulo: 'Laudo — Doppler de carótidas (15/01/2026)', categoria: 'Imagem / radiologia', data: '2026-01-15', unidade: 'Hospital São Luiz Morumbi', origem: 'Rede D\'Or', descricao: 'Estenose moderada em carótida direita.', arquivoId: 'arq-fake-3', nomeArquivo: 'doppler-carotidas-joao.pdf', mime: 'application/pdf', tamanho: 330000 },
    { id: 'doc-4', pacienteId: 'pac-maria', titulo: 'Laboratoriais — painel de 02/03/2026', categoria: 'Resultado laboratorial', data: '2026-03-02', unidade: 'Laboratório D\'Or', origem: 'Rede D\'Or', descricao: 'Hemograma, glicemia e função renal.', arquivoId: 'arq-fake-4', nomeArquivo: 'laboratoriais-maria-2026-03-02.pdf', mime: 'application/pdf', tamanho: 210000 },
    { id: 'doc-5', pacienteId: 'pac-maria', titulo: 'Relatório — Neuropsicologia (25/02/2026)', categoria: 'Relatório médico', data: '2026-02-25', unidade: 'Instituto de Neurologia', origem: 'Particular', descricao: 'MEEM 20/30 — declínio cognitivo moderado.', arquivoId: 'arq-fake-5', nomeArquivo: 'neuropsicologia-maria.pdf', mime: 'application/pdf', tamanho: 145000 },
    { id: 'doc-6', pacienteId: 'pac-joao', titulo: 'Receita — medicações contínuas', categoria: 'Receita médica', data: '2026-03-01', unidade: 'Consultório Dra. Regina', origem: 'Amil', descricao: 'Receita de 90 dias para AAS, Atorvastatina e Losartana.', arquivoId: 'arq-fake-6', nomeArquivo: 'receita-joao.pdf', mime: 'application/pdf', tamanho: 98000 },
  ],

  eventos: [
    { id: 'ev-1', pacienteId: 'pac-maria', tipo: 'consulta', titulo: 'Neurologia — retorno', inicio: '2026-10-20T09:00:00', local: 'Hospital São Luiz Morumbi', profissional: 'Dr. Almeida', precisaAcompanhante: true, status: 'agendado', observacao: 'Levar RM de crânio e laudo da neuropsicologia (MEEM 20).' },
    { id: 'ev-2', pacienteId: 'pac-joao', tipo: 'consulta', titulo: 'Nefrologia — avaliação', inicio: '2026-10-22T14:30:00', local: 'Hospital São Luiz Morumbi', profissional: 'Dra. Regina', precisaAcompanhante: true, status: 'agendado', observacao: 'Creatinina 1,9 — levar laboratoriais de 03/03.' },
    { id: 'ev-3', pacienteId: 'pac-maria', tipo: 'exame', titulo: 'Coleta de laboratoriais', inicio: '2026-10-19T07:30:00', local: 'Laboratório D\'Or', status: 'agendado', observacao: 'Jejum de 8 horas.' },
    { id: 'ev-4', pacienteId: 'pac-joao', tipo: 'terapia', titulo: 'Fisioterapia motora', inicio: '2026-10-21T10:00:00', local: 'Clínica Movimento', precisaAcompanhante: true, status: 'agendado' },
    { id: 'ev-5', pacienteId: 'pac-maria', tipo: 'consulta', titulo: 'Cardiologia — rotina', inicio: '2026-11-05T11:00:00', local: 'Hospital São Luiz Morumbi', profissional: 'Dra. Regina', status: 'agendado' },
  ],

  mural: [
    { id: 'mu-1', tipo: 'escala', texto: 'Escala da semana — Terça: Ana leva no Dr. Almeida. Quinta: Célia na fisioterapia com o Seu João.', data: '2026-10-13', autorNome: 'Luciana', criadoEm: Date.now() - 3600000, fixado: true },
    { id: 'mu-2', tipo: 'aviso', texto: 'A dona Maria está repetindo mais as perguntas. Anotei no Diário — vale comentar com o Dr. Almeida no retorno.', data: '2026-10-12', autorNome: 'Ana', criadoEm: Date.now() - 86400000 },
    { id: 'mu-3', tipo: 'conquista', texto: 'Seu João voltou a andar do quarto até a sala com apoio. Pequena vitória!', data: '2026-10-11', autorNome: 'Célia', criadoEm: Date.now() - 172800000 },
  ],

  diario: [
    { id: 'di-1', pacienteId: 'pac-maria', texto: 'Dormiu bem. Comeu pouco no almoço. Repetiu a mesma pergunta 4 vezes sobre o almoço. Andou pela casa sem apoio.', autorNome: 'Célia', criadoEm: Date.now() - 43200000 },
    { id: 'di-2', pacienteId: 'pac-joao', texto: 'Dia bom. Fez a fisioterapia sem dor. Queixou-se de cansaço à tarde. Pressão estável.', autorNome: 'Ana', criadoEm: Date.now() - 90000000 },
  ],

  amil: {
    carteirinhas: [
      { id: 'ac-1', beneficiario: 'Maria Izaulina', carteira: '9988771122', plano: 'Amil One 400', acomodacao: 'Apartamento', abrangencia: 'Nacional', ans: '326305', validade: '2027-12-31' },
      { id: 'ac-2', beneficiario: 'João Teruel', carteira: '9988771133', plano: 'Amil One 400', acomodacao: 'Apartamento', abrangencia: 'Nacional', ans: '326305', validade: '2027-12-31' },
    ],
    guias: [
      { id: 'gui-1', beneficiario: 'Maria Izaulina', procedimento: 'Ressonância magnética de crânio com contraste', numero: '4471209', senha: 'K7P2X9', validade: '2026-11-30', emissao: '2026-10-10', prestador: 'Hospital São Luiz Morumbi', solicitante: 'Dr. Almeida' },
      { id: 'gui-2', beneficiario: 'João Teruel', procedimento: 'Ultrassom de vias urinárias', numero: '4471388', senha: 'B4M8Q1', validade: '2026-11-15', emissao: '2026-10-11', prestador: 'Clínica D\'Or', solicitante: 'Dra. Regina' },
    ],
    faturas: [
      { id: 'fat-1', beneficiario: 'Maria Izaulina', referencia: '09/2026', protocolo: 'RE-887711', total: 1284.60, itens: [
        { data: '2026-09-04', procedimento: 'Consulta em neurologia', valor: 420.00 },
        { data: '2026-09-10', procedimento: 'Laboratoriais — perfil metabólico', valor: 264.60 },
        { data: '2026-09-22', procedimento: 'Sessão de fisioterapia', valor: 180.00 },
        { data: '2026-09-28', procedimento: 'Consulta em cardiologia', valor: 420.00 },
      ] },
    ],
  },
};

/* =========================================================================
 * Captura
 * ======================================================================= */
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  locale: 'pt-BR',
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [erro na página]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text()); });

const shot = async (nome) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: resolve(OUT, nome), fullPage: true });
  console.log('  📸', nome);
};
const ir = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(700); };
const clicarArea = async (nome) => {
  const alvo = await page.$('[data-area="' + nome + '"]');
  if (alvo) { await alvo.click(); await page.waitForTimeout(700); }
  else console.log('  [aviso] especialidade não encontrada:', nome);
};
const entrar = async () => {
  await page.waitForTimeout(400);
  const campo = await page.$('#pin-input');
  if (campo) { await campo.fill(PIN); await page.click('#btn-entrar'); await page.waitForTimeout(1400); }
};

try {
  console.log('→ abrindo', BASE);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot('00-boas-vindas.png');

  // 1. cria o cofre (sem passar pela UI, para agilizar)
  await page.evaluate(async (pin) => {
    const auth = await import('/assets/js/auth.js');
    await auth.criarCofre({
      nomeCanal: 'Canal Teruel',
      membro: { nome: 'Luciana Teruel', papel: 'admin', avatarEmoji: '👩', cor: '#B4634F', pin },
    });
  }, PIN);

  // 2. tela de entrada (mostra o PIN)
  await page.reload({ waitUntil: 'networkidle' });
  await shot('01-entrada.png');
  await entrar();

  // 3. semeia os dados
  console.log('→ semeando dados…');
  await page.evaluate(async (d) => {
    const store = await import('/assets/js/store.js');
    for (const col of ['medicamentos', 'sinais', 'exames', 'documentos', 'eventos', 'mural', 'diario']) {
      for (const it of d[col]) store.inserir(col, it);
    }
    const e = store.estado;
    e.amil.guias = d.amil.guias;
    e.amil.faturas = d.amil.faturas;
    e.amil.carteirinhas = d.amil.carteirinhas;
    e.amil.ultimaConferencia = Date.now() - 86400000;
    await store.salvar(true);
  }, DADOS);

  // 4. recarrega e entra de novo (estado já semeado)
  await page.reload({ waitUntil: 'networkidle' });
  await entrar();

  // 5. capturas
  await ir('#/painel');       await shot('02-painel.png');
  await ir('#/prontuario');   await shot('03-prontuario-resumo.png');
  await ir('#/exames');       await shot('04-exames.png');
  await ir('#/medicamentos'); await shot('05-medicacoes.png');
  await ir('#/sinais');       await shot('06-sinais.png');
  await ir('#/documentos');   await shot('07-documentos.png');
  await ir('#/amil');         await shot('08-amil.png');
  await ir('#/dor');          await shot('09-rede-dor.png');
  await ir('#/mural');        await shot('10-mural.png');
  await ir('#/auditoria');    await shot('11-auditoria.png');

  // filtro de categoria: só imagem
  await ir('#/exames');
  await page.selectOption('#f-cat', 'imagem');
  await shot('04b-exames-imagem.png');

  // Modo consulta — a tela que vai na frente do médico
  await ir('#/consulta?paciente=pac-maria');
  await shot('04c-consulta-todas-areas.png');

  await ir('#/consulta?paciente=pac-maria');
  await clicarArea('Neurologia');
  await shot('04d-consulta-neurologia.png');

  await ir('#/consulta?paciente=pac-joao');
  await clicarArea('Neurologia');
  await shot('04e-consulta-joao-neurologia.png');

  await ir('#/consulta?paciente=pac-maria');
  await page.click('[data-modo="tudo"]');
  await page.waitForTimeout(400);
  await shot('04f-consulta-acervo-completo.png');

  console.log('\n✅ capturas em', OUT);
} finally {
  await browser.close();
}
