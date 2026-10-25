<p align="center">
  <img src="build/icon.png" width="112" alt="">
</p>

<h1 align="center">Estante</h1>

<p align="center">
  Leitor de e-books minimalista. Busca EPUBs e PDFs em acervos abertos, guarda os
  livros numa estante local e abre num leitor limpo, que lembra onde você parou.
</p>

<p align="center">
  <b>Mac</b> · <b>Windows</b> · <b>iPhone e iPad</b> · <b>navegador</b>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/estante-escuro.webp">
  <img src="docs/images/estante.webp" alt="A estante no Mac: o livro em andamento no topo, filtros, coleções e as capas dos livros">
</picture>

## Sumário

- [O que ela faz](#o-que-ela-faz)
- [Instalar e rodar](#instalar-e-rodar): [navegador](#no-navegador), [Mac](#app-para-mac), [Windows](#app-para-windows), [iPhone e iPad](#app-para-iphone-e-ipad)
- [Buscar livros](#buscar-livros)
- [Organizar a estante](#organizar-a-estante)
- [Ler](#ler): [aparência](#aparência), [marcadores, destaques e notas](#marcadores-destaques-e-notas), [dicionário](#dicionário), [busca no livro](#busca-no-livro), [PDF](#pdf)
- [Atalhos de teclado](#atalhos-de-teclado)
- [Ler no celular pela rede](#ler-no-celular-pela-rede)
- [Onde ficam os dados](#onde-ficam-os-dados)
- [Problemas comuns](#problemas-comuns)
- [Desenvolvimento](#desenvolvimento)

## O que ela faz

- **Busca em acervos abertos.** Project Gutenberg, Standard Ebooks, Internet Archive,
  arXiv, Archive of Our Own e Syosetu numa busca só, além de qualquer catálogo OPDS
  (Calibre, Calibre-Web, Kavita, Komga, COPS…).
- **Estante local.** Os livros ficam numa pasta sua, com progresso de leitura,
  filtros, coleções e título, autores e capa editáveis. Sem conta e sem nuvem.
- **Leitor de EPUB e PDF.** Temas claro, sépia e escuro, tamanho e fonte do texto e,
  em telas largas, duas páginas lado a lado.
- **Destaques em quatro cores, notas e marcadores**, reunidos num painel e
  exportáveis em Markdown.
- **Dicionário**: selecione uma palavra e veja a definição do Wikcionário.
- **Busca no livro**, que ignora acentos e mostra o trecho em volta de cada resultado.
- **Roda onde você lê**: no navegador, como app para Mac e Windows, e no iPhone e no
  iPad sem precisar de computador.

## Instalar e rodar

### No navegador

```bash
npm install
npm start
```

Abra http://localhost:4567. Requer Node 20.11 ou mais novo.

### App para Mac

A Estante também roda como programa de Mac, com janela própria e ícone no Dock.
Por dentro é o mesmo servidor, só que rodando dentro do app.

```bash
npm install
npm run app    # abre a janela direto do código
npm run dist   # gera o instalador em dist/Estante-<versão>-<arquitetura>.dmg
```

Abra o `.dmg` e arraste a Estante para Aplicativos. O instalador sai para o
processador do Mac que o gerou (Apple Silicon ou Intel).

**Dados.** O app guarda a estante em `~/Library/Application Support/Estante/data`,
separada da versão web (`ESTANTE_DATA` continua valendo). Para levar a estante que
você já tem, feche o app e, na pasta do projeto, copie `data/`:

```bash
mkdir -p ~/Library/Application\ Support/Estante
cp -R data ~/Library/Application\ Support/Estante/
```

A cópia substitui a estante do app, então faça isso antes de adicionar livros nele.
As fontes ligadas em **Fontes** e as preferências do leitor ficam na janela, não
em `data/`: escolha de novo no app.

**Primeira abertura.** O app não é assinado por um desenvolvedor registrado na
Apple. Gerado no próprio Mac, ele abre direto. Vindo de outro Mac (download,
AirDrop), o macOS bloqueia na primeira vez: clique com o botão direito na Estante
em Aplicativos e escolha **Abrir**. Se o macOS não oferecer essa opção, vá em
**Ajustes do Sistema › Privacidade e Segurança** e clique em **Abrir Mesmo Assim**.

O app só aceita conexões do próprio Mac. Para ler no celular pelo navegador, use
`npm start` (veja [Ler no celular pela rede](#ler-no-celular-pela-rede)).

### App para Windows

O mesmo app roda no Windows. Os botões de minimizar, maximizar e fechar ficam no
canto direito da barra, nas cores da tela por baixo: claro ou escuro, como o
Windows, e o tema do leitor (claro, sépia ou escuro) com um livro aberto.

```bash
npm install
npm run app        # abre a janela direto do código
npm run dist:win   # gera o instalador em "dist/Estante Setup <versão>.exe" (64 bits)
```

O instalador pode ser gerado no próprio Windows ou num Mac; da primeira vez o
`electron-builder` baixa o Electron para Windows e o NSIS. Dê dois cliques no
`.exe`: ele instala só para o seu usuário (sem pedir senha de administrador), cria
atalhos no menu Iniciar e na área de trabalho e abre a Estante.

**Primeira abertura.** O instalador não é assinado, então o SmartScreen avisa que
"O Windows protegeu o computador". Clique em **Mais informações** e depois em
**Executar assim mesmo**. O aviso só aparece na primeira vez.

**Dados.** A estante fica em `%APPDATA%\Estante\data`, separada da versão web
(`ESTANTE_DATA` continua valendo). Para levar a estante que você já tem, feche o
app e, na pasta do projeto, rode no PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\Estante\data" | Out-Null
Copy-Item -Recurse -Force data\* "$env:APPDATA\Estante\data"
```

Como no Mac, a cópia substitui a estante do app, e as fontes ligadas e as
preferências do leitor precisam ser escolhidas de novo. Desinstalar a Estante (em
**Configurações › Aplicativos**) remove o programa e mantém essa pasta.

Também aqui o app só aceita conexões do próprio computador, então o Firewall do
Windows não pede permissão.

### App para iPhone e iPad

<table>
  <tr>
    <td align="center"><img src="docs/images/iphone-estante.webp" width="240" alt="A estante no iPhone"><br>Estante</td>
    <td align="center"><img src="docs/images/iphone-leitor.webp" width="240" alt="O leitor no iPhone, com destaques"><br>Leitor</td>
    <td align="center"><img src="docs/images/iphone-selecao.webp" width="240" alt="Texto selecionado e a barra da Estante no pé da tela"><br>Seleção de texto</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/iphone-busca.webp" width="240" alt="Resultados da busca no iPhone"><br>Busca</td>
    <td align="center"><img src="docs/images/iphone-dicionario.webp" width="240" alt="Cartão do dicionário com a definição de mascate"><br>Dicionário</td>
    <td align="center"><img src="docs/images/iphone-notas.webp" width="240" alt="Painel de notas com os destaques do livro"><br>Notas</td>
  </tr>
</table>

No iPhone e no iPad a Estante roda sozinha, sem computador: busca, downloads,
estante e leitor ficam no aparelho.

**Só quero instalar.** A versão pronta está em
[b9rnardo/estante-ios](https://github.com/b9rnardo/estante-ios), com o passo a passo
completo para quem nunca usou o SideStore ou o AltStore. Em resumo:

1. Instale o [SideStore](https://sidestore.io) (com o iloader, no computador) ou o
   [AltStore](https://altstore.io) (com o AltServer).
2. Na aba **Sources**, toque em **+** e cole
   `https://github.com/b9rnardo/estante-ios/releases/latest/download/source.json`.
3. Em **Browse**, abra a Estante e instale.

O app é assinado com o seu Apple ID. Com um Apple ID gratuito a assinatura vale 7
dias e precisa ser renovada no SideStore ou no AltStore (**My Apps › Refresh All**).

**Gerar o app.** Pede um Mac com Xcode.

```bash
npm install
npm run ios        # prepara o app (mobile/www) e o projeto do Xcode em ios/
npx cap open ios   # abre no Xcode, para rodar no simulador ou no seu aparelho
npm run ipa        # gera dist/Estante-<versão>.ipa, sem assinatura
```

**Instalar o .ipa com AltStore ou SideStore.** Passe o `.ipa` para o aparelho
(AirDrop, iCloud Drive, app Arquivos), abra o AltStore ou o SideStore e, em **Meus
apps**, toque em **+** e escolha o arquivo. O app é assinado com o seu Apple ID na
instalação. Com um Apple ID gratuito a assinatura vale 7 dias, e o AltStore (com o
AltServer rodando no computador, na mesma rede) ou o SideStore a renovam antes de
vencer. Outra opção é rodar pelo Xcode direto no aparelho, escolhendo o seu Apple ID
em **Signing & Capabilities**.

**Publicar uma source.** Uma source deixa o AltStore e o SideStore instalarem a
Estante e avisarem das versões novas. `npm run source -- <dono>/<repositório>` (depois
do `npm run ipa`) gera em `dist/altstore/` o `source.json`, o ícone e o `.ipa`. Anexe
os três a uma release `v<versão>` desse repositório no GitHub (ele precisa ser
público: num privado, o AltStore não consegue baixar os arquivos). No aparelho, na
aba **Sources**, toque em **+** e cole
`https://github.com/<dono>/<repositório>/releases/latest/download/source.json`. A
Estante aparece em **Browse**. A assinatura continua sendo a do seu Apple ID, com a
mesma renovação a cada 7 dias. Sources não funcionam no AltStore PAL (o da União
Europeia), que só aceita apps autenticados pela Apple.

**Dados.** A estante fica no app **Arquivos**, em **No Meu iPhone › Estante ›
data** (no iPad, **No Meu iPad**), com os mesmos arquivos de `data/`. Para levar a
estante do computador, feche a Estante no aparelho e copie o conteúdo de `data/`
para essa pasta: pelo Finder (aparelho conectado, aba **Arquivos**, arraste para
**Estante**) ou pelo app Arquivos. A cópia substitui a estante do app. Como no Mac,
as fontes ligadas e as preferências do leitor são escolhidas de novo no app.

**Fontes.** As mesmas do computador, menos o Library Genesis, que não vem no app.
Quem quiser pode adicioná-lo: `npm run ios` também gera `dist/fontes/libgen.js`.
Em **Fontes › Adicionar fonte**, cole um link para esse arquivo ou toque em
**Importar arquivo…** e escolha-o no app Arquivos. Guarde o arquivo para você, sem
publicá-lo. Uma fonte adicionada roda isolada: só busca na internet e devolve
resultados, sem acesso à estante, às notas ou às preferências. A lixeira ao lado
dela a remove.

<table>
  <tr>
    <td align="center"><img src="docs/images/iphone-fontes.webp" width="240" alt="Lista de fontes no iPhone"><br>Fontes</td>
    <td align="center"><img src="docs/images/iphone-adicionar-fonte.webp" width="240" alt="Campos para adicionar um catálogo OPDS ou uma fonte por link ou arquivo"><br>Adicionar catálogo ou fonte</td>
    <td align="center"><img src="docs/images/iphone-estante-escuro.webp" width="240" alt="A estante no iPhone em modo escuro"><br>Modo escuro</td>
  </tr>
</table>

**Diferenças.**

- O iOS suspende apps em segundo plano, então downloads longos (como os do
  Syosetu) só andam com a Estante aberta na tela.
- **+** abre o app Arquivos para importar EPUB e PDF.
- **Exportar** notas abre o menu de compartilhar (Salvar em Arquivos, AirDrop,
  Notas…).
- Ao selecionar texto, a barra da Estante (cores, nota, dicionário, copiar, buscar)
  aparece no pé da tela, longe do menu do sistema.
- Deslize para os lados para virar a página e toque no meio do texto para mostrar
  ou esconder as barras.

No iPad, a estante mostra mais capas por linha e o leitor aproveita a tela inteira:

<table>
  <tr>
    <td align="center"><img src="docs/images/ipad-estante.webp" width="260" alt="A estante no iPad"><br>Estante</td>
    <td align="center"><img src="docs/images/ipad-leitor.webp" width="260" alt="O leitor no iPad, com destaques em quatro cores"><br>Leitor</td>
    <td align="center"><img src="docs/images/ipad-escuro.webp" width="260" alt="O leitor no iPad no tema escuro, com o painel de aparência aberto"><br>Tema escuro</td>
  </tr>
</table>

## Buscar livros

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/busca-escuro.webp">
  <img src="docs/images/busca.webp" alt="Resultados da busca por Machado de Assis, agrupados por fonte">
</picture>

Digite no campo do topo e tecle Enter. A busca **Todas** consulta ao mesmo tempo as
fontes ligadas e agrupa os resultados por fonte; os botões logo abaixo mostram uma
fonte só, e **Ver todos** traz mais resultados dela. Em cada livro, o botão do
formato (**EPUB**, **PDF**) baixa para a estante. Livros que já estão nela mostram
**Ler**.

### Fontes embutidas

| Fonte | O que tem | Formato |
| --- | --- | --- |
| Project Gutenberg | ~75 mil livros em domínio público | EPUB |
| Standard Ebooks | clássicos em domínio público, edição caprichada | EPUB |
| Internet Archive | livros digitalizados de acesso livre (itens de empréstimo com DRM ficam de fora) | EPUB / PDF |
| arXiv | artigos científicos | PDF |
| Archive of Our Own | fanfics publicadas pelos próprios autores | EPUB / PDF |
| Syosetu (Shōsetsuka ni Narō) | web novels japonesas publicadas pelos autores | EPUB montado a partir dos capítulos |

O Syosetu não oferece arquivo pronto: a Estante lê os capítulos um por segundo (o
ritmo que o `robots.txt` do site pede) e monta um EPUB com sumário por volume e as
notas do autor. Obras longas levam alguns minutos; o botão mostra o andamento
(“Baixando 34/286”). Ilustrações dos capítulos ficam de fora.

Royal Road e Scribble Hub não estão aqui: os dois respondem a qualquer cliente que
não seja um navegador com um desafio anti-robô do Cloudflare, e a Estante não tenta
contornar esse tipo de bloqueio.

### Library Genesis (opcional)

Adaptado do plugin [annas.koplugin](https://github.com/fischer-hub/annas.koplugin)
do KOReader. É um acervo **não oficial**: boa parte do que está lá ainda tem
direitos autorais, então a fonte vem **desligada** e só entra na busca depois de
marcada em **Fontes**. O uso é por sua conta.

- A busca passa pelos espelhos `libgen.li`, `.la`, `.bz`, `.vg` e `.gl`, começando
  pelo último que respondeu. Só aparecem arquivos EPUB e PDF (MOBI, DJVU, FB2 etc.
  o leitor não abre), ordenados por relevância como no plugin.
- O download pega o link temporário da página `ads.php` do espelho e baixa do CDN
  do Library Genesis. Capas vêm do próprio arquivo, depois do download.
- O Library Genesis exige todas as palavras da busca: um título longo ou com erro de
  digitação pode não achar nada. Busque por menos palavras.
- O Anna's Archive, que o plugin usa como reserva, ficou de fora: ele responde a
  qualquer cliente que não seja um navegador com o desafio anti-robô do DDoS-Guard.
- No app para iPhone e iPad ele não vem embutido, mas pode ser adicionado (veja
  [App para iPhone e iPad](#app-para-iphone-e-ipad)).

### Escolher fontes e adicionar catálogos

<img src="docs/images/fontes.webp" alt="Janela Fontes, com as fontes embutidas e o Library Genesis desmarcado">

Em **Fontes** (ícone no canto superior direito) dá para escolher quais entram na
busca **Todas** e **adicionar qualquer catálogo OPDS**: Calibre, Calibre-Web, Kavita,
Komga, COPS etc. Para catálogo com senha: `https://usuario:senha@servidor/opds`.

### Importar arquivos seus

Use o botão **+** ou arraste EPUB e PDF para a janela. No iPhone e no iPad, **+**
abre o app Arquivos.

## Organizar a estante

<img src="docs/images/colecao.webp" alt="A coleção Clássicos brasileiros aberta, com cinco livros">

- **Continuar lendo**: o último livro aberto fica no topo, com o progresso.
- **Ordenar**: abertos recentemente, adicionados recentemente, título, autor ou
  progresso (botão ao lado do filtro). A escolha fica guardada.
- **Filtrar**: Todos, Lendo, Não começados e Lidos, cada um com a contagem; o campo
  "Filtrar por título ou autor" ignora acentos e maiúsculas.
- **Coleções**: crie em **+ Nova coleção** ou no menu de um livro. Um livro pode
  estar em várias. Com uma coleção aberta, o **⋯** ao lado do nome renomeia ou
  apaga (os livros continuam na estante).
- **Menu do livro** (**⋯** sobre a capa, ou botão direito): marcar como lido ou não
  lido, escolher coleções, editar título, autores e capa, remover da estante.

## Ler

<img src="docs/images/leitor.webp" alt="Dom Casmurro aberto em duas páginas, com destaques em amarelo, verde e azul">

- ← / → (ou espaço) viram a página; clique nas bordas ou deslize no celular.
- Clique no meio do texto para esconder ou mostrar as barras.
- A barra de baixo mostra o progresso e pula para qualquer ponto do livro.
- O ícone de lista abre o **Sumário**, com o capítulo atual em destaque.
- Esc fecha o livro e volta para a estante.

### Aparência

<img src="docs/images/aparencia.webp" alt="Painel de aparência aberto sobre Pride and Prejudice no tema sépia">

**Aa** abre o painel de aparência: tema **claro**, **sépia** ou **escuro**, tamanho
do texto e fonte (a original do livro, serifada ou sem serifa). No PDF, o mesmo
painel tem o zoom. As escolhas valem para todos os livros.

<table>
  <tr>
    <td><img src="docs/images/leitor-sepia.webp" alt="Pride and Prejudice no tema sépia"></td>
    <td><img src="docs/images/leitor-escuro.webp" alt="Frankenstein no tema escuro"></td>
  </tr>
  <tr>
    <td align="center">Sépia</td>
    <td align="center">Escuro</td>
  </tr>
</table>

### Marcadores, destaques e notas

<img src="docs/images/selecao.webp" alt="Trecho selecionado com a barra de cores, nota, dicionário, copiar e buscar">

- **Marcador**: ícone de marcador na barra (⌘D no Mac, Ctrl+D no Windows/Linux). A
  página marcada ganha uma fita no canto.
- **Destaque**: selecione um trecho e escolha uma das quatro cores. Clique num
  destaque para trocar a cor, escrever uma nota ou apagar.
- **Nota**: no mesmo menu da seleção; ⌘/Ctrl+Enter salva.
- **Copiar** e **Buscar** também estão na barra da seleção: o segundo procura o
  trecho no livro inteiro.
- O painel do sumário tem as abas **Marcadores** e **Notas**, em ordem de leitura,
  com o capítulo de cada um. As notas podem ser copiadas ou exportadas em Markdown.

<table>
  <tr>
    <td><img src="docs/images/notas.webp" alt="Aba Notas com quatro destaques e uma nota"></td>
    <td><img src="docs/images/sumario.webp" alt="Aba Sumário com o capítulo atual em destaque"></td>
  </tr>
  <tr>
    <td align="center">Notas</td>
    <td align="center">Sumário</td>
  </tr>
</table>

### Dicionário

<img src="docs/images/dicionario.webp" alt="Cartão do dicionário com a definição de contemplação">

Selecione uma palavra e toque no ícone de livro (**Dicionário**). As definições vêm do Wikcionário em
português (ou em inglês, quando não há verbete em português), consultado pela
própria Estante (o servidor, ou o app no iPhone e iPad), então funciona igual em
todo lugar. Precisa de internet. Quando a palavra não tem verbete, o cartão oferece
procurar direto no Wikcionário.

### Busca no livro

<img src="docs/images/busca-no-livro.webp" alt="Painel Buscar no livro com 11 resultados para olhos de ressaca, agrupados por capítulo">

Lupa na barra (⌘F / Ctrl+F). Ignora acentos e maiúsculas, agrupa os resultados por
capítulo (ou página, no PDF) e mostra o trecho em volta. Enter ou ↓ vai para o
próximo resultado, ↑ volta para o anterior.

### PDF

<img src="docs/images/pdf.webp" alt="Artigo Attention Is All You Need aberto no leitor de PDF">

PDFs abrem página a página, com os mesmos marcadores, destaques, notas e busca do
EPUB. Em **Aa**, escolha **Página inteira** ou **Largura**, ou ajuste o zoom com − e +.

## Atalhos de teclado

| Tecla | O que faz |
| --- | --- |
| ← / → , PageUp / PageDown | página anterior / próxima |
| Espaço / Shift+Espaço | próxima página / anterior |
| ↑ / ↓ | página anterior / próxima (EPUB) |
| ⌘F / Ctrl+F | busca no livro |
| Enter ou ↓ / ↑ (na busca no livro) | próximo resultado / anterior |
| ⌘D / Ctrl+D | marca ou desmarca a página |
| ⌘Enter / Ctrl+Enter | salva a nota |
| Esc | fecha a seleção, o painel aberto ou a busca; sem nada aberto, fecha o livro |
| `/` | na estante, vai para o campo de busca |
| Esc (no campo de busca) | limpa a busca e volta para a estante |
| Enter (numa capa) | abre o livro |

## Ler no celular pela rede

```bash
HOST=0.0.0.0 npm start
```

Depois abra `http://<ip-do-computador>:4567` no aparelho, na mesma rede Wi-Fi.
Não há senha: use só em redes de confiança. No iPhone e no iPad também dá para
usar o app, que dispensa o computador (veja [App para iPhone e iPad](#app-para-iphone-e-ipad)).

## Onde ficam os dados

| Onde a Estante roda | Pasta |
| --- | --- |
| Navegador (`npm start`) | `data/` na pasta do projeto, ou a pasta em `ESTANTE_DATA` |
| App para Mac | `~/Library/Application Support/Estante/data` |
| App para Windows | `%APPDATA%\Estante\data` |
| iPhone e iPad | **Arquivos › No Meu iPhone (ou iPad) › Estante › data** |

Em todas, os mesmos arquivos:

- `library.json`: metadados, progresso, marcadores, destaques e notas de cada livro;
- `books/`: os arquivos EPUB e PDF;
- `covers/`: as capas;
- `settings.json`: os catálogos OPDS e as coleções.

Fazer backup é copiar a pasta. Para mudar de aparelho, copie-a com a Estante
fechada; a cópia substitui a estante de destino. As fontes ligadas e as preferências
do leitor ficam no app ou no navegador, fora dessa pasta.

## Problemas comuns

**No Mac, "A Estante não pode ser aberta".** O app não é assinado por um
desenvolvedor registrado. Clique com o botão direito na Estante em Aplicativos e
escolha **Abrir**, ou vá em **Ajustes do Sistema › Privacidade e Segurança ›
Abrir Mesmo Assim**.

**No Windows, "O Windows protegeu o computador".** Clique em **Mais informações** e
em **Executar assim mesmo**. Só acontece na primeira vez.

**No iPhone, a Estante parou de abrir.** A assinatura de 7 dias venceu. Os livros e
as notas continuam no aparelho: abra o SideStore (com o LocalDevVPN ligado) ou o
AltStore (com o AltServer por perto) e toque em **My Apps › Refresh All**. Não
apague o app antes de renovar, senão os dados vão junto.

**O SideStore não entra no Apple ID (erro -80045).** É uma mudança recente no login
da Apple, ainda sem correção oficial. O contorno que tem funcionado está em
[b9rnardo/estante-ios](https://github.com/b9rnardo/estante-ios#se-o-login-falhar-com-o-erro--80045).
Se nada der certo, instale o `.ipa` direto pelo iloader (**Importar IPA**).

**Um arquivo `.js` chegou como `.txt` pelo AirDrop.** O iPhone trata o arquivo como
texto. No app Arquivos, toque e segure nele, escolha **Renomear** e troque `.txt`
por `.js` (para ver a extensão: **⋯ › Opções de Visualização › Mostrar Todas as
Extensões**). Pelo iCloud Drive o nome não muda.

**O download do Syosetu parou no iPhone.** O iOS suspende apps em segundo plano.
Deixe a Estante aberta na tela até terminar.

**O Library Genesis não acha um livro que existe lá.** Ele exige todas as palavras
da busca. Tente com menos palavras, só o sobrenome do autor ou parte do título.

**O celular não abre a Estante pela rede.** Rode com `HOST=0.0.0.0 npm start`, use
o IP do computador e confira se os dois estão na mesma rede Wi-Fi.

## Desenvolvimento

| Comando | O que faz |
| --- | --- |
| `npm start` | servidor em http://localhost:4567 (`PORT`, `HOST` e `ESTANTE_DATA` mudam porta, endereço e pasta) |
| `npm run app` | app para Mac ou Windows, direto do código |
| `npm run dist` | instalador `.dmg` para Mac |
| `npm run dist:win` | instalador `.exe` para Windows (64 bits) |
| `npm run ios` | prepara o app para iOS e o projeto do Xcode |
| `npm run ipa` | `.ipa` sem assinatura, para AltStore e SideStore |
| `npm run source -- <dono>/<repo>` | source do AltStore e SideStore em `dist/altstore/` |

Para testar sem mexer na sua estante, aponte `ESTANTE_DATA` para outra pasta:

```bash
ESTANTE_DATA=/tmp/estante-teste npm start
```

### Estrutura

```
electron/main.js               app para Mac e Windows: sobe o servidor e abre a janela
electron/preload.cjs           Windows: passa as cores dos botões da janela para o processo principal
build/icon.png                 ícone do app (desenhado em build/icon.svg)
server/index.js                servidor HTTP (API + arquivos estáticos)
server/library.js              estante em disco, download e validação dos arquivos
server/records.js              registros dos livros, iguais no servidor e no app para iOS
server/sources/                Gutenberg, Standard Ebooks, Internet Archive, arXiv, AO3, Syosetu, LibGen e OPDS
server/sources/serial.js       ritmo educado e detecção de bloqueio para sites de capítulos
server/sources/libgen.js       Library Genesis (opcional): espelhos, busca e link de download
server/epub-builder.js         monta EPUB 3 a partir de capítulos (XHTML sanitizado)
server/dictionary.js           definições do Wikcionário para o dicionário do leitor
public/js/app.js               estante (ordem, filtros, coleções), busca, importação e configurações
public/js/menu.js              menus suspensos
public/js/sheet.js             janelas de edição (informações do livro, coleções, nomes)
public/js/titlebar.js          cores dos botões da janela no Windows e da barra de status no iOS
public/js/reader.js            interface do leitor
public/js/reader-marks.js      marcadores, destaques, notas e exportação
public/js/reader-selection.js  barra da seleção de texto e cartão de nota
public/js/reader-dict.js       cartão do dicionário
public/js/reader-search.js     painel de busca no livro
public/js/epub-engine.js       renderização EPUB (epub.js)
public/js/pdf-engine.js        renderização PDF (pdf.js)
mobile/build.mjs               monta o app para iOS (mobile/www) e dist/fontes/libgen.js
mobile/server.js               a API do servidor respondida dentro do app para iOS
mobile/library.js              estante do app para iOS, na pasta Documentos do app
mobile/sandbox.js              fontes adicionadas pelo usuário, isoladas num frame próprio
mobile/source-http.js          acesso à rede de uma fonte adicionada (só texto e JSON, pelo app)
mobile/crypto.js               node:crypto para o app para iOS
mobile/ipa.mjs                 gera o .ipa sem assinatura para AltStore e SideStore
mobile/source.mjs              gera a source do AltStore e SideStore (source.json, ícone, .ipa)
ios/                           projeto do Xcode (Capacitor)
docs/images/                   capturas de tela deste README
```
