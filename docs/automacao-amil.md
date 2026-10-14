# Automação da Amil — o que é possível, o que não é, e como usar

Documento direto. Explica **por que** o app não faz login sozinho no Meu Amil e
**como** você consegue, mesmo assim, parar de alimentar o painel à mão.

---

## 1. O problema real

O painel antigo funcionava assim: abrir o portal, baixar **um arquivo por vez**,
copiar os dados para o app. Resultado previsível — no dia seguinte estava
desatualizado e virou trabalho perdido.

O que **elimina** esse trabalho é a importação **em lote com conciliação**:
jogar tudo de uma vez e o app organizar sozinho. É isso que este app faz.

---

## 2. Por que não existe "bot de login" dentro do app

Não é uma escolha de estilo — são três barreiras técnicas concretas:

| Barreira | O que significa na prática |
|---|---|
| **CORS** | O navegador proíbe um site de ler a resposta de outro domínio. O app não consegue "conversar" com o Meu Amil por trás. |
| **Sem servidor** | Este app é um arquivo que roda no aparelho. Não há onde manter uma sessão logada nem guardar cookie de outro site. |
| **Dupla verificação** | A Amil pede um código (SMS/e-mail) que **uma pessoa** confirma. Um robô não tem como responder isso sozinho. |

Além disso, o **Portal do Desenvolvedor do Grupo Amil**
(`api-portal-dev.servicos.grupoamil.com.br`) é B2B: exige ID e segredo concedidos
a "desenvolvedores habilitados". Não existe API pública para pessoa física.

Qualquer "solução" que prometesse login automático seria: guardar a senha dos seus
pais em texto claro, burlar a verificação em duas etapas e quebrar os termos de uso
— expondo justamente quem você está tentando proteger.

---

## 3. As três formas legítimas de alimentar o app

### A) Importação em lote (manual, mas rápido)
1. No Meu Amil, baixe o que quiser (extrato, guias, reembolsos, carteirinha).
2. Abra **Amil → Importar** e escolha **vários arquivos de uma vez**.
3. O app reconhece o tipo, extrai os campos, concilia e arquiva.

Pode importar o mesmo período quantas vezes quiser: **não duplica**.

### B) Coletor assistido (a automação de verdade) — recomendado
Roda **no seu computador**, não em servidor nenhum:

```bash
npm install
npx playwright install chromium
npm run coletar -- --paciente maria --desde 2026-01-01 --saida lote-maria.teruellote
```

O que ele faz:
- abre o navegador e vai ao Meu Amil;
- **você** faz o login e a verificação (uma vez);
- a sessão fica salva na pasta `.collector-profile/` **do seu PC**;
- cada arquivo que você baixa na janela entra no lote automaticamente;
- no fim, gera um único `lote-maria.teruellote`.

Depois: **Amil → Importar** → escolha o `.teruellote`. Fim.

Na próxima vez, `npm run coletar` de novo — talvez já esteja logado.

> A senha nunca é gravada pelo coletor (só o cookie de sessão do navegador, na sua
> pasta local). Nada é enviado para fora.

### C) Canais oficiais (a fonte da verdade)
Sempre haverá conferências que só o portal/app resolve. Os atalhos ficam em
**Amil → Canais oficiais**.

---

## 4. O que o app extrai de cada documento

| Documento | O que é lido automaticamente |
|---|---|
| **Guia de autorização** (SP/SADT, internação) | número da guia, senha de autorização, validade, procedimento, prestador, solicitante |
| **Extrato de utilização** (PDF ou CSV) | data, procedimento, valor de cada linha + total |
| **Demonstrativo de reembolso** | protocolo, valor solicitado, valor pago por item |
| **Carteirinha** | número do beneficiário, plano, acomodação, abrangência, registro ANS, validade |

Os originais são **arquivados cifrados** em Documentos e ligados ao registro
correspondente (quem foi, qual unidade, qual data).

---

## 5. Conciliação — por que não duplica

- **Guias**: identifica por número ou senha. Repetida = atualizada, não duplicada.
- **Extratos**: compara cada linha por `data + procedimento + valor`. O que já
  existe é descartado; só o novo entra.
- **Carteirinhas**: compara beneficiário + número.

Entre aparelhos, vale a mesma regra do resto do app: vence o registro mais
recente e exclusões são respeitadas.

---

## 6. LGPD e responsabilidade

Com Alzheimer, é comum um filho ou cônjuge administrar o portal em nome dos pais.
Isso é legítimo quando feito pelo **responsável legal**, com ciência da família —
e o app registra **quem** fez o quê e quando, na Auditoria.

As credenciais do Meu Amil ficam **cifradas no cofre** (Amil → Acesso e senha):
sem o PIN de um membro, são ilegíveis, inclusive para quem copiar o arquivo do
aparelho. É melhor que o bloco de notas ou um papel na gaveta.

---

## 7. Verificação

```bash
npm test          # inclui a suíte "Ingestão Amil"
npm run verificar # integridade de imports/exports
```

A suíte de ingestão **prova** os pontos críticos: cada tipo é reconhecido, os
campos são extraídos, e **importar o mesmo extrato duas vezes não duplica linhas**.
