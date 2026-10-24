// Tabela de referência: alimentos brasileiros comuns e seus grupos, conferidos à mão.
// Usada antes da IA. Formato: "nome/outro nome|códigos". Sem código = nenhum grupo.
// FODMAP segue a lista da Monash University; Ultraprocessado segue a classificação NOVA.
const CODES = {
  Fr: "Fritura", G: "Gordura", Fi: "Fibra", FO: "FODMAP", L: "Lactose", Gl: "Glúten",
  A: "Açúcar", C: "Cafeína", Al: "Álcool", P: "Picante", Le: "Leguminosa", U: "Ultraprocessado",
};

const TABLE = `
arroz/arroz branco|
arroz integral|Fi
arroz carreteiro|G
arroz doce|A L
feijao/feijao preto/feijao carioca/feijao branco|Le Fi FO
feijoada|Le Fi FO G
lentilha/grao de bico/ervilha|Le Fi FO
soja|Le Fi FO
tofu|Le
edamame|Le Fi
pao/pao frances/pao de sal|Gl FO
pao de forma|Gl FO U
pao integral|Gl FO Fi
pao de queijo|G L
pao com manteiga/pao na chapa|Gl FO G
torrada|Gl FO
bisnaguinha|Gl FO A U
croissant|Gl FO G L
sanduiche/sanduiche natural|Gl FO
misto quente|Gl FO G
macarrao/espaguete/massa/macarronada|Gl FO
macarrao integral|Gl FO Fi
miojo/macarrao instantaneo|Gl FO G U
lasanha|Gl FO L G
pizza|Gl FO L G
yakisoba|Gl FO
tapioca/crepioca|
cuscuz/cuscuz nordestino/cuscuz de milho|
cuscuz marroquino|Gl FO
polenta|
polenta frita|Fr G
aveia/farelo de aveia|Fi
granola|Fi A
cereal matinal/sucrilhos|A U
farofa|G
farinha de mandioca|
mandioca/aipim/macaxeira|Fi
mandioca frita/aipim frito|Fr G
batata/batata cozida|
pure de batata/pure|L G
batata frita|Fr G
batata doce|Fi
inhame/cara|Fi
milho/milho verde|Fi FO
pipoca|Fi
quinoa|Fi
ovo/ovo cozido/ovos|
ovo frito|Fr G
omelete/ovo mexido|G
frango/peito de frango/frango grelhado/frango assado|
frango frito|Fr G
frango empanado/nuggets|Fr G Gl U
carne/carne moida/carne bovina/bife/patinho/alcatra|
picanha/costela/cupim/fraldinha/contrafile|G
bife a milanesa/milanesa|Fr G Gl
carne de porco/lombo|
bisteca|G
torresmo|Fr G
bacon|G U
linguica|G U
salsicha|G U
presunto/mortadela/salame|G U
peito de peru|U
hamburguer|G Gl FO
cachorro quente|G Gl FO U
peixe/tilapia/merluza|
salmao/sardinha|G
atum|
peixe frito|Fr G
camarao|
leite/leite integral/leite desnatado|L FO
leite sem lactose|
iogurte/iogurte natural|L FO
iogurte grego|L G
iogurte de frutas/iogurte com sabor/danone|L FO A U
queijo/mussarela/queijo mussarela/queijo prato/parmesao/queijo parmesao|G
queijo minas/queijo frescal/queijo branco|L
ricota/cottage|L FO
requeijao/cream cheese|L G
manteiga|G
margarina|G U
creme de leite|L G
leite condensado|L A
sorvete|L A G FO U
chocolate/chocolate ao leite|A G L C
chocolate amargo|G C
achocolatado/nescau/toddy|A L C U
banana|Fi FO
maca/pera/manga/pessego/ameixa/cereja/amora/caqui/figo/damasco|Fi FO
melancia|FO
abacate|G Fi FO
laranja/mexerica/tangerina/bergamota/mamao/papaya/abacaxi/morango/kiwi/maracuja/goiaba|Fi
uva/melao/limao|
coco|G Fi
acai|A G
uva passa/passas|A FO Fi
salada/alface/rucula/agriao/couve/espinafre|Fi
tomate/pepino/chuchu/pimentao/palmito|
cenoura/abobrinha/abobora/quiabo/vagem/berinjela|Fi
brocolis/couve flor/repolho/beterraba/aspargo|Fi FO
cebola|FO Fi
alho|FO
cogumelo/champignon|FO
amendoim/pasta de amendoim|G Le
castanha/castanha do para/amendoas/nozes|G Fi
castanha de caju/pistache|G FO
chia/linhaca|Fi
bolo|Gl A G FO
bolo de chocolate|Gl A G C FO
biscoito/bolacha|Gl A U FO
biscoito recheado/bolacha recheada|Gl A G U FO
biscoito agua e sal/cream cracker|Gl U FO
brigadeiro|A L G
pudim/doce de leite|A L
mel|A FO
geleia/acucar|A
pacoca|A G Le
churros|Fr G Gl A
coxinha/pastel|Fr G Gl FO
esfiha/esfirra|Gl FO G
empada|Gl G
kibe/quibe|Fr Gl FO G
salgadinho/batata chips|Fr G U
pao de mel|Gl A C
barra de cereal|A U
cafe/cafe preto/expresso/cafezinho|C
cafe com leite/pingado|C L FO
cappuccino|C L A
cha preto/cha verde/chimarrao/mate/terere|C
refrigerante/guarana|A U
coca cola/coca/refrigerante de cola|A C U
refrigerante zero/coca zero|C U
suco de caixinha/suco industrializado|A U
suco/suco natural/suco de laranja/agua de coco|
energetico|C A U
cerveja|Al Gl FO
vinho/cachaca/vodka/whisky|Al
caipirinha|Al A
agua|
strogonoff/estrogonofe|L G
sushi/temaki|
canjica|A L
sopa|
caldo verde|G Fi
moqueca|G
acaraje|Fr G Le FO P
vatapa|G Gl
maionese|G U
ketchup|A U
mostarda|
molho de tomate|FO
pimenta/molho de pimenta/curry|P
azeite/oleo|G
`;

export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export const REFERENCE = new Map();
for (const line of TABLE.trim().split("\n")) {
  const [names, codes] = line.split("|");
  const groups = codes.trim() ? codes.trim().split(/\s+/).map((c) => CODES[c]) : [];
  for (const n of names.split("/")) REFERENCE.set(norm(n), groups);
}

// Grupos da tabela para um nome (aceita plural simples: "bananas", "ovos").
export function lookup(name) {
  const n = norm(name);
  if (REFERENCE.has(n)) return REFERENCE.get(n);
  const singular = n.split(" ").map((w) => w.replace(/(oes|aes)$/, "ao").replace(/s$/, "")).join(" ");
  return REFERENCE.get(singular) ?? null;
}

// Nota de saúde, pela regra de ouro do Guia Alimentar para a População Brasileira (Ministério da Saúde):
// S = saudável (in natura ou minimamente processado: base da alimentação),
// M = moderação (processados, preparações com mais gordura, sal ou açúcar),
// E = evitar (ultraprocessados, frituras, doces, refrigerantes, álcool).
const HEALTH_CODES = { S: "saudavel", M: "moderado", E: "evitar" };

const HEALTH_TABLE = `
arroz/arroz branco/arroz integral/feijao/feijao preto/feijao carioca/feijao branco/lentilha/grao de bico/ervilha/soja/tofu/edamame|S
pao integral/macarrao integral/tapioca/crepioca/cuscuz/cuscuz nordestino/cuscuz de milho/polenta/aveia/farelo de aveia/quinoa|S
mandioca/aipim/macaxeira/batata/batata cozida/pure de batata/pure/batata doce/inhame/cara/milho/milho verde/pipoca|S
ovo/ovo cozido/ovos/omelete/ovo mexido/frango/peito de frango/frango grelhado/frango assado/carne/carne moida/carne bovina/bife/patinho/alcatra/carne de porco/lombo|S
peixe/tilapia/merluza/salmao/sardinha/camarao/leite/leite integral/leite desnatado/leite sem lactose/iogurte/iogurte natural/iogurte grego/queijo minas/queijo frescal/queijo branco/ricota/cottage|S
banana/maca/pera/manga/pessego/ameixa/cereja/amora/caqui/figo/damasco/melancia/abacate/laranja/mexerica/tangerina/bergamota/mamao/papaya/abacaxi/morango/kiwi/maracuja/goiaba/uva/melao/limao/coco/acai|S
salada/alface/rucula/agriao/couve/espinafre/tomate/pepino/chuchu/pimentao/palmito/cenoura/abobrinha/abobora/quiabo/vagem/berinjela/brocolis/couve flor/repolho/beterraba/aspargo/cebola/alho/cogumelo/champignon|S
amendoim/pasta de amendoim/castanha/castanha do para/amendoas/nozes/castanha de caju/pistache/chia/linhaca/uva passa/passas|S
cafe/cafe preto/expresso/cafezinho/cafe com leite/pingado/cha preto/cha verde/chimarrao/mate/terere/suco natural/suco de laranja/agua de coco/agua|S
sopa/caldo verde/moqueca/feijoada/canjica/sushi/temaki/peixe assado/mostarda/molho de tomate/pimenta/molho de pimenta/curry/azeite/oleo|S
arroz carreteiro/pao/pao frances/pao de sal/pao de queijo/pao com manteiga/pao na chapa/torrada/sanduiche/sanduiche natural/misto quente/macarrao/espaguete/massa/macarronada/lasanha/yakisoba/cuscuz marroquino|M
farofa/farinha de mandioca/granola/picanha/costela/cupim/fraldinha/contrafile/bisteca/atum/queijo/mussarela/queijo mussarela/queijo prato/parmesao/queijo parmesao/manteiga/creme de leite/chocolate amargo|M
strogonoff/estrogonofe/vatapa/pizza/suco|M
arroz doce/pao de forma/bisnaguinha/croissant/miojo/macarrao instantaneo/polenta frita/cereal matinal/sucrilhos/mandioca frita/aipim frito/batata frita/ovo frito/frango frito/frango empanado/nuggets|E
bife a milanesa/milanesa/torresmo/bacon/linguica/salsicha/presunto/mortadela/salame/peito de peru/hamburguer/cachorro quente/peixe frito|E
iogurte de frutas/iogurte com sabor/danone/requeijao/cream cheese/margarina/leite condensado/sorvete/chocolate/chocolate ao leite/achocolatado/nescau/toddy|E
bolo/bolo de chocolate/biscoito/bolacha/biscoito recheado/bolacha recheada/biscoito agua e sal/cream cracker/brigadeiro/pudim/doce de leite/mel/geleia/acucar/pacoca/churros|E
coxinha/pastel/esfiha/esfirra/empada/kibe/quibe/salgadinho/batata chips/pao de mel/barra de cereal/acaraje/maionese/ketchup|E
cappuccino/refrigerante/guarana/coca cola/coca/refrigerante de cola/refrigerante zero/coca zero/suco de caixinha/suco industrializado/energetico/cerveja/vinho/cachaca/vodka/whisky/caipirinha|E
`;

export const HEALTH = new Map();
for (const line of HEALTH_TABLE.trim().split("\n")) {
  const [names, code] = line.split("|");
  for (const n of names.split("/")) HEALTH.set(norm(n), HEALTH_CODES[code.trim()]);
}

export function healthLookup(name) {
  const n = norm(name);
  if (HEALTH.has(n)) return HEALTH.get(n);
  const singular = n.split(" ").map((w) => w.replace(/(oes|aes)$/, "ao").replace(/s$/, "")).join(" ");
  return HEALTH.get(singular) ?? null;
}
