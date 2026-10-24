# Estante

Leitor de e-books minimalista que roda no seu computador. Busca EPUBs e PDFs em
acervos abertos, baixa para uma estante local e abre num leitor limpo, que lembra
onde você parou.

## Rodar

```bash
npm install
npm start
```

Abra http://localhost:4567. Requer Node 20.11 ou mais novo.

## App para Mac

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

O app só aceita conexões do próprio Mac. Para ler no celular, use `npm start`
(veja abaixo).

## Fontes embutidas

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

Em **Fontes** (ícone no canto superior direito) dá para escolher quais entram na
busca "Todas" e **adicionar qualquer catálogo OPDS**: Calibre, Calibre-Web, Kavita,
Komga, COPS etc. Para catálogo com senha: `https://usuario:senha@servidor/opds`.

Também dá para importar arquivos seus: botão **+** ou arrastar EPUB/PDF para a janela.

## Leitor

- ← / → (ou espaço) viram a página; clique nas bordas ou deslize no celular.
- Clique no meio do texto para esconder/mostrar as barras.
- **Aa**: tema claro, sépia ou escuro, tamanho e fonte do texto (EPUB) ou zoom (PDF).
- Sumário pelo ícone de lista; barra inferior para pular para qualquer ponto.
- `/` foca a busca; Esc fecha o livro.

## Ler no celular ou tablet

```bash
HOST=0.0.0.0 npm start
```

Depois abra `http://<ip-do-computador>:4567` no aparelho, na mesma rede Wi-Fi.
Não há senha: use só em redes de confiança.

## Onde ficam os dados

Tudo em `data/` (ou na pasta definida em `ESTANTE_DATA`; no app para Mac, em
`~/Library/Application Support/Estante/data`): `library.json` com
metadados e progresso, `books/` com os arquivos, `covers/` com as capas e
`settings.json` com os catálogos OPDS.

## Estrutura

```
electron/main.js         app para Mac: sobe o servidor e abre a janela
build/icon.png           ícone do app (desenhado em build/icon.svg)
server/index.js          servidor HTTP (API + arquivos estáticos)
server/library.js        estante em disco, download e validação dos arquivos
server/sources/          Gutenberg, Standard Ebooks, Internet Archive, arXiv, AO3, Syosetu, LibGen e OPDS
server/sources/serial.js ritmo educado e detecção de bloqueio para sites de capítulos
server/sources/libgen.js Library Genesis (opcional): espelhos, busca e link de download
server/epub-builder.js   monta EPUB 3 a partir de capítulos (XHTML sanitizado)
public/js/app.js         estante, busca, importação e configurações
public/js/reader.js      interface do leitor
public/js/epub-engine.js renderização EPUB (epub.js)
public/js/pdf-engine.js  renderização PDF (pdf.js)
```
