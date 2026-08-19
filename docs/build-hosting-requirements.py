"""Builds Requisitos-Hospedagem-NextSkins.pdf.

    python docs/build-hosting-requirements.py docs/Requisitos-Hospedagem-NextSkins.pdf

The document itself stays in Portuguese: its readers are the network team
in Brazil, not this codebase. The code and these comments follow the
project's English convention.

This generator exists because v1 went stale. It was hand-made in August
and by the time the egress architecture landed it still asked for a
single dedicated IP — nobody rebuilt it, because rebuilding meant redoing
the layout. Regenerating is now one command, so the next change to the
requirements can actually reach the document.

Requires fpdf2 and the two Windows font families the original used
(Segoe UI and Consolas), kept so v2 does not read as a different
document. On another platform, point FONTS at any sans/mono pair.
"""

from fpdf import FPDF

FONTS = r"C:\Windows\Fonts"

INK = (16, 23, 32)
SOFT = (85, 97, 110)
FAINT = (125, 136, 149)
ACCENT = (11, 110, 127)
CRITICAL = (156, 52, 24)
RULE = (203, 213, 221)
SUNK = (238, 242, 245)

W = 210.0
MARGIN = 18.0
TEXT_W = W - 2 * MARGIN


class Doc(FPDF):
    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_auto_page_break(True, margin=20)
        self.add_font("sans", "", f"{FONTS}\\segoeui.ttf")
        self.add_font("sans", "B", f"{FONTS}\\segoeuib.ttf")
        self.add_font("mono", "", f"{FONTS}\\consola.ttf")
        self.add_font("mono", "B", f"{FONTS}\\consolab.ttf")
        self.set_margins(MARGIN, 16, MARGIN)

    def footer(self):
        if self.page_no() == 1:
            return
        self.set_y(-15)
        self.set_font("mono", "", 7)
        self.set_text_color(*FAINT)
        self.cell(0, 4, f"NextSkins · Requisitos de hospedagem v2", align="L")
        self.set_x(MARGIN)
        self.cell(0, 4, str(self.page_no()), align="R")


d = Doc()


# ---------------------------------------------------------------- helpers


def space(mm):
    d.set_y(d.get_y() + mm)


def eyebrow(txt):
    d.set_font("mono", "B", 7.5)
    d.set_text_color(*ACCENT)
    d.set_x(MARGIN)
    d.cell(0, 4, txt.upper())
    d.ln(5)


def title(txt):
    d.set_font("sans", "B", 22)
    d.set_text_color(*INK)
    d.set_x(MARGIN)
    d.cell(0, 10, txt)
    d.ln(11)


def section(txt, note=None):
    space(3)
    d.set_font("sans", "B", 13)
    d.set_text_color(*INK)
    d.set_x(MARGIN)
    d.cell(0, 7, txt)
    d.ln(7)
    if note:
        d.set_font("sans", "", 8.5)
        d.set_text_color(*FAINT)
        d.set_x(MARGIN)
        d.multi_cell(TEXT_W, 4.2, text=note)
    y = d.get_y() + 1.5
    d.set_draw_color(*RULE)
    d.set_line_width(0.4)
    d.line(MARGIN, y, W - MARGIN, y)
    d.set_y(y + 3.5)


def body(txt, size=9.3, color=SOFT, w=TEXT_W, x=MARGIN, lh=4.6):
    d.set_font("sans", "", size)
    d.set_text_color(*color)
    d.set_x(x)
    d.multi_cell(w, lh, text=txt)


def item(num, head, txt, tag=None, tag_color=CRITICAL):
    """One numbered requirement: mono number in the gutter, text beside it."""
    if d.get_y() > 240:
        d.add_page()

    top = d.get_y()
    gutter = 11.0

    d.set_font("mono", "B", 10)
    d.set_text_color(*(tag_color if tag else ACCENT))
    d.set_xy(MARGIN, top)
    d.cell(gutter, 5.5, num)

    d.set_font("sans", "B", 10)
    d.set_text_color(*INK)
    d.set_xy(MARGIN + gutter, top)
    head_w = TEXT_W - gutter - (26 if tag else 0)
    d.multi_cell(head_w, 5.5, text=head)

    if tag:
        d.set_font("mono", "B", 6.5)
        d.set_text_color(*tag_color)
        d.set_xy(W - MARGIN - 24, top + 0.6)
        d.cell(24, 4.4, tag, align="C", border=1)

    d.set_y(max(d.get_y(), top + 5.5) + 0.8)
    body(txt, x=MARGIN + gutter, w=TEXT_W - gutter, lh=4.4)
    space(3.2)


def kv_table(rows, headers, widths, mono_cols=()):
    d.set_font("mono", "B", 7)
    d.set_text_color(*FAINT)
    d.set_x(MARGIN)
    for h, wid in zip(headers, widths):
        d.cell(wid, 6, h.upper())
    d.ln(6)
    d.set_draw_color(*RULE)
    d.set_line_width(0.3)
    d.line(MARGIN, d.get_y(), W - MARGIN, d.get_y())
    space(1.5)

    for row in rows:
        d.set_x(MARGIN)
        y = d.get_y()
        for i, (cell, wid) in enumerate(zip(row, widths)):
            d.set_font("mono" if i in mono_cols else "sans", "", 8.6)
            d.set_text_color(*(INK if i == 0 else SOFT))
            d.set_xy(MARGIN + sum(widths[:i]), y)
            d.cell(wid, 5.4, cell)
        d.ln(5.4)
        d.set_draw_color(*RULE)
        d.set_line_width(0.15)
        d.line(MARGIN, d.get_y(), W - MARGIN, d.get_y())
        space(1.2)


def callout(head, txt, color=CRITICAL):
    if d.get_y() > 225:
        d.add_page()
    top = d.get_y()
    d.set_font("sans", "B", 9.6)
    d.set_text_color(*color)
    d.set_xy(MARGIN + 4, top + 3)
    d.multi_cell(TEXT_W - 8, 5, text=head)
    d.set_x(MARGIN + 4)
    space(0.8)
    body(txt, x=MARGIN + 4, w=TEXT_W - 8, lh=4.4)
    bottom = d.get_y() + 3
    d.set_draw_color(*color)
    d.set_line_width(0.8)
    d.line(MARGIN, top, MARGIN, bottom)
    d.set_y(bottom + 3)


def check(q, why=None):
    if d.get_y() > 250:
        d.add_page()
    top = d.get_y()
    d.set_font("mono", "B", 10)
    d.set_text_color(*ACCENT)
    d.set_xy(MARGIN, top)
    d.cell(6, 5, "?")
    d.set_font("sans", "B", 9.4)
    d.set_text_color(*INK)
    d.set_xy(MARGIN + 6, top)
    d.multi_cell(TEXT_W - 6, 5, text=q)
    if why:
        space(0.4)
        body(why, size=8.6, color=FAINT, x=MARGIN + 6, w=TEXT_W - 6, lh=4.1)
    space(2.6)


# ---------------------------------------------------------------- page 1

d.add_page()
eyebrow("Especificação técnica · nextskins.gg")
title("Requisitos de hospedagem")

d.set_font("mono", "", 7.5)
d.set_text_color(*FAINT)
d.set_x(MARGIN)
d.cell(0, 4, "VERSÃO 2 · 19/08/2026 · SUBSTITUI A VERSÃO DE 12/08")
d.ln(7)

body(
    "Marketplace de skins de CS2. A aplicação mantém conexão permanente com os "
    "servidores da Steam e guarda itens de terceiros em custódia, o que cria "
    "requisitos incomuns: processos que nunca encerram e vários endereços IP de "
    "saída sob nosso controle.",
    size=9.8,
    color=SOFT,
    lh=5,
)
space(2)
body(
    "Esta versão assume infraestrutura própria. A versão anterior era um "
    "questionário para provedor terceirizado e pedia um único IP dedicado — os "
    "dois pontos mudaram e estão reescritos aqui.",
    size=9.0,
    color=FAINT,
)

section(
    "Obrigatórios",
    "Sem estes, não funciona.",
)

item(
    "01",
    "De 5 a 10 IPs de saída, na mesma máquina",
    "A Steam limita consultas por endereço IP, e é esse limite — não o hardware "
    "— que define quantos usuários o site atende ao mesmo tempo. Cada endereço "
    "sustenta cerca de 900 chamadas por hora, e a aplicação alterna entre eles "
    "por chamada.\n\n"
    "Precisam ser atribuídos à mesma interface do mesmo servidor, como "
    "endereços secundários. A aplicação é um processo só que escolhe o IP de "
    "origem; um endereço por VM exigiria rodar várias cópias e coordenar o "
    "limite entre elas, o que é outro desenho de sistema.\n\n"
    "Fixos e fora de qualquer pool de rotação: o controle de limite é contado "
    "por endereço, e se o endereço mudar por baixo a contagem passa a ser de "
    "outra pessoa.",
    tag="CRÍTICO",
)

item(
    "02",
    "Saída sem NAT ou proxy compartilhado",
    "De nada adianta ter dez endereços se o tráfego de saída passa por um "
    "gateway que reescreve a origem — para a Steam vale o endereço de saída, e "
    "os dez viram um.\n\n"
    "É a falha mais perigosa da lista porque acontece em silêncio: nenhum erro, "
    "nenhum aviso, apenas a capacidade que nunca aparece. Vale confirmar antes "
    "de configurar qualquer coisa.",
    tag="CRÍTICO",
)

item(
    "03",
    "Portas de saída liberadas",
    "O firewall de saída não pode restringir apenas às portas de web. A conexão "
    "do serviço de bots com a Steam usa portas próprias.\n\n"
    "443/TCP  ·  obrigatório (API e community da Steam)\n"
    "27014–27050/TCP  ·  recomendado (servidores de conexão da Steam)",
    tag="CRÍTICO",
)

item(
    "04",
    "Processos de longa duração",
    "O serviço de bots mantém conexão aberta com a Steam e consome uma fila "
    "continuamente. Hospedagem compartilhada e ambientes serverless, que "
    "encerram o processo após cada requisição, não atendem.",
)

# ---------------------------------------------------------------- page 2

d.add_page()

item("05", "Node.js 20 LTS ou superior", "Toda a aplicação é TypeScript sobre Node.")

item(
    "06",
    "Docker e Docker Compose",
    "O projeto já está estruturado em contêineres. Sem Docker é possível "
    "instalar as dependências direto no sistema, mas o trabalho de implantação "
    "aumenta.",
)

item(
    "07",
    "Acesso root por SSH",
    "Necessário para instalar dependências, configurar serviços e diagnosticar "
    "problemas. Painel web sozinho não basta.",
)

item(
    "08",
    "PostgreSQL 16 e Redis 7",
    "Podem rodar na própria máquina ou como serviço gerenciado. Se forem "
    "gerenciados, precisam ser alcançáveis a partir da aplicação.",
)

section(
    "Recursos",
    "O gargalo da aplicação é o limite de requisições da Steam, não o hardware — "
    "mas isso deixa de valer conforme os endereços de saída se multiplicam.",
)

kv_table(
    rows=[
        ["Processador", "2 vCPU", "4 vCPU", "8 vCPU"],
        ["Memória", "4 GB", "8 GB", "16 GB"],
        ["Disco", "40 GB SSD", "80 GB SSD", "160 GB SSD"],
        ["Sistema", "Ubuntu 22.04 LTS ou superior", "", ""],
    ],
    headers=["Recurso", "Início · 1–2 IPs", "Confortável", "5–10 IPs"],
    widths=[38, 48, 44, 44],
    mono_cols=(1, 2, 3),
)

space(2)
body(
    "A coluna da direita existe porque banco e fila rodam na mesma máquina. "
    "Multiplicar os endereços multiplica os usuários simultâneos, e a partir "
    "daí quem sente primeiro é o PostgreSQL, não a Steam.",
    size=8.8,
    color=FAINT,
)

# ---------------------------------------------------------------- page 3

d.add_page()

section(
    "Sobre os endereços de saída",
    "A parte que mudou desde a v1, e a que tem mais armadilha por metro quadrado.",
)

body(
    "A conta é direta: cada endereço sustenta cerca de 900 chamadas por hora, e "
    "com o cache de inventário em uma hora cada usuário custa uma chamada. Dez "
    "endereços, portanto, atendem cerca de nove mil pessoas ao mesmo tempo.",
    lh=4.6,
)
space(3)

item(
    "A",
    "Endereços de blocos diferentes valem mais que endereços vizinhos",
    "Pedir “mais IPs” costuma render endereços sequenciais do mesmo bloco /24. "
    "Quem limita por IP frequentemente aplica o limite ao /24 inteiro, "
    "justamente porque comprar vizinhos seria a forma óbvia de furar o limite. "
    "Nesse caso, dez endereços valeriam por um.\n\n"
    "Três blocos distintos são preferíveis a dez endereços seguidos.",
    tag="ATENÇÃO",
    tag_color=CRITICAL,
)

item(
    "B",
    "Faixa de acesso é melhor que faixa de datacenter",
    "O dono de cada bloco é informação pública, e distinguir datacenter de "
    "acesso residencial é uma consulta. Tráfego vindo de faixa de datacenter é "
    "presumido automação — ninguém joga CS2 de dentro de um rack.\n\n"
    "Sendo a Italnet provedora, ela dispõe de faixas de acesso. É uma vantagem "
    "que quem aluga servidor não tem.",
)

item(
    "C",
    "Preferir um bloco que não atenda assinante",
    "Consequência direta do item B: a faixa de acesso é a mais vantajosa e é "
    "exatamente a que serve clientes pagantes. Se um bloqueio externo se "
    "espalhar pelo bloco, o prejuízo sai da operadora.\n\n"
    "Um bloco ocioso mantém a vantagem de ser faixa de provedora sem colocar "
    "assinante no caminho.",
)

item(
    "D",
    "DNS reverso neutro",
    "Um PTR como host-x-x-x-x.datacenter.italnet.com.br anuncia datacenter "
    "sozinho, mesmo que o registro do bloco não diga nada. Sendo nosso o DNS, é "
    "ajuste de minutos.",
)

item(
    "E",
    "Endereços sem histórico de abuso",
    "Endereço reciclado de quem abusou chega penalizado, e o sintoma parece bug "
    "da aplicação. Conferir em listas de reputação antes de alocar evita "
    "procurar defeito onde não há.",
)

callout(
    "Nada disto é número publicado pela Valve",
    "Não existe limite documentado nem cabeçalho de resposta informando quanto "
    "resta. O intervalo que a aplicação respeita hoje veio de convenção da "
    "comunidade que constrói bots de trade.\n\n"
    "Por isso o plano é subir com 2 ou 3 endereços e medir antes de alocar dez. "
    "A aplicação registra qual rota levou bloqueio: rotas caindo em momentos "
    "diferentes indicam limite por endereço; rotas do mesmo bloco caindo juntas "
    "são a assinatura de limite compartilhado.",
)

# ---------------------------------------------------------------- page 4

d.add_page()

section("Importantes", "Não bloqueiam o início.")

item(
    "01",
    "Backup automatizado do banco",
    "O banco guarda o saldo dos usuários e o registro de quem é dono de cada "
    "item em custódia. Perdê-lo significa não saber a quem devolver skins que "
    "continuam fisicamente conosco. Precisa incluir restauração testada, não "
    "apenas geração de cópias.",
)

item("02", "Snapshot da máquina", "Recuperação rápida em caso de falha do sistema.")

item(
    "03",
    "Reinício automático do serviço",
    "Se a máquina reiniciar, os contêineres devem subir sozinhos. Bot offline "
    "significa entregas paradas.",
)

item(
    "04",
    "Console fora de banda (KVM ou VNC)",
    "Para recuperar acesso quando o SSH cai por erro de configuração de rede — "
    "risco real aqui, já que vamos mexer em endereçamento.",
)

item(
    "05",
    "Certificado TLS",
    "Let's Encrypt atende. O site precisa de HTTPS: o login da Steam exige, e os "
    "cookies de sessão são marcados como seguros.",
)

section(
    "Verificações internas",
    "A v1 trazia perguntas para um provedor. Com infraestrutura própria a maior "
    "parte virou decisão nossa; sobra o que ainda é fato a confirmar.",
)

check(
    "O tráfego de saída deste servidor passa por NAT ou proxy?",
    "É o que mais passa despercebido, e invalida todo o resto. Ser dono da rede "
    "não responde a pergunta — é configuração, não permissão.",
)

check(
    "O firewall de saída libera a faixa 27014–27050/TCP?",
    "Só 443 não basta: o serviço de bots conversa com a Steam por portas próprias.",
)

check(
    "Conseguimos atribuir vários endereços à mesma interface?",
    "Se a resposta for “um IP por VM”, o desenho da aplicação precisa mudar antes "
    "de qualquer alocação.",
)

check(
    "Qual bloco podemos usar sem assinante no raio de um bloqueio?",
    "Pergunta que só existe por sermos a operadora. Ver os itens B e C.",
)

check(
    "Os contratos de trânsito ou peering impõem alguma política de uso?",
    "Ser dono da operadora elimina o locador, não a camada acima dela.",
)

check(
    "Os serviços sobem sozinhos após queda de energia ou manutenção?",
)

space(4)
d.set_draw_color(*RULE)
d.set_line_width(0.3)
d.line(MARGIN, d.get_y(), W - MARGIN, d.get_y())
space(3)
body(
    "O que o servidor executa: uma API HTTP, um serviço de bots com conexão "
    "permanente à Steam, um banco PostgreSQL e um Redis. Nenhum deles expõe "
    "porta além da web — os demais conversam apenas entre si na rede interna.",
    size=8.6,
    color=FAINT,
)

import sys

d.output(sys.argv[1])
print("gerado:", sys.argv[1])
