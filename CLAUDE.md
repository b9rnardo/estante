# Estante: regras para mudanças no app

A Estante roda no navegador (`npm start`), no Mac e no Windows (Electron, `electron/`) e no iPhone e no iPad (Capacitor, `mobile/` e `ios/`). Toda mudança no app segue os três passos abaixo, a menos que o usuário diga outra coisa.

## 1. Aplicar no desktop e no iOS

Onde cada parte vive:

| Parte | Navegador, Mac e Windows | iPhone e iPad |
|---|---|---|
| Interface (estante, leitor, busca) | `public/` | o mesmo `public/`, copiado para `mobile/www/` por `npm run ios` |
| API (`/api/...`) | `server/index.js` | `mobile/server.js`, com as mesmas rotas reescritas |
| Estante em disco | `server/library.js` | `mobile/library.js` (app Arquivos); os dois usam `server/records.js` |
| Fontes, dicionário, HTTP | `server/sources/`, `server/dictionary.js`, `server/http.js` | os mesmos módulos, empacotados por `mobile/build.mjs` |
| Janela, menus, aviso de versão | `electron/main.js`, `electron/preload.cjs` (`window.estante`) | `ios/` e os plugins do Capacitor (`window.Capacitor`) |

- Mudou uma rota em `server/index.js`: mude a mesma em `mobile/server.js`, com a mesma resposta. Vale o mesmo para `server/library.js` e `mobile/library.js`.
- O que muda em `public/` já vai para o iOS. Mesmo assim, confira no iPhone (tela estreita, toque, área segura) e, se mexeu em layout, no iPad.
- Um recurso que depende do Electron precisa de um equivalente no iOS, e vice-versa. Se não fizer sentido numa plataforma, diga ao usuário qual e por quê.
- Mac e Windows dividem `electron/main.js` (a constante `MAC` separa os dois) e `public/js/titlebar.js`. Ao mexer num, não mude o comportamento do outro.
- Exceção: o Library Genesis vem embutido só no desktop. No iOS ele não vem no app (quem quiser adiciona `dist/fontes/libgen.js` em Fontes) e não aparece em nada do repositório público `b9rnardo/estante-ios`: README, source e notas de versão.
- Se a mudança alterar algo que o `README.md` descreve, atualize-o. Se mudar a instalação ou o uso no iPhone, atualize também o README do `b9rnardo/estante-ios`, que é outro repositório (clone numa pasta temporária).

Antes de dizer que está pronto, teste nas duas frentes:

- Desktop: `ESTANTE_DATA=<pasta temporária> PORT=<porta livre> npm start`, ou `npm run app`. Nunca use `data/`, que é a estante de verdade do usuário, nem a porta 4567, e não mexa em `.claude/launch.json`.
- iOS: `npm run ios` e rode no Simulador. Antes, faça backup dos dados do app no simulador; depois, restaure.
- Se não deu para testar uma plataforma, diga qual ficou de fora.

## 2. Subir a versão

A versão de `package.json` é a única do app. Ela vira a versão do .dmg, do .exe, do .ipa e da source do SideStore e do AltStore. Toda mudança que chega a quem usa o app sobe essa versão. Mudanças só em README, documentação ou scripts de build não sobem.

- Correção: patch (0.1.0 → 0.1.1). Recurso novo ou mudança visível: minor (0.1.0 → 0.2.0). Major só se o usuário pedir.
- Comando: `npm version <nova versão> --no-git-tag-version`, que atualiza `package.json` e `package-lock.json`.
- Suba uma vez por versão, não a cada mudança. A última lançada é a que responde `gh release view --repo b9rnardo/estante-ios --json tagName -q .tagName`. Se `package.json` já está acima dela, a versão já subiu e ainda não saiu: não suba de novo, a menos que a mudança peça um nível maior (de patch para minor, por exemplo).
- Nunca mude o identificador do app (`local.estante.app`) nem os repositórios das releases. Quem já instalou deixaria de receber atualizações.

## 3. Perguntar se é para lançar

Com a mudança feita, testada e a versão subida:

1. Escreva as notas da versão em `dist/notas-<versão>.md`: em português, para quem usa o app, em itens curtos. Elas vão para as duas releases, então não citam o Library Genesis.
2. Mostre as notas e pergunte: "Quer lançar a versão X.Y.Z agora? Isso faz commit e push das mudanças e publica as releases do iPhone/iPad e do Mac/Windows."
3. Não lance sem um sim explícito. Se a resposta for não, deixe tudo como está: a próxima mudança entra na mesma versão (veja o passo 2).

Se a resposta for sim:

1. Faça commit de tudo e push para `origin main`. O script recusa mudanças sem commit, e o `gh release create` cria a tag no último commit que está no GitHub.
2. Rode em segundo plano, porque leva vários minutos: `npm run release -- <versão> --notes dist/notas-<versão>.md --publish`. Ele gera o .ipa e a source (iPhone e iPad) e o .dmg e o .exe (Mac e Windows), e cria a release `v<versão>` em `b9rnardo/estante-ios` e em `b9rnardo/estante`.
3. Confira as duas releases com `gh release view v<versão> --repo <repositório>` e mande os links ao usuário. Quem usa o iPhone recebe a atualização no SideStore ou no AltStore (My Apps › Update); no desktop, o app mostra o aviso de versão nova.
