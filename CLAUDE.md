# Regras do projeto

## Tudo precisa de teste e de registro de auditoria

Não é recomendação, é requisito. Vale para toda funcionalidade nova.

**Testes** porque um bug aqui custa dinheiro real: o sistema guarda saldo
de usuários e itens de terceiros em custódia.

**Auditoria** porque, quando alguém disser "sumiu dinheiro da minha
carteira" ou "não recebi meu item", é preciso saber com certeza se foi
falha nossa ou tentativa de golpe. Sem registro, é a palavra de um contra
a do outro sobre valores reais.

### O que auditar

Toda operação sobre **dinheiro, item ou conta** — tanto o que deu certo
quanto o que foi recusado. A recusa importa: uma sequência de tentativas
de cadastrar trade URL de terceiros é um padrão de golpe que só aparece se
as tentativas ficarem gravadas.

Ao registrar uma alteração, guardar **antes e depois**. É o que resolve o
caso de alguém trocar a trade URL e depois alegar não ter recebido o item:
dá para cruzar o horário da troca com o da entrega.

Guardar também o nome do item, não só o assetId — o assetId muda a cada
troca, e daqui a seis meses "AK-47 | Redline" é o que permite reconhecer
do que se está falando.

### Como

```ts
await this.audit.record({
  actorType: AuditActorType.USER,
  actorId: user.id,
  action: AUDIT_ACTIONS.ALGUMA_COISA,
  outcome: AuditOutcome.SUCCESS, // ou DENIED, ou FAILED
  targetType: 'User',
  targetId: user.id,
  metadata: { de: anterior, para: novo },
  context, // ip e user agent, via auditContext(req)
});
```

Para operações que mexem em saldo ou propriedade de item, use
`recordInTransaction` dentro da mesma transação de banco: ali o registro
precisa existir se e somente se a operação existir. Operação de dinheiro
sem rastro é pior que operação não realizada.

`record` engole erro de propósito — auditoria falhando não pode impedir
alguém de entrar no site. `recordInTransaction` propaga.

### Log de aplicação é outra coisa

`AuditLog` responde "o que aconteceu?" meses depois e **não pode ser
alterado** (há trigger no Postgres impedindo UPDATE e DELETE). O logger do
Nest serve para depurar problema técnico e some no próximo restart.

Os dois são necessários e não se substituem.

## Convenções

- Comentários e mensagens ao usuário em português.
- Mensagem de erro diz o que fazer, não só o que falhou.
- CHECK constraints são escritos à mão nas migrations — o Prisma não os
  gera. Se um bloco desses sumir, foi apagado por engano.
- Nada de credencial no banco: `Bot.credentialRef` aponta para o cofre.

## Antes de dar algo por pronto

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

E verificar de verdade quando for integração externa — build passando não
prova que a Steam aceita a requisição.
