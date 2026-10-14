# Modelo de segurança — Canal Teruel

Documento técnico. Explica **o que** está protegido, **contra o quê**, e
principalmente **o que este app não protege** — para a família não confiar em algo
que ele não faz.

## 1. Princípio geral

Não existe servidor nosso. Não existe conta na nuvem. Não existe rastreamento.

Todo o processamento — inclusive a criptografia — acontece **no aparelho de quem usa**.
Nada de dado de saúde sai do dispositivo a menos que a família exporte
deliberadamente um pacote cifrado.

## 2. Hierarquia de chaves

```
                 PIN do membro  (nunca gravado)
                       │
              PBKDF2-SHA256, 210.000 iterações, salt aleatório de 16 bytes
                       │
                 chave do PIN  (256 bits)
                       │
                 ┌─────┴──────────────────────────────┐
                 │                                     │
     embrulha (AES-GCM + AAD "membro:<id>")      não cifra dado nenhum
                 │
                 ▼
     CHAVE-MESTRA DA FAMÍLIA  (32 bytes aleatórios)   ← o segredo de verdade
                 │
       ┌─────────┼──────────────┬──────────────────────┐
       │         │              │                      │
   HKDF"vault"  HKDF "doc:<id>"  HKDF "segredos"   HKDF "pacote"
       │         │              │                      │
   cofre inteiro  cada laudo    senhas do portal    pacote de sync
```

### Por que a chave-mestra existe (e não usamos o PIN direto)

Se o PIN cifrasse os dados, **só quem criou o cofre conseguiria ler** — os outros
membros têm PINs diferentes e cairiam em chaves diferentes. Derivando a chave do
cofre da **chave-mestra**, todos os membros (que desembrulham a *mesma*
chave-mestra) chegam exatamente à mesma chave e leem o mesmo conteúdo.

É isso que permite: **PIN individual por pessoa + dados compartilhados**.

## 3. Algoritmos

| Uso | Algoritmo | Parâmetros |
|---|---|---|
| Derivação de chave do PIN | PBKDF2-HMAC-SHA256 | 210.000 iterações, salt 16 B |
| Cifra de dados | AES-256-GCM | nonce 96 bits, tag 128 bits |
| Derivação de subchaves | HKDF-SHA256 | `info` distinta por contexto |
| Impressão digital do cofre | SHA-256 | 8 bytes em hexadecimal legível |
| Aleatoriedade | `crypto.getRandomValues` | CSPRNG do sistema |

Custo do PBKDF2: 210.000 iterações é alto de propósito (~100 ms em celular médio).
Atrasa um ataque de força bruta sobre um PIN numérico em ordens de magnitude.
Consequência: PIN de 6 dígitos continua sendo o elo mais fraco — por isso a
criptografia **não** é a única defesa (veja §7).

## 4. Autenticação com dados associados (AAD)

Cada operação amarra um **contexto** à cifra:

| Operação | AAD |
|---|---|
| Cofre inteiro | `teruel:v1:estado` |
| Embrulho da chave-mestra | `teruel:v1:membro:<id>` |
| Documento | `teruel:v1:doc:<id>` |
| Segredo (senha do portal) | `teruel:v1:segredo` |
| Pacote de sincronização | `teruel:v1:pacote` |

Efeito prático: um blob válido **não pode ser reutilizado fora do seu lugar**. O
pacote de uma família não abre em outra; o laudo de um paciente não se move para
outro; o embrulho de um membro não funciona no registro de outro. Sem AAD, um
atacante com acesso de escrita ao armazenamento poderia trocar arquivos entre
posições.

## 5. O que fica gravado onde

| Local | Conteúdo | Legível sem PIN? |
|---|---|---|
| `localStorage['teruel.cofre']` | metadados + salt e blob de cada membro | Não (só nomes/papéis são claros) |
| `localStorage['teruel.dados']` | **todo** o prontuário, cifrado | Não |
| IndexedDB `teruel/docs` | PDFs e imagens, cada um cifrado | Não |
| Memória (RAM) | chave-mestra e chave do cofre | Sim — e só enquanto desbloqueado |

Nenhum dado sensível é gravado em texto claro. Há teste automatizado que falha se
alguém introduzir essa regressão (ver `tests/rodar.mjs`, seção 6).

## 6. Ciclo de vida da sessão

- **Desbloqueio:** PIN → PBKDF2 → desembrulha a chave-mestra → deriva a chave do cofre.
- **Em uso:** chave-mestra só na memória, nunca serializada.
- **Bloqueio automático:** 15 minutos sem interação.
- **Ao sair:** `fill(0)` apaga os bytes da chave na memória antes de soltar a
  referência (reduz a janela em que restos da chave poderiam ser lidos por
  despejo de memória).
- **Falha de leitura:** se a chave abre mas os dados não decifram, a sessão é
  encerrada em vez de continuar num estado inconsistente.

## 7. Modelo de ameaças — o que é e o que não é protegido

### Protegido

| Ameaça | Defesa |
|---|---|
| Celular perdido/roubado | Dados cifrados; sem PIN são ilegíveis |
| Outro app lendo arquivos do dispositivo | Conteúdo cifrado no armazenamento |
| Interceptação do pacote de sincronização | Pacote é cifrado antes de sair |
| Servidor de sincronização (se usado) | Só recebe blob cifrado; não tem a chave |
| Adulteração de arquivo | AES-GCM rejeita (autenticado) |
| Troca de blobs entre contextos | AAD por operação |
| Ex-funcionário/cuidador desligado | Revogar acesso remove o embrulho daquele membro |
| Repúdio ("não fui eu") | Auditoria registra autor, ação e horário |
| XSS por dado digitado | Toda saída passa por `esc()` antes de virar HTML |

### NÃO protegido — a família precisa saber

| Limite | Consequência |
|---|---|
| **Aparelho comprometido enquanto desbloqueado** | Malware com acesso à memória poderia ler dados. Criptografia em repouso não protege contra isso. |
| **PIN fraco** | 6 dígitos numéricos resistem a ataque remoto, mas não a alguém com o arquivo e paciência. Prefira PIN longo ou alfanumérico. |
| **Chave de recuperação vazada** | Ela abre o cofre inteiro. Guarde em papel, em local físico, nunca no celular. |
| **Alguém que já foi membro e guardou um pacote antigo** | Continua conseguindo abrir aquele pacote. Ao remover alguém, considere migrar o cofre (novo cofre + novo convite). |
| **Quem vê a tela por cima do ombro** | Nenhuma criptografia resolve. Use o bloqueio automático. |
| **Perda de todos os PINs e da chave de recuperação** | Dados irrecuperáveis. Não existe backdoor — por projeto. |

## 8. Gestão de acesso

Cada membro tem PIN próprio e um papel:

| Papel | Permissões |
|---|---|
| `admin` (Gestor) | ver, escrever, gerir equipe, gerir credenciais, gerir config, excluir, ver auditoria, sincronizar |
| `editor` | ver, escrever, ver auditoria, sincronizar |
| `cuidador` | ver, escrever |
| `leitor` | ver |

Regras defensivas implementadas:

- Não é possível remover ou desativar o **próprio** acesso.
- O canal não pode ficar sem gestor ativo.
- Permissão negada lança erro explícito — a interface esconde a ação, mas a
  verificação **também** acontece na camada de dados (defesa em profundidade:
  esconder botão não é controle de acesso).

## 9. Auditoria

Toda ação relevante grava: **quem**, **o quê**, **quando**, **de qual paciente**.
A coleção tem teto de 1.500 registros, e o merge entre aparelhos **só adiciona** —
nunca remove. Nem o gestor apaga auditoria pela interface.

Isso cumpre a rastreabilidade de tratamento de dado sensível de saúde e resolve o
problema prático de seis pessoas cuidando dos mesmos dois idosos.

## 10. Rede D'Or — decisão de projeto

O portal do paciente da Rede D'Or não expõe API pública e exige login do paciente
com anti-robô e dupla verificação.

**Este app não automatiza login.** Automatizar exigiria burlar a proteção do
convênio, reter a senha do paciente de forma insegura e violar os termos de uso —
expondo o acesso dele e, em última análise, o próprio paciente.

O que o app faz: guarda as credenciais **cifradas** (para não ficarem no bloco de
notas), reúne os atalhos oficiais e **importa os laudos** que o paciente baixa do
portal. O resultado prático para a família é o mesmo — acervo único, atualizado e
seguro — sem ninguém precisar confiar a senha a um robô.

## 10b. Amil — mesma decisão, com importação em lote

Vale o mesmo raciocínio da Rede D'Or. O que muda é o esforço de alimentar o painel:

| Camada | Como funciona |
|---|---|
| Reconhecimento e extração | `assets/js/ingest.js` lê os documentos **no aparelho**, sem rede |
| Conciliação | compara por data+procedimento+valor e por número/senha de guia — **não duplica** |
| Arquivo | o original entra cifrado em Documentos, com a chave própria do documento |
| Coletor (`tools/coletor.mjs`) | roda **no computador da família**; a sessão fica numa pasta local; **nenhuma senha é gravada** nem enviada a servidor |

Barreiras que impedem login automático **dentro do app** (técnicas, não de estilo):
**CORS** (o navegador proíbe a leitura cross-origin), **ausência de servidor**
(não há onde manter sessão), e **verificação em duas etapas** (exige uma pessoa).
O Portal do Desenvolvedor do Grupo Amil é B2B (ID e segredo de parceiro habilitado);
não há API pública para pessoa física.

Consequência de segurança: o app **nunca** guarda a senha em texto claro nem a
transmite. O login, quando existe, é do coletor, na máquina do usuário, e o dado
que circula é o arquivo que a própria família gerou.

## 11. Verificação

```bash
npm run verificar   # integridade de imports/exports
npm test            # 183 asserções
```

A suíte **prova** o modelo, não apenas o descreve:

- PIN errado **não** abre a chave-mestra.
- Blob de um membro **não** abre no registro de outro.
- Dado adulterado **é detectado**.
- Pacote de outro cofre **não** abre.
- Nada sensível aparece em claro no armazenamento.
- `sair()` zera a chave na memória.
- Sem chave, não é possível gravar nem decifrar.

## 12. Recuperação

1. **Esqueceu o PIN:** o gestor redefine pelo painel Equipe; a pessoa troca no
   primeiro acesso.
2. **Todos esqueceram:** usar a chave de recuperação (papel físico).
3. **Cofre corrompido:** restaurar o último pacote/backup exportado.
4. **Perdeu o aparelho:** os outros aparelhos continuam; entre em um deles e
   revogue o membro afetado.

## 13. Recomendações práticas

1. **PIN único por pessoa.** Nunca compartilhado.
2. **Chave de recuperação em papel**, em local físico, longe do celular.
3. **PIN e pacote de sincronização por canais separados** (ex.: PIN por telefone,
   arquivo por e-mail).
4. **Revogar acesso ao trocar de cuidador**, e considerar migrar o cofre.
5. **Bloqueio automático ativo** (já é o padrão).
6. **Um backup por mês**, guardado em local diferente do aparelho de uso.
7. **Aparelhos com tela bloqueada** e sistema atualizado.
