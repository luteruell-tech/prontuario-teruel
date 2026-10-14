/* ============================================================================
 * Tela · Equipe  (assets/js/views/equipe.js)
 * ----------------------------------------------------------------------------
 * Quem tem acesso ao canal, com qual papel, e como dar/retirar acesso.
 * Só o gestor vê esta tela. Adicionar um membro cria uma caixa cifrada da
 * chave-mestra só para ele — ninguém precisa compartilhar senha.
 * ==========================================================================*/

'use strict';

import { sessao, estado, auditar, salvar } from '../store.js';
import {
  PAPEIS, pode, exigir, adicionarMembro, alterarPapel, ativarMembro,
  removerMembro, redefinirPinDe, equipe as lerEquipe,
} from '../auth.js';
import {
  esc, $, modal, confirmar, toast, vazio, fmtDataHora, relativo,
  campoTexto, campoSelect, campoArea, irPara,
} from '../ui.js';
import { suggestPin, pinStrength } from '../crypto.js';

export function render(host) {
  if (!pode('gerirEquipe')) {
    host.innerHTML = '<div class="wrap">' + vazio('🔒', 'Área do gestor',
      'Apenas quem tem o papel de Gestor(a) pode administrar a equipe do canal.') + '</div>';
    return;
  }

  const membros = lerEquipe();
  const ativos = membros.filter((m) => m.ativo !== false);

  host.innerHTML = '<div class="wrap stack">'
    + '<div class="row-between">'
    +   '<div><h1>Equipe</h1><p class="muted small">' + ativos.length + ' de ' + membros.length + ' acessos ativos</p></div>'
    +   '<button class="btn btn-primary" id="btn-add">＋ Membro</button>'
    + '</div>'

    + '<div class="note"><div class="note-title">🔑 Como o acesso funciona</div>'
    + 'Cada pessoa tem o <b>próprio PIN</b>, e todos abrem o <b>mesmo cofre</b>: o PIN de cada um '
    + 'desembrulha a chave-mestra da família. Ninguém precisa saber a senha de ninguém — '
    + 'e retirar o acesso de alguém é apagar o embrulho daquele membro.</div>'

    + '<div class="section-title">Acessos</div>'
    + '<div class="stack" style="gap:9px">' + membros.map(cartaoMembro).join('') + '</div>'

    + '<div class="section-title">Papéis e permissões</div>'
    + '<div class="card"><div class="table-wrap"><table class="table">'
    + '<thead><tr><th>Papel</th><th>Pode fazer</th></tr></thead><tbody>'
    + Object.entries(PAPEIS).map(([k, p]) => '<tr>'
      + '<td><span class="pill brand" style="border-color:' + p.cor + ';color:' + p.cor + '">' + esc(p.nome) + '</span></td>'
      + '<td class="small">' + esc(p.desc) + '</td></tr>').join('')
    + '</tbody></table></div></div>'

    + '<div class="section-title">Segurança do canal</div>'
    + '<div class="card card-pad stack" style="gap:11px">'
    +   '<div class="row-between"><span class="small muted">Identificador do cofre</span>'
    +     '<span class="mono strong small">' + esc(sessao.fingerprint || '—') + '</span></div>'
    +   '<div class="row-between"><span class="small muted">Você está como</span>'
    +     '<span class="strong small">' + esc(sessao.membro.nome + ' · ' + (PAPEIS[sessao.membro.papel] || {}).nome) + '</span></div>'
    +   '<div class="note warn" style="margin:0"><div class="note-title">Boas práticas</div>'
    +     'Use <b>PIN único por pessoa</b> (nunca compartilhado), troque quando alguém sair do círculo '
    +     'e nunca envie o PIN pelo mesmo canal do pacote de sincronização.</div>'
    +   '<button class="btn btn-soft btn-sm" data-acao="ir-ajustes">🔧 Ir para Ajustes e sincronização</button>'
    + '</div>'
    + '</div>';

  host.addEventListener('click', (ev) => {
    const ac = ev.target.closest('[data-acao]');
    if (ac) {
      const id = ac.dataset.id;
      const a = ac.dataset.acao;
      if (a === 'papel') trocarPapel(id, host);
      else if (a === 'ativar') alternarAtivo(id, host);
      else if (a === 'remover') remover(id, host);
      else if (a === 'pin') redefinirPin(id, host);
      else if (a === 'ir-ajustes') irPara('ajustes');
      return;
    }
    if (ev.target.closest('#btn-add')) abrirNovoMembro(host);
  });
}

function cartaoMembro(m) {
  const papel = PAPEIS[m.papel] || PAPEIS.leitor;
  const eu = m.id === sessao.membro.id;
  const inativo = m.ativo === false;
  return '<div class="item" style="' + (inativo ? 'opacity:.6;' : '') + 'border-left:4px solid ' + (inativo ? 'var(--ink-4)' : papel.cor) + '">'
    + '<div class="avatar" style="background:' + esc(m.cor || 'var(--brand)') + '">' + (m.avatarEmoji || '🙂') + '</div>'
    + '<div class="item-main">'
    +   '<div class="item-title">' + esc(m.nome) + (eu ? ' <span class="pill brand">você</span>' : '')
    +     (inativo ? ' <span class="pill">desativado</span>' : '') + '</div>'
    +   '<div class="item-meta">'
    +     '<span class="pill" style="color:' + papel.cor + ';border-color:' + papel.cor + '">' + esc(papel.nome) + '</span>'
    +     '<span>' + esc(m.ultimoAcesso ? 'último acesso ' + relativo(m.ultimoAcesso) : 'nunca acessou') + '</span>'
    +     (m.precisaTrocarPin ? '<span class="pill warn">trocar PIN</span>' : '')
    +   '</div>'
    +   (m.observacao ? '<div class="item-text small">' + esc(m.observacao) + '</div>' : '')
    +   '<div class="item-actions">'
    +     (!eu ? '<button class="btn btn-sm btn-ghost" data-acao="papel" data-id="' + esc(m.id) + '">Mudar papel</button>' : '')
    +     (!eu ? '<button class="btn btn-sm btn-ghost" data-acao="pin" data-id="' + esc(m.id) + '">Redefinir PIN</button>' : '')
    +     (!eu ? '<button class="btn btn-sm btn-ghost" data-acao="ativar" data-id="' + esc(m.id) + '">'
        + (inativo ? 'Reativar' : 'Desativar') + '</button>' : '')
    +     (!eu ? '<button class="btn btn-sm btn-danger-soft" data-acao="remover" data-id="' + esc(m.id) + '">Remover</button>' : '')
    +     (eu ? '<span class="tiny muted">Seu próprio acesso é gerido em Ajustes.</span>' : '')
    +   '</div>'
    + '</div></div>';
}

/* ------------------------------------------------------------------- ações */

async function abrirNovoMembro(host) {
  const sugestao = suggestPin(6);
  const r = await modal({
    titulo: 'Adicionar membro',
    corpo: '<div class="stack">'
      + '<div class="note info"><div class="note-title">Como combinar o acesso</div>'
      + 'Crie o PIN aqui, escreva num papel e entregue <b>em mãos</b> para a pessoa. '
      + 'Na primeira vez, ela pode trocar por um PIN só dela.</div>'
      + campoTexto({ id: 'f-nome', label: 'Nome', obrigatorio: true, placeholder: 'Ex.: Ana (filha), Célia (cuidadora)' })
      + campoSelect({ id: 'f-papel', label: 'Papel', valor: 'editor', vazio: null,
          opcoes: Object.entries(PAPEIS).map(([k, p]) => ({ valor: k, texto: p.nome + ' — ' + p.desc.slice(0, 48) + '…' })) })
      + '<div class="grid grid-2" style="gap:12px">'
      + campoTexto({ id: 'f-avatarEmoji', label: 'Emoji', valor: '🙂', placeholder: '🙂' })
      + campoTexto({ id: 'f-cor', label: 'Cor', valor: '#1540C4', tipo: 'color' })
      + '</div>'
      + campoTexto({ id: 'f-pin', label: 'PIN inicial', valor: sugestao, obrigatorio: true, dica: 'Sugerimos um PIN aleatório — mais seguro que data de nascimento.' })
      + campoArea({ id: 'f-observacao', label: 'Observação (opcional)', linhas: 2, placeholder: 'Ex.: cuidadora de segunda a sexta, manhã' })
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Criar acesso', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  const d = r.dados;
  if (!d.nome || !d.pin) return toast('Informe nome e PIN.', 'warn');

  try {
    await adicionarMembro(d);
    await salvar(true);
    await modal({
      titulo: 'Acesso criado',
      corpo: '<div class="stack">'
        + '<div class="note ok"><div class="note-title">Anote e entregue em mãos</div>'
        + '<b>' + esc(d.nome) + '</b><br>PIN: <span class="mono" style="font-size:1.3rem;font-weight:800">' + esc(d.pin) + '</span></div>'
        + '<p class="small muted">Esta é a única vez que o PIN aparece na tela. Depois de fechar, não é possível recuperá-lo — '
        + 'só redefinir para outro.</p>'
        + '<p class="small muted">Para a pessoa entrar no canal pelo celular dela: mande o <b>arquivo de convite</b> '
        + '(Ajustes → Sincronizar) e este PIN. O convite não contém dados legíveis sem o PIN.</p>'
        + '</div>',
      acoes: [{ texto: 'Entendi', valor: true, tipo: 'primary' }],
    });
    toast('Membro adicionado.', 'ok');
    render(host);
  } catch (e) { toast(e.message, 'danger'); }
}

async function trocarPapel(id, host) {
  const membros = lerEquipe();
  const m = membros.find((x) => x.id === id);
  if (!m) return;
  const r = await modal({
    titulo: 'Mudar papel de ' + m.nome,
    corpo: '<div class="stack">'
      + campoSelect({ id: 'f-papel', label: 'Novo papel', valor: m.papel, vazio: null,
          opcoes: Object.entries(PAPEIS).map(([k, p]) => ({ valor: k, texto: p.nome + ' — ' + p.desc })) })
      + '<div class="note warn"><div class="note-title">Efeito imediato</div>'
      + 'A mudança vale no próximo acesso da pessoa ao canal.</div></div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Aplicar', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados) return;
  try { alterarPapel(id, r.dados.papel); toast('Papel atualizado.', 'ok'); render(host); }
  catch (e) { toast(e.message, 'danger'); }
}

async function alternarAtivo(id, host) {
  const m = lerEquipe().find((x) => x.id === id);
  if (!m) return;
  const inativo = m.ativo === false;
  if (!inativo && !await confirmar('Desativar acesso?',
    m.nome + ' deixará de entrar no canal. O histórico dos registros feitos por essa pessoa é preservado.', 'Desativar')) return;
  try { ativarMembro(id, inativo); toast(inativo ? 'Acesso reativado.' : 'Acesso desativado.', 'ok'); render(host); }
  catch (e) { toast(e.message, 'danger'); }
}

async function remover(id, host) {
  const m = lerEquipe().find((x) => x.id === id);
  if (!m) return;
  if (!await confirmar('Remover ' + m.nome + '?',
    'O acesso será apagado. Registros antigos continuam com o nome dela. '
    + 'Se a pessoa ainda tiver o pacote de sincronização antigo, ela consegue abrir os dados — '
    + 'por isso, ao remover alguém, considere trocar o PIN do canal.', 'Remover definitivamente')) return;
  try { removerMembro(id); toast('Acesso removido.'); render(host); }
  catch (e) { toast(e.message, 'danger'); }
}

async function redefinirPin(id, host) {
  const m = lerEquipe().find((x) => x.id === id);
  if (!m) return;
  const novo = suggestPin(6);
  const r = await modal({
    titulo: 'Redefinir PIN de ' + m.nome,
    corpo: '<div class="stack">'
      + campoTexto({ id: 'f-pin', label: 'Novo PIN', valor: novo, obrigatorio: true })
      + '<div class="note warn"><div class="note-title">Entrega pessoal</div>'
      + 'Entregue o novo PIN em mãos. Ao entrar, o app pedirá que ' + esc(m.nome) + ' troque por um PIN só dela.</div>'
      + '</div>',
    acoes: [{ texto: 'Cancelar', valor: null, tipo: 'ghost' }, { texto: 'Redefinir', valor: 'FORM', tipo: 'primary' }],
  });
  if (!r || !r.dados || !r.dados.pin) return;
  try {
    await redefinirPinDe(id, r.dados.pin);
    toast('PIN redefinido: ' + r.dados.pin, 'ok', 8000);
    render(host);
  } catch (e) { toast(e.message, 'danger'); }
}
