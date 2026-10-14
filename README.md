# Canal Teruel

Aplicativo privado da família para acompanhar **Maria Izaulina** e **João Teruel** —
consultas, exames, internações, medicações, sinais vitais e documentos reunidos num
lugar só, com os dados **cifrados no próprio aparelho**.

Feito para uma família que cuida a distância e se divide entre várias pessoas
(5 familiares + acompanhante). O objetivo é um só: **falar sempre a mesma língua**.

---

## O que o app resolve

| Problema real | Como o app resolve |
|---|---|
| "Quem deu o remédio da mãe hoje?" | Tela **Medicações** com doses do dia, quem registrou e desfazer |
| "Que exame ficou de sair?" | **Central Rede D'Or** com acompanhamento do que falta e o que já foi baixado |
| "Os papéis estão cada um numa casa" | **Documentos**: laudos, receitas e relatórios num cofre único |
| "Ninguém sabe o que o médico falou" | **Prontuário** por paciente + anotação do atendimento na agenda |
| "Meu irmão não sabia da mudança" | **Mural** da família com avisos, escalas e recados fixados |
| "Quem foi que mexeu na dose?" | **Auditoria**: quem fez o quê e quando, sem poder apagar |
| "A senha do portal está no bloco de notas" | Credenciais **cifradas** dentro do cofre da família |

## Telas

`Painel` · `Agenda` · `Prontuário` · `Medicações` · `Sinais` · `Exames` ·
`Documentos` · `Mural` · `Rede D'Or` · `Equipe` · `Auditoria` · `Ajustes`

---

## Como a proteção funciona

Sem servidor, sem nuvem de terceiros, sem rastreamento. **Tudo acontece no aparelho.**

```
PIN de cada membro ──PBKDF2 (210k)──► chave do PIN
                                        │
                                        ├─ embrulha ─► CHAVE-MESTRA DA FAMÍLIA (32 bytes)
                                        │                     │
                                        │                     ├─HKDF─► chave do cofre  → cifra TODOS os dados
                                        │                     ├─HKDF─► chaves de documento (uma por laudo)
                                        │                     └─HKDF─► chave dos segredos (senhas do portal)
                                        └─ blob guardado no aparelho
```

Pontos que importam de verdade:

- **Cada pessoa tem o próprio PIN; todas abrem o mesmo cofre.** O PIN não cifra os
  dados — ele apenas desembrulha a chave-mestra. Por isso quem tem PIN diferente
  lê exatamente o mesmo conteúdo.
- **O PIN nunca é gravado.** Só o resultado do PBKDF2 com salt aleatório.
- **AES-256-GCM** (cifra autenticada): se alguém alterar um byte do arquivo, a
  leitura **falha** em vez de devolver dado corrompido.
- **Cada dado tem contexto próprio (AAD)**: um laudo não pode ser movido para outro
  paciente, nem o cofre trocado por outro — a operação é rejeitada.
- **A chave-mestra vive só na memória** e é zerada ao sair; 15 minutos de
  inatividade bloqueiam o app.
- **Chave de recuperação** para o caso de todos esquecerem os PINs — mostrada uma
  única vez, para ser anotada em papel.

Detalhes completos em [`docs/seguranca.md`](docs/seguranca.md).

---

## Sincronização entre os 6 aparelhos

Sem servidor obrigatório. O app exporta um **pacote `.teruel`** — um arquivo único,
já cifrado — que pode circular por WhatsApp, e-mail ou Drive sem virar dado de
saúde exposto. Importar em outro aparelho faz **merge campo a campo**: vence o mais
recente e exclusões são respeitadas (tombstone), então ninguém perde anotação nem
"ressuscita" item apagado.

Opcionalmente, é possível apontar um canal HTTP próprio em **Ajustes** para
sincronizar automaticamente (o servidor recebe apenas o blob cifrado).

### Convite para um aparelho novo
1. Gestor: **Ajustes → Gerar convite** (arquivo JSON com o cofre, cifrado).
2. Envie o arquivo **e** o PIN, por canais separados.
3. No aparelho novo: **"Já tenho um convite"** → importar → entrar com o PIN.

---

## Rede D'Or — o que é possível e o que não é

**A Rede D'Or não oferece API pública para pacientes.** O portal oficial
([Área do Paciente](https://www.rededorsaoluiz.com.br/paciente/)) e o app existem,
mas exigem o login do próprio paciente, têm proteção anti-robô e verificação em
duas etapas.

Fazer login automático significaria: burlar essa proteção, guardar a senha do
paciente de forma insegura e descumprir os termos de uso — expondo o acesso dele.
**Este app não faz isso, por decisão de projeto.**

O que ele faz:

1. Reúne os **atalhos oficiais** (portal, app, Dora no WhatsApp, Área do Médico).
2. Guarda as credenciais do portal **cifradas** no cofre, para não ficarem no
   bloco de notas do celular.
3. **Importa os laudos** que o paciente baixa do portal — ficam junto do
   prontuário, disponíveis para toda a família e para o médico.
4. Mantém a lista do que está **aguardando resultado** e o que já foi reunido.

Na prática, a família faz uma conferência semanal de 5 minutos: abre o portal,
baixa o que saiu, importa aqui e marca como reunido.

---

## Rodar localmente

Requer apenas um servidor estático (por causa dos módulos ES e do service worker):

```bash
npm run servir          # python3 -m http.server 8080
# abra http://localhost:8080
```

Também funciona em qualquer hospedagem estática (GitHub Pages, Netlify, Cloudflare
Pages). **Precisa de HTTPS** (ou `localhost`) porque o WebCrypto exige contexto
seguro.

### Instalar no celular
Abra o endereço no navegador → menu → **"Adicionar à tela de início"**. O app
instala como PWA e funciona **offline** — importante em hospital, onde o sinal
costuma falhar na hora da consulta.

---

## Verificação e testes

```bash
npm run verificar       # integridade de imports/exports
npm test                # 180+ asserções (Node + jsdom + WebCrypto real)
```

A suíte cobre: criptografia (chave errada e dado adulterado **devem** falhar),
cofre e papéis, merge/sincronização com exclusões, regras de dose e agenda,
renderização de **todas as telas** em DOM real (inclusive para perfil restrito) e
invariantes de segurança (nada sensível legível no armazenamento).

---

## Estrutura

```
index.html                  ponto de entrada (shell + PWA)
manifest.webmanifest        instalação no celular
sw.js                       service worker (funcionar offline)
assets/
  css/app.css               design system (letras grandes, contraste alto)
  js/
    crypto.js               AES-GCM, PBKDF2, HKDF — o núcleo de segurança
    store.js                modelo de dados, persistência, merge/sincronização
    auth.js                 PIN por membro, papéis, sessão, convites
    ui.js                   componentes, formatação, roteador
    main.js                 fluxo de entrada e inicialização
    views/                  12 telas do app
docs/
  seguranca.md              modelo de segurança e ameaças
  guia-da-familia.md        manual curto para quem vai usar
legacy/
  prontuario-exames.html    prontuário original de exames (preservado)
tools/verificar.mjs         checagem de integridade do código
tests/rodar.mjs             bateria de testes
```

## Papéis

| Papel | Pode |
|---|---|
| **Gestor(a)** | Tudo: equipe, credenciais, auditoria, configurações, exclusões |
| **Editor(a)** | Registra agenda, medicações, sinais, exames, documentos |
| **Cuidador(a)** | Registra doses, sinais, diário e recados |
| **Observador(a)** | Só lê |

---

## Aviso

Este aplicativo **organiza informações** e ajuda a família a se comunicar.
Ele **não substitui avaliação, diagnóstico ou prescrição médica**.
Confira sempre os documentos originais antes de qualquer decisão clínica.
